import React, { useEffect, useState } from "react";
import QuestionView, { ConfidenceScale } from "./QuestionView";

/**
 * Section 1 -- the calibration block.
 *
 * Strictly sequential and forward-only.  A student who can revise an earlier
 * rating after seeing later questions produces ratings that are no longer
 * independent reads of their own certainty, and the leave-one-out statistics
 * built from them would be self-referential.
 */
export default function CalibrationStage({
  questions,
  telemetry,
  onComplete,
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [ratings, setRatings] = useState({});

  const q = questions[idx];
  const selected = answers[q.id] || "";
  const rating = ratings[q.id] || 0;
  const last = idx === questions.length - 1;

  useEffect(() => {
    telemetry.enter(q.id);
  }, [q.id, telemetry]);

  const select = (opt) => {
    telemetry.select(q.id, opt);
    setAnswers((a) => ({ ...a, [q.id]: opt }));
  };

  const rate = (n) => {
    telemetry.setConfidence(q.id, n);
    setRatings((r) => ({ ...r, [q.id]: n }));
  };

  const next = () => {
    if (!selected || !rating) return;
    if (last) onComplete();
    else setIdx(idx + 1);
  };

  return (
    <div className="shell shell--narrow" style={{ paddingTop: 24 }}>
      <div className="progress" aria-hidden="true">
        {questions.map((item, i) => (
          <span
            key={item.id}
            className={`progress__seg ${
              i < idx
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
          chips={[{ label: "Section 1 · Reasoning" }]}
        />

        <ConfidenceScale value={rating} onChange={rate} disabled={!selected} />

        <div className="navrow">
          <span className="navnote">
            {!selected
              ? "Pick an answer, then rate your confidence."
              : !rating
                ? "Rate your confidence to continue."
                : last
                  ? "That is the calibration block. Section 2 has no rating step."
                  : " "}
          </span>
          <button
            type="button"
            className="btn btn--primary navrow__spacer"
            onClick={next}
            disabled={!selected || !rating}
          >
            {last ? "Start section 2" : "Next question"}
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 14, textAlign: "center" }}>
        Section 1 moves forward only — answers here cannot be revised.
      </p>
    </div>
  );
}
