import React, { useState } from "react";

/** Institutional addresses are usually the roll number, e.g. 102103045@thapar.edu
 *  or first.102103045@college.ac.in. Pre-fill when we can see one, but leave it
 *  editable -- a wrong guess the student cannot correct is worse than a blank. */
function guessRollNumber(email) {
  const local = String(email || "").split("@")[0];
  const digits = local.match(/\d{6,12}/);
  return digits ? digits[0] : "";
}

export default function Landing({
  config,
  counts,
  onStart,
  offline,
  account,
  priorAttempts = 0,
}) {
  const [rollNumber, setRollNumber] = useState(() =>
    guessRollNumber(account?.email),
  );
  const [cgpa, setCgpa] = useState("");
  const [touched, setTouched] = useState(false);

  const cgpaNum = parseFloat(cgpa);
  const cgpaBad = cgpa !== "" && (!Number.isFinite(cgpaNum) || cgpaNum < 0 || cgpaNum > 10);
  const canStart = rollNumber.trim().length >= 2 && !cgpaBad;

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!canStart) return;
    onStart({
      rollNumber: rollNumber.trim().toUpperCase(),
      cgpa: Number.isFinite(cgpaNum) ? cgpaNum : null,
    });
  };

  return (
    <div className="shell shell--narrow" style={{ paddingTop: 40 }}>
      {offline && (
        <div className="banner banner--warn">
          Firestore is not configured, so this attempt will not be saved. The
          quiz and the analysis still run end to end.
        </div>
      )}

      {priorAttempts > 0 && (
        <div className="banner banner--warn">
          You have already submitted {priorAttempts}{" "}
          {priorAttempts === 1 ? "attempt" : "attempts"}. You may take it again —
          this will be recorded as attempt {priorAttempts + 1}, and your
          instructor can tell the sittings apart.
        </div>
      )}

      <div className="card">
        <p className="eyebrow">Confidence study</p>
        <h1 style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{config.title}</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10, fontSize: 15 }}>
          Two sections, {counts.total} questions, about{" "}
          {config.totalTimeAllowedMinutes} minutes.
        </p>

        <div className="grid-2" style={{ marginTop: 24 }}>
          <div className="note note--accent">
            <strong>Section 1 — {counts.calibration} reasoning questions.</strong>
            <br />
            After each answer you rate how confident you are, 1 to 5. This is the
            calibration block.
          </div>
          <div className="note">
            <strong>Section 2 — {counts.technical} technical questions.</strong>
            <br />
            No confidence rating. We predict it instead, from your calibration
            ratings and how you work through each question.
          </div>
        </div>

        <p style={{ marginTop: 20, fontSize: 13.5, color: "var(--text-secondary)" }}>
          At the end you get a chart of your predicted confidence on every
          question, plotted against the three you actually rated.
        </p>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Before you begin</h2>
          <p className="card__sub">
            {account
              ? `Signed in as ${account.email}. Your roll number links the attempt to your class record.`
              : "Your roll number identifies the attempt. Nothing else is collected."}
          </p>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="roll">
              Roll number
            </label>
            <input
              id="roll"
              className="input"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="e.g. 102103045"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck="false"
              required
            />
            {touched && rollNumber.trim().length < 2 && (
              <p className="field__hint" style={{ color: "var(--bad)" }}>
                Enter your roll number to continue.
              </p>
            )}
          </div>

          {config.collectCgpa && (
            <div className="field">
              <label className="field__label" htmlFor="cgpa">
                CGPA <span style={{ color: "var(--text-muted)" }}>(optional)</span>
              </label>
              <input
                id="cgpa"
                className="input"
                value={cgpa}
                onChange={(e) => setCgpa(e.target.value)}
                placeholder="e.g. 8.2"
                inputMode="decimal"
                autoComplete="off"
              />
              <p
                className="field__hint"
                style={cgpaBad ? { color: "var(--bad)" } : undefined}
              >
                {cgpaBad
                  ? "Enter a number between 0 and 10, or leave it blank."
                  : "A small input to the model. Leaving it blank costs very little."}
              </p>
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary btn--wide"
            disabled={!canStart}
            style={{ marginTop: 8 }}
          >
            Start section 1
          </button>
        </form>
      </div>

      <p className="muted" style={{ marginTop: 16, textAlign: "center" }}>
        Time on each question is measured only while this tab is in focus.
      </p>
    </div>
  );
}
