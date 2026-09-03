import React, { useMemo, useState } from "react";
import ConfidenceChart from "./ConfidenceChart";
import { STATES, MODEL_METRICS } from "../model/predict";
import { CONFIDENCE_WORDS } from "./QuestionView";

const pct = (v) => `${(v * 100).toFixed(0)}%`;

export default function Results({ analysis, saveState, rollNumber, attemptNumber = 1 }) {
  const [view, setView] = useState("chart");
  const { items, calibrationResults, technicalResults, calibration } = analysis;

  const summary = useMemo(() => {
    const answered = items.filter((i) => i.selectedOption);
    const correct = answered.filter((i) => i.isCorrect);

    const meanPredicted =
      items.reduce((a, i) => a + i.prediction.confidence, 0) / items.length;

    const wrong = answered.filter((i) => !i.isCorrect);
    const confWrong = wrong.length
      ? wrong.reduce((a, i) => a + i.prediction.confidence, 0) / wrong.length
      : null;
    const confRight = correct.length
      ? correct.reduce((a, i) => a + i.prediction.confidence, 0) / correct.length
      : null;

    const states = {};
    for (const i of items) states[i.state] = (states[i.state] || 0) + 1;

    return {
      answered: answered.length,
      correct: correct.length,
      total: items.length,
      accuracy: answered.length ? correct.length / answered.length : 0,
      meanPredicted,
      confWrong,
      confRight,
      discrimination:
        confRight !== null && confWrong !== null ? confRight - confWrong : null,
      states,
      totalTime: items.reduce((a, i) => a + i.timeSpent, 0),
    };
  }, [items]);

  return (
    <div className="shell" style={{ paddingTop: 24 }}>
      {saveState === "failed" && (
        <div className="banner banner--warn">
          Your attempt could not be saved to Firestore, so it will not appear in
          the instructor export. Everything below was computed in this browser
          and is still accurate — take a screenshot if you need a record.
        </div>
      )}

      <div className="card">
        <p className="eyebrow">
          Attempt {rollNumber}
          {attemptNumber > 1 ? ` · sitting ${attemptNumber}` : ""}
        </p>
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em", marginBottom: 4 }}>
          Your confidence profile
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Three ratings from section 1, extended across all {summary.total}{" "}
          questions.
        </p>

        <div className="stats" style={{ marginTop: 20 }}>
          <div className="stat">
            <div className="stat__label">Score</div>
            <div className="stat__value">
              {summary.correct}
              <span style={{ fontSize: 15, color: "var(--text-muted)" }}>
                /{summary.total}
              </span>
            </div>
            <div className="stat__note">{pct(summary.accuracy)} of answered</div>
          </div>
          <div className="stat">
            <div className="stat__label">Mean predicted confidence</div>
            <div className="stat__value">{summary.meanPredicted.toFixed(2)}</div>
            <div className="stat__note">on the 1–5 scale</div>
          </div>
          <div className="stat">
            <div className="stat__label">Calibration LOO error</div>
            <div className="stat__value">{calibration.looMae.toFixed(2)}</div>
            <div className="stat__note">
              {calibration.reliability === "flat"
                ? "you rated all three the same"
                : `${calibration.reliability} agreement`}
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">Confidence discrimination</div>
            <div className="stat__value">
              {summary.discrimination === null
                ? "—"
                : `${summary.discrimination > 0 ? "+" : ""}${summary.discrimination.toFixed(2)}`}
            </div>
            <div className="stat__note">
              {summary.discrimination === null
                ? "needs both a right and a wrong answer"
                : summary.discrimination > 0.25
                  ? "you are more confident when right"
                  : summary.discrimination < -0.25
                    ? "more confident when wrong"
                    : "confidence barely separates them"}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Predicted confidence, question by question</h2>
          <p className="card__sub">
            The band is ±1 standard deviation of the prediction — it widens where
            the model is least sure. Orange marks are the three ratings you gave;
            the dashed drop from each shows how far the prediction sat from it
            when that rating was held out.
          </p>
        </div>

        <div className="toggle-row">
          <div className="seg" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === "chart"}
              onClick={() => setView("chart")}
            >
              Chart
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
        </div>

        {view === "chart" ? (
          <ConfidenceChart items={items} />
        ) : (
          <DataTable items={items} />
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Leave-one-out check on the calibration block</h2>
          <p className="card__sub">
            Each rating below was predicted from the other two only. This is the
            honest read on whether your three ratings hang together well enough
            to project forward.
          </p>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th className="num">You rated</th>
                <th className="num">Predicted from the other two</th>
                <th className="num">Error</th>
                <th>Answer</th>
              </tr>
            </thead>
            <tbody>
              {calibrationResults.map((r, i) => (
                <tr key={r.questionId}>
                  <td>Q{i + 1}</td>
                  <td className="num">
                    {r.actual} · {CONFIDENCE_WORDS[r.actual - 1]}
                  </td>
                  <td className="num">{r.prediction.confidence.toFixed(2)}</td>
                  <td className="num">{r.absError.toFixed(2)}</td>
                  <td>
                    <span
                      className={`chip ${r.isCorrect ? "chip--good" : "chip--bad"}`}
                    >
                      {r.isCorrect ? "Correct" : "Wrong"}
                    </span>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Mean absolute error</b>
                </td>
                <td className="num" />
                <td className="num" />
                <td className="num">
                  <b>{calibration.looMae.toFixed(2)}</b>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="note" style={{ marginTop: 16 }}>
          {calibration.spread === 0 ? (
            <>
              <strong>You gave all three questions the same rating.</strong> That
              leaves no within-student variation to learn from, so every
              prediction below leans almost entirely on that single level plus
              behaviour. Treat the per-question differences as weak.
            </>
          ) : calibration.reliability === "strong" ? (
            <>
              <strong>Your ratings are consistent</strong> — each one is
              recoverable from the other two to within{" "}
              {calibration.looMae.toFixed(2)} of a scale point. The projections
              onto section 2 rest on solid ground.
            </>
          ) : calibration.reliability === "moderate" ? (
            <>
              <strong>Your ratings are moderately consistent.</strong> An average
              miss of {calibration.looMae.toFixed(2)} scale points on the held-out
              rating means section 2's predictions carry real uncertainty — read
              the band, not the line.
            </>
          ) : (
            <>
              <strong>Your three ratings pull in different directions.</strong> A
              held-out rating misses by {calibration.looMae.toFixed(2)} scale
              points on average, so the section 2 predictions are the weakest
              case for this model. The ordering is more trustworthy than any
              individual value.
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Behavioural state</h2>
          <p className="card__sub">
            Not a prediction — a rule over what you did. Correctness crossed with
            whether you hesitated (changed an option, flagged the question, or
            spent longer than your own average on it).
          </p>
        </div>

        <div className="stats">
          {Object.entries(STATES)
            .filter(([key]) => summary.states[key])
            .map(([key, meta]) => (
              <div className="stat" key={key}>
                <div className="stat__label">{meta.label}</div>
                <div className="stat__value">{summary.states[key]}</div>
                <div className="stat__note">{meta.note}</div>
              </div>
            ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Question by question</h2>
        </div>
        <div>
          {items.map((it, i) => (
            <ReviewRow key={it.questionId} item={it} index={i} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">How to read this</h2>
        </div>
        <div className="stack-sm" style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
          <p>
            The model is a multinomial logistic regression over 23 features,
            fitted on {"16,990"} rated answers from 1,803 students and validated
            with 5-fold GroupKFold by student, scored only on questions whose
            ratings were withheld. It reaches{" "}
            <b>{pct(MODEL_METRICS.accuracy)} three-class accuracy</b> against a{" "}
            {pct(MODEL_METRICS.baseline)} majority-class baseline, with AUC{" "}
            {MODEL_METRICS.auc_ovr.toFixed(3)} and a worst-class recall of{" "}
            {MODEL_METRICS.min_class_recall.toFixed(2)}.
          </p>
          <p>
            Those figures come from calibration items drawn from the{" "}
            <em>same subject</em> as the predicted questions. This quiz
            calibrates on general reasoning items and predicts technical ones;
            cross-domain transfer measured r=0.557 against 0.794 within-subject,
            so expect several points below the numbers above. Read the ranking
            across questions rather than any single value.
          </p>
          <p>
            Confidence genuinely cannot be predicted from behaviour alone —
            without collected ratings the same family of models scores 47.8%,
            below the 50.1% baseline. The three ratings you gave are what make
            everything on this page possible.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ item, index }) {
  const state = STATES[item.state];
  const stateClass =
    item.state === "mastery"
      ? "chip--good"
      : item.state === "shaky"
        ? "chip--warn"
        : item.state === "skipped"
          ? ""
          : "chip--bad";

  return (
    <div className="review">
      <div className="review__head">
        <span className="chip chip--accent">Q{index + 1}</span>
        <span className="chip">
          {item.isCalibration ? "Calibration" : "Technical"}
        </span>
        <span className={`chip ${stateClass}`}>{state.label}</span>
        <span className="chip">
          Confidence {item.prediction.confidence.toFixed(1)} · {item.prediction.label}
          {item.isCalibration ? ` (you rated ${item.actual})` : ""}
        </span>
        <span className="chip">{item.timeSpent.toFixed(0)}s</span>
      </div>

      <p className="review__q">{item.text}</p>

      <div className="review__answers">
        <span>
          Your answer:{" "}
          <b
            style={{
              color: !item.selectedOption
                ? "var(--text-muted)"
                : item.isCorrect
                  ? "var(--good)"
                  : "var(--bad)",
            }}
          >
            {item.selectedOption || "not answered"}
          </b>
        </span>
        {!item.isCorrect && (
          <span>
            Correct answer: <b>{item.correctAnswer}</b>
          </span>
        )}
      </div>

      {item.explanation && <p className="review__body">{item.explanation}</p>}
    </div>
  );
}

function DataTable({ items }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Block</th>
            <th className="num">Predicted</th>
            <th className="num">±SD</th>
            <th>Class</th>
            <th className="num">P(class)</th>
            <th className="num">Rated</th>
            <th>Answer</th>
            <th className="num">Time (s)</th>
            <th className="num">Changes</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.questionId}>
              <td>{i + 1}</td>
              <td>{it.isCalibration ? "Calibration" : "Technical"}</td>
              <td className="num">{it.prediction.confidence.toFixed(2)}</td>
              <td className="num">{it.prediction.sd.toFixed(2)}</td>
              <td>{it.prediction.label}</td>
              <td className="num">{pct(it.prediction.certainty)}</td>
              <td className="num">{it.actual ?? "—"}</td>
              <td>
                {!it.selectedOption ? "skipped" : it.isCorrect ? "correct" : "wrong"}
              </td>
              <td className="num">{it.timeSpent.toFixed(0)}</td>
              <td className="num">{it.optionChanges}</td>
              <td>{STATES[it.state].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
