/**
 * Firebase init + Google sign-in.
 *
 * Firestore is the only backend service in this app -- there is no server, no
 * Lambda, no API gateway.  Auth exists so the security rules have a stable
 * `request.auth.uid` to bind each attempt to, and so repeat sittings by the
 * same student are identifiable rather than anonymous.
 *
 * Config comes from Vite env vars (see .env.example).  Everything here is a
 * public client identifier by design; access control lives in firestore.rules.
 */
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};

export const isConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId,
);

/**
 * Optional institutional allowlist, e.g. VITE_ALLOWED_EMAIL_DOMAINS="thapar.edu"
 * (comma-separated for several).  Empty = any Google account may sign in.
 *
 * This is a UX gate, not a security boundary: a determined user can always call
 * the API directly. To make it enforceable, uncomment the matching check in
 * firestore.rules so the server rejects the write too.
 */
export const ALLOWED_DOMAINS = String(
  import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || "",
)
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

export function isDomainAllowed(email) {
  if (ALLOWED_DOMAINS.length === 0) return true;
  const domain = String(email || "").toLowerCase().split("@")[1];
  return Boolean(domain) && ALLOWED_DOMAINS.includes(domain);
}

export class DomainNotAllowedError extends Error {
  constructor(email) {
    super(
      `${email || "That account"} is not an accepted address. ` +
        `Sign in with your ${ALLOWED_DOMAINS.map((d) => "@" + d).join(" or ")} account.`,
    );
    this.name = "DomainNotAllowedError";
  }
}

let app = null;
let auth = null;
let db = null;
let provider = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  provider = new GoogleAuthProvider();
  // Always show the chooser. Students share lab machines, and silently reusing
  // whichever account the browser last used would file the attempt under the
  // wrong person.
  provider.setCustomParameters({ prompt: "select_account" });
  if (ALLOWED_DOMAINS.length === 1) {
    // A hint only -- Google still lets the user pick another account, which is
    // why isDomainAllowed() re-checks after sign-in.
    provider.setCustomParameters({
      prompt: "select_account",
      hd: ALLOWED_DOMAINS[0],
    });
  }
}

export { app, auth, db };

const toProfile = (user) =>
  user
    ? {
        uid: user.uid,
        email: user.email || "",
        name: user.displayName || "",
        photo: user.photoURL || "",
      }
    : null;

/** Subscribe to auth state. Returns an unsubscribe function. */
export function watchAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    if (user && !isDomainAllowed(user.email)) {
      // Wrong domain slipped through the chooser -- drop the session rather
      // than let them start a quiz that will be rejected at submit time.
      signOut(auth).catch(() => {});
      callback(null, new DomainNotAllowedError(user.email));
      return;
    }
    callback(toProfile(user));
  });
}

/**
 * Popup first, redirect as the fallback.  Popups are blocked outright in some
 * in-app browsers (Instagram, LinkedIn, several Android webviews) which students
 * do open links in, and a silent failure there looks like a broken site.
 */
export async function signInWithGoogle() {
  if (!auth) throw new Error("Firebase is not configured.");

  try {
    const cred = await signInWithPopup(auth, provider);
    if (!isDomainAllowed(cred.user.email)) {
      await signOut(auth);
      throw new DomainNotAllowedError(cred.user.email);
    }
    return toProfile(cred.user);
  } catch (err) {
    if (err instanceof DomainNotAllowedError) throw err;

    const code = err?.code || "";
    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment" ||
      code === "auth/cancelled-popup-request"
    ) {
      await signInWithRedirect(auth, provider);
      return null; // the page navigates away; resolveRedirect() picks it up
    }
    if (code === "auth/popup-closed-by-user") return null; // user changed their mind
    throw err;
  }
}

/** Call once on boot to collect the result of a redirect sign-in. */
export async function resolveRedirect() {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    if (!result) return null;
    if (!isDomainAllowed(result.user.email)) {
      await signOut(auth);
      throw new DomainNotAllowedError(result.user.email);
    }
    return toProfile(result.user);
  } catch (err) {
    if (err instanceof DomainNotAllowedError) throw err;
    console.warn("Redirect sign-in failed:", err?.code || err);
    return null;
  }
}

export async function signOutUser() {
  if (!auth) return;
  await signOut(auth);
}
