import React from "react";

const KEYS = ["A", "B", "C", "D", "E", "F"];

export const CONFIDENCE_WORDS = [
  "Just guessing",
  "Doubtful",
  "Unsure",
  "Fairly sure",
  "Certain",
];

/** Question text + options.  Shared by both stages so the technical block looks
 *  identical to the calibration block minus the rating widget -- if the two
 *  stages looked different, behaviour would shift between them and the model's
 *  telemetry features would not transfer. */
export default function QuestionView({
  question,
  index,
  total,
  selected,
  onSelect,
  chips = [],
}) {
  const pair = question.options.length === 2;

  return (
    <>
      <div className="qmeta">
        <span className="chip chip--accent">
          Question {index + 1} of {total}
        </span>
        {chips.map((c) => (
          <span key={c.label} className={`chip ${c.className || ""}`}>
            {c.label}
          </span>
        ))}
      </div>

      <p className="qtext">{question.text}</p>
      {question.prompt && <p className="qprompt">{question.prompt}</p>}

      <div
        className={`options ${pair ? "options--pair" : ""}`}
        role="radiogroup"
        aria-label="Answer options"
      >
        {question.options.map((opt, i) => {
          const on = selected === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={on}
              className={`option ${on ? "option--selected" : ""}`}
              onClick={() => onSelect(opt)}
            >
              <span className="option__key" aria-hidden="true">
                {KEYS[i]}
              </span>
              <span>{opt}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The 1–5 rating widget.  Calibration block only -- the technical block never
 *  renders this, which is the entire point of the design. */
export function ConfidenceScale({ value, onChange, disabled }) {
  return (
    <div className={`confidence ${value ? "confidence--set" : ""}`}>
      <div className="confidence__label">
        How confident are you in that answer?
      </div>
      <p className="confidence__hint">
        {disabled
          ? "Choose an answer first, then rate your confidence."
          : "Required. These three ratings are what let us estimate your confidence on the rest of the quiz."}
      </p>
      <div className="scale" role="radiogroup" aria-label="Confidence rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} — ${CONFIDENCE_WORDS[n - 1]}`}
            disabled={disabled}
            className={`scale__btn ${value === n ? "scale__btn--on" : ""}`}
            onClick={() => onChange(n)}
          >
            <span className="scale__num">{n}</span>
            <span className="scale__word">{CONFIDENCE_WORDS[n - 1]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
