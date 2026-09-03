import React, { useEffect, useState } from "react";
import QuestionView from "./QuestionView";

/**
 * Section 2 -- technical block.  No confidence widget anywhere in this file,
 * by design.  Free navigation, mark-for-review, and a jump palette: the point
 * is to let real navigation behaviour happen, because option changes, review
 * clicks and revisit time are exactly what the model reads.
 */
export default function TechnicalStage({ questions, telemetry, onSubmit }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flags, setFlags] = useState({});
  const [visited, setVisited] = useState({ [questions[0].id]: true });
  const [confirming, setConfirming] = useState(false);

  const q = questions[idx];
  const selected = answers[q.id] || "";
  const answeredCount = Object.values(answers).filter(Boolean).length;

  useEffect(() => {
    telemetry.enter(q.id);
    setVisited((v) => (v[q.id] ? v : { ...v, [q.id]: true }));
  }, [q.id, telemetry]);

  const go = (i) => {
    if (i < 0 || i >= questions.length) return;
    setIdx(i);
  };

  const select = (opt) => {
    telemetry.select(q.id, opt);
    setAnswers((a) => ({ ...a, [q.id]: opt }));
  };

  const toggleFlag = () => {
    const on = telemetry.toggleReview(q.id);
    setFlags((f) => ({ ...f, [q.id]: on }));
  };

  if (confirming) {
    const unanswered = questions.length - answeredCount;
    const flagged = Object.values(flags).filter(Boolean).length;
    return (
      <div className="shell shell--narrow" style={{ paddingTop: 40 }}>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Submit section 2?</h2>
            <p className="card__sub">
              After submitting you cannot change anything.
            </p>
          </div>
          <div className="stats" style={{ marginBottom: 20 }}>
            <div className="stat">
              <div className="stat__label">Answered</div>
              <div className="stat__value">
                {answeredCount}
                <span style={{ fontSize: 15, color: "var(--text-muted)" }}>
                  /{questions.length}
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">Unanswered</div>
              <div className="stat__value">{unanswered}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Flagged</div>
              <div className="stat__value">{flagged}</div>
            </div>
          </div>
          <div className="navrow">
            <button
              type="button"
              className="btn"
              onClick={() => setConfirming(false)}
            >
              Keep working
            </button>
            <button
              type="button"
              className="btn btn--primary navrow__spacer"
              onClick={onSubmit}
            >
              Submit and see my analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ paddingTop: 24 }}>
      <div className="progress" aria-hidden="true">
        {questions.map((item, i) => (
          <span
            key={item.id}
            className={`progress__seg ${
              answers[item.id]
                ? "progress__seg--done"
                : i === idx
                  ? "progress__seg--current"
                  : ""
            }`}
          />
        ))}
      </div>

      <div className="card">
        <QuestionView
          question={q}
          index={idx}
          total={questions.length}
          selected={selected}
          onSelect={select}
          chips={[
            { label: "Section 2 · Technical" },
            ...(flags[q.id]
              ? [{ label: "Flagged for review", className: "chip--warn" }]
              : []),
          ]}
        />

        <div className="navrow">
          <button
            type="button"
            className="btn"
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
          >
            Previous
          </button>
          <button type="button" className="btn btn--ghost" onClick={toggleFlag}>
            {flags[q.id] ? "Unflag" : "Flag for review"}
          </button>
          <div className="navrow__spacer" />
          {idx < questions.length - 1 ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => go(idx + 1)}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setConfirming(true)}
            >
              Review and submit
            </button>
          )}
        </div>

        <div className="jump">
          {questions.map((item, i) => {
            const cls = flags[item.id]
              ? "jump__btn--flagged"
              : answers[item.id]
                ? "jump__btn--answered"
                : "";
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`Go to question ${i + 1}`}
                aria-current={i === idx ? "true" : undefined}
                className={`jump__btn ${cls} ${i === idx ? "jump__btn--current" : ""}`}
                onClick={() => go(i)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="navrow" style={{ justifyContent: "center" }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setConfirming(true)}
        >
          Submit early ({answeredCount}/{questions.length} answered)
        </button>
      </div>
    </div>
  );
}
