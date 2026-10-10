import React, { useEffect, useRef, useState } from "react";
import { MAX_LEVEL } from "../lib/series";

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
  series = null,
  historyStatus = "idle",
  onResume,
  onContinue,
}) {
  const [rollNumber, setRollNumber] = useState(() =>
    guessRollNumber(account?.email),
  );
  const rollRef = useRef(null);

  // The history arrives after first render; reuse the roll number last given.
  const lastRoll = series?.lastAttempt?.rollNumber;
  useEffect(() => {
    if (lastRoll) setRollNumber((r) => r || lastRoll);
  }, [lastRoll]);
  const [cgpa, setCgpa] = useState("");
  const [touched, setTouched] = useState(false);

  const cgpaNum = parseFloat(cgpa);
  const cgpaBad = cgpa !== "" && (!Number.isFinite(cgpaNum) || cgpaNum < 0 || cgpaNum > 10);
  const canStart = rollNumber.trim().length >= 2 && !cgpaBad;

  const studentInfo = () => ({
    rollNumber: rollNumber.trim().toUpperCase(),
    cgpa: Number.isFinite(cgpaNum) ? cgpaNum : null,
  });

  /** Every way in needs a roll number; send the student to it if missing. */
  const go = (action) => {
    setTouched(true);
    if (!canStart) {
      rollRef.current?.focus();
      rollRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    action(studentInfo());
  };

  const submit = (e) => {
    e.preventDefault();
    go(onStart);
  };

  return (
    <div className="shell shell--narrow" style={{ paddingTop: 40 }}>
      {offline && (
        <div className="banner banner--warn">
          Firestore is not configured, so this attempt will not be saved. The
          quiz and the analysis still run end to end.
        </div>
      )}

      {series && (
        <SeriesCard
          series={series}
          onResume={() => go(onResume)}
          onContinue={() => go(onContinue)}
        />
      )}

      {historyStatus === "loading" && !series && (
        <p className="muted" style={{ marginBottom: 12 }}>
          Checking for a quiz series in progress…
        </p>
      )}

      {priorAttempts > 0 && !series && (
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
              ref={rollRef}
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
            {series ? `Start a new quiz 1 of ${MAX_LEVEL}` : "Start section 1"}
          </button>
          {series && (
            <p className="field__hint" style={{ textAlign: "center", marginTop: 8 }}>
              Starts a new series from the main quiz. Your earlier attempts stay
              recorded.
            </p>
          )}
        </form>
      </div>

      <p className="muted" style={{ marginTop: 16, textAlign: "center" }}>
        Time on each question is measured only while this tab is in focus.
      </p>
    </div>
  );
}

/* Where the student is in their latest series, and the one sensible next step. */
function SeriesCard({ series, onResume, onContinue }) {
  const done = new Map(series.levels.map((l) => [l.level, l]));
  const pendingLevel = series.pending?.level;

  return (
    <div className="card">
      <p className="eyebrow">Your quiz series</p>
      <ol className="series-steps">
        {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((level) => {
          const d = done.get(level);
          const state = d
            ? "done"
            : level === pendingLevel
              ? "paused"
              : level === series.nextLevel
                ? "next"
                : "later";
          return (
            <li key={level} className={`series-step series-step--${state}`}>
              <span className="series-step__dot" aria-hidden="true">
                {d ? "✓" : level}
              </span>
              <span className="series-step__label">
                Quiz {level}
                <span className="series-step__meta">
                  {d
                    ? `${d.score}/${d.total} correct`
                    : state === "paused"
                      ? "unfinished"
                      : state === "next"
                        ? "up next"
                        : "locked"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {series.pending ? (
        <>
          <p className="series-copy">
            <strong>
              You started quiz {series.pending.level} of {MAX_LEVEL} but did not
              finish it.
            </strong>{" "}
            It focuses on {listTopics(series.pending.focusTopics)}. Resuming
            gives you the same questions, from the first one again.
          </p>
          <button type="button" className="btn btn--primary btn--wide" onClick={onResume}>
            Resume quiz {series.pending.level} of {MAX_LEVEL}
          </button>
        </>
      ) : series.nextLevel ? (
        <>
          <p className="series-copy">
            <strong>
              Quiz {series.nextLevel} of {MAX_LEVEL} is built from your answers
              in quiz {series.nextLevel - 1}.
            </strong>{" "}
            New questions aimed at the topics you found hardest, so you can see
            whether they have improved.
          </p>
          <button type="button" className="btn btn--primary btn--wide" onClick={onContinue}>
            Take quiz {series.nextLevel} of {MAX_LEVEL}
          </button>
        </>
      ) : (
        <p className="series-copy">
          <strong>You have finished all {MAX_LEVEL} quizzes in this series.</strong>{" "}
          Start a new series below to go round again.
        </p>
      )}
    </div>
  );
}

function listTopics(topics = []) {
  if (topics.length === 0) return "your weakest topics";
  if (topics.length === 1) return topics[0];
  return `${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}`;
}
