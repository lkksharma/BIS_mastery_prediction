/**
 * Health check for the Firestore backend.  Read-only -- it never writes.
 *
 *   npm run check
 *
 * Answers the questions you actually want answered after a deploy:
 *   - did the question bank seed, and is the calibration block still exactly 3?
 *   - has anyone submitted, and did their attempt land intact?
 *   - are repeat sittings being flagged?
 *
 * Needs serviceAccountKey.json (same key as `npm run seed`). The Admin SDK
 * bypasses security rules, which is why this can read quiz_attempts at all --
 * the browser deliberately cannot.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const KEY_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  join(ROOT, "serviceAccountKey.json");

if (!existsSync(KEY_PATH)) {
  console.error(
    `\nNo service account key at ${KEY_PATH}\n` +
      "Firebase console > Project settings > Service accounts > Generate new private key.\n",
  );
  process.exit(1);
}

const key = JSON.parse(readFileSync(KEY_PATH, "utf8"));
initializeApp({ credential: cert(key) });
const db = getFirestore();

const LIMIT = Number(process.argv[2]) || 5;
const ok = (b) => (b ? "OK  " : "FAIL");

async function main() {
  console.log(`\nproject: ${key.project_id}\n${"=".repeat(58)}`);

  /* ---------------------------------------------------- question bank */
  const qSnap = await db.collection("questions").get();
  const calibration = qSnap.docs.filter((d) => d.data().block === "calibration");
  const technical = qSnap.docs.filter((d) => d.data().block === "technical");

  console.log("QUESTION BANK");
  console.log(`  [${ok(qSnap.size > 0)}] ${qSnap.size} questions total`);
  // k=3 is not cosmetic: the model was fitted for exactly three calibration
  // items, and loadBank() refuses a bank with any other count.
  console.log(
    `  [${ok(calibration.length === 3)}] calibration block: ${calibration.length} (must be 3)`,
  );
  console.log(`  [${ok(technical.length > 0)}] technical block: ${technical.length}`);

  const noAnswer = qSnap.docs.filter((d) => !d.data().correctAnswer);
  if (noAnswer.length) {
    console.log(
      `  [FAIL] ${noAnswer.length} question(s) missing correctAnswer: ` +
        noAnswer.map((d) => d.id).join(", "),
    );
  }

  const cfg = await db.collection("settings").doc("config").get();
  console.log(`  [${ok(cfg.exists)}] settings/config`);

  /* ---------------------------------------------------- attempts */
  const count = (await db.collection("quiz_attempts").count().get()).data().count;
  console.log(`\nATTEMPTS\n  ${count} submitted`);

  if (count === 0) {
    console.log("  (nobody has taken it yet)");
    console.log(
      "\n  If you just took it and this still says 0, the write was rejected --\n" +
        "  check that firestore.rules is deployed and the site's domain is in\n" +
        "  Firebase > Authentication > Settings > Authorized domains.",
    );
    return;
  }

  const retakes = (
    await db.collection("quiz_attempts").where("isRetake", "==", true).count().get()
  ).data().count;
  console.log(`  ${count - retakes} first sittings, ${retakes} retakes`);

  const recent = await db
    .collection("quiz_attempts")
    .orderBy("timestamp", "desc")
    .limit(LIMIT)
    .get();

  console.log(`\n  most recent ${recent.size}:`);
  for (const d of recent.docs) {
    const a = d.data();
    const items = Object.keys(a.behavioralMetrics || {}).length;
    const when = String(a.timestamp || "").slice(0, 19).replace("T", " ");
    console.log(
      `    ${(a.rollNumber || "?").padEnd(12)} #${a.attemptNumber ?? "?"}  ` +
        `${String(a.correctPercentage ?? "?").padStart(5)}%  ` +
        `calib=[${(a.calibrationRatings || []).join(",")}]  ` +
        `looMae=${a.calibrationLooMae ?? "?"}  ` +
        `${items} items  ${when}`,
    );
    if (a.studentEmail) console.log(`      ${a.studentEmail}`);
  }

  /* ---- integrity: the fields the export pipeline and the model depend on */
  console.log("\nINTEGRITY (most recent attempt)");
  const a = recent.docs[0].data();
  const metrics = Object.values(a.behavioralMetrics || {});
  const checks = [
    ["studentUid present", Boolean(a.studentUid)],
    ["attemptNumber present", Number.isInteger(a.attemptNumber)],
    ["3 calibration ratings", (a.calibrationRatings || []).length === 3],
    [
      "ratings all in 1-5",
      (a.calibrationRatings || []).every((r) => r >= 1 && r <= 5),
    ],
    ["every item has timeSpent", metrics.every((m) => typeof m.timeSpent === "number")],
    [
      "every item has a prediction",
      metrics.every((m) => typeof m.predictedConfidence === "number"),
    ],
    [
      "every item has a behavioural state",
      metrics.every((m) => typeof m.behaviouralState === "string"),
    ],
    [
      "calibration items carry their rating",
      metrics
        .filter((m) => m.block === "calibration")
        .every((m) => m.confidenceRating >= 1),
    ],
    [
      "technical items carry NO rating",
      metrics
        .filter((m) => m.block === "technical")
        .every((m) => m.confidenceRating === 0),
    ],
  ];
  for (const [label, pass] of checks) console.log(`  [${ok(pass)}] ${label}`);

  const failed = checks.filter(([, p]) => !p).length;
  console.log(
    `\n${failed === 0 ? "All integrity checks passed." : `${failed} check(s) FAILED.`}\n`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\ncheck failed:", err?.message || err);
    process.exit(1);
  },
);
