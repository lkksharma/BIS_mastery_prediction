/**
 * All Firestore reads and writes.  Two collections:
 *
 *   questions/{id}          -- the bank (read).  Falls back to the bundled
 *                              bank in src/data/questions.js when absent.
 *   settings/config         -- quiz config (read, optional)
 *   quiz_attempts/{auto}    -- one document per submission (write-once).  A
 *                              student may retake; each attempt carries an
 *                              `attemptNumber` so repeat sittings can be
 *                              filtered at export time instead of blocked.
 *
 * Field names on the attempt document deliberately match the existing
 * `Bis-quiz` export pipeline so the same analysis scripts keep working.
 */
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { BUNDLED_BANK, DEFAULT_CONFIG } from "../data/questions";

const USE_REMOTE =
  String(import.meta.env.VITE_USE_FIRESTORE_QUESTIONS || "true") === "true";

export async function loadBank() {
  const fallback = {
    calibration: BUNDLED_BANK.calibration,
    technical: BUNDLED_BANK.technical,
    config: DEFAULT_CONFIG,
    source: "bundled",
  };
  if (!db || !USE_REMOTE) return fallback;

  try {
    const [qSnap, cSnap] = await Promise.all([
      getDocs(collection(db, "questions")),
      getDoc(doc(db, "settings", "config")),
    ]);

    const rows = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
    const calibration = rows.filter((q) => q.block === "calibration").sort(byOrder);
    const technical = rows.filter((q) => q.block === "technical").sort(byOrder);

    // A partial bank is worse than no bank -- the calibration block must be
    // exactly the k=3 the model was fitted for.
    if (calibration.length < 3 || technical.length < 1) return fallback;

    return {
      calibration: calibration.slice(0, 3),
      technical,
      config: cSnap.exists() ? { ...DEFAULT_CONFIG, ...cSnap.data() } : DEFAULT_CONFIG,
      source: "firestore",
    };
  } catch (err) {
    // Expected once per load: the boot-time call happens before sign-in and the
    // rules require auth. App.jsx re-calls this after sign-in. A permission
    // error AFTER sign-in is the real signal that rules are wrong.
    const code = err?.code || String(err);
    console.warn(
      code === "permission-denied"
        ? "Question bank not readable yet (pre-auth); using bundled bank."
        : `Question bank fetch failed (${code}); using bundled bank.`,
    );
    return fallback;
  }
}

export async function saveAttempt(payload) {
  if (!db) return { ok: false, reason: "not-configured" };
  try {
    const ref = await addDoc(collection(db, "quiz_attempts"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    return { ok: true, id: ref.id };
  } catch (err) {
    console.error("Attempt save failed:", err);
    return { ok: false, reason: err?.code || "unknown" };
  }
}

/**
 * How many attempts this account has already submitted.
 *
 * Retakes are allowed but flagged: `attemptNumber` lets the analysis keep only
 * first sittings in one line, which is what clean_and_eda.py already does the
 * hard way (it had to drop 453 attempts / 3,461 rows after the fact).
 *
 * Uses an aggregation count, so this costs one read unit rather than one per
 * matching document. Returns 0 on any failure -- a miscount must never be the
 * reason a student cannot start.
 */
export async function countPriorAttempts(uid) {
  if (!db || !uid) return 0;
  try {
    const snap = await getCountFromServer(
      query(collection(db, "quiz_attempts"), where("studentUid", "==", uid)),
    );
    return snap.data().count || 0;
  } catch (err) {
    console.warn("Prior-attempt count failed:", err?.code || err);
    return 0;
  }
}
