import React, { useState } from "react";
import { signInWithGoogle, ALLOWED_DOMAINS } from "../config/firebase";

/** Google's mark, inlined. An external image would be one more thing that can
 *  fail to load on a lab machine behind a content filter. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function SignIn({ config, counts, authError }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // On success the auth listener in App.jsx advances the stage. On the
      // redirect path the page navigates away and never reaches here.
    } catch (err) {
      setError(err.message || "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = error || authError;

  return (
    <div className="shell shell--narrow" style={{ paddingTop: 56 }}>
      <div className="card" style={{ textAlign: "center" }}>
        <p className="eyebrow">Confidence study</p>
        <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{config.title}</h1>
        <p
          style={{
            color: "var(--text-secondary)",
            marginTop: 10,
            fontSize: 15,
            maxWidth: 460,
            marginInline: "auto",
          }}
        >
          {counts.calibration} reasoning questions where you rate your
          confidence, then {counts.technical} technical questions where we
          predict it. About {config.totalTimeAllowedMinutes} minutes.
        </p>

        {shown && (
          <div className="banner banner--warn" style={{ marginTop: 22, textAlign: "left" }}>
            {shown}
          </div>
        )}

        <button
          type="button"
          className="btn btn--google"
          onClick={go}
          disabled={busy}
          style={{ marginTop: 26 }}
        >
          {busy ? (
            "Opening Google…"
          ) : (
            <>
              <GoogleMark />
              Continue with Google
            </>
          )}
        </button>

        <p className="muted" style={{ marginTop: 16 }}>
          {ALLOWED_DOMAINS.length > 0
            ? `Use your ${ALLOWED_DOMAINS.map((d) => "@" + d).join(" or ")} account.`
            : "We record your name and email so your instructor can identify the attempt."}
        </p>
      </div>

      <p className="muted" style={{ marginTop: 18, textAlign: "center" }}>
        If a popup does not appear, allow popups for this site — we will fall
        back to a full-page redirect automatically.
      </p>
    </div>
  );
}
