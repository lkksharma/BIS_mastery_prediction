/**
 * ConfidenceChart -- predicted confidence per question.
 *
 * Form: a line with a band, because the data's job is change-over-sequence with
 * an uncertainty attached to every point.  Styled after a seaborn `lineplot`
 * with `errorbar="sd"`: whitegrid, recessive axes, one hue per series, the band
 * drawn beneath the line.
 *
 * Two series, so a legend is always present and both are direct-labelled.
 * A table view of the same numbers lives under the chart (Results.jsx), which
 * is also the relief for the aqua slot's light-mode contrast.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";

const PAD = { top: 22, right: 62, bottom: 46, left: 46 };
const W = 780;
const H = 340;

const BUCKETS = [
  { name: "Low", from: 1, to: 2.5 },
  { name: "Medium", from: 2.5, to: 4.5 },
  { name: "High", from: 4.5, to: 5 },
];

export default function ConfidenceChart({ items }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const n = items.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = useCallback(
    (i) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    [n, plotW],
  );
  const y = useCallback(
    (v) => PAD.top + plotH - ((v - 1) / 4) * plotH,
    [plotH],
  );

  const geom = useMemo(() => {
    const pts = items.map((it, i) => {
      const c = it.prediction.confidence;
      const sd = it.prediction.sd;
      return {
        i,
        item: it,
        cx: x(i),
        cy: y(c),
        conf: c,
        lo: Math.max(1, c - sd),
        hi: Math.min(5, c + sd),
      };
    });

    const line = pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
    const bandTop = pts.map((p) => `${p.cx.toFixed(1)},${y(p.hi).toFixed(1)}`);
    const bandBot = pts
      .slice()
      .reverse()
      .map((p) => `${p.cx.toFixed(1)},${y(p.lo).toFixed(1)}`);
    const band = [...bandTop, ...bandBot].join(" ");

    const calibCount = items.filter((it) => it.isCalibration).length;

    return { pts, line, band, calibCount };
  }, [items, x, y]);

  const handleMove = (evt) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const touch = evt.touches && evt.touches[0];
    const clientX = touch ? touch.clientX : evt.clientX;
    const px = ((clientX - rect.left) / rect.width) * W;

    let best = null;
    let bestD = Infinity;
    for (const p of geom.pts) {
      const d = Math.abs(p.cx - px);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && bestD < plotW / Math.max(n, 1) + 24) setHover(best);
    else setHover(null);
  };

  // Direct labels: first point, last point, and the hovered one. Never every
  // point -- a number on all 15 marks is noise, not information.
  const labelled = new Set([0, n - 1]);

  const calibEndX =
    geom.calibCount > 0 && geom.calibCount < n
      ? (x(geom.calibCount - 1) + x(geom.calibCount)) / 2
      : null;

  return (
    <div className="chart-holder">
      <div className="legend">
        <span className="legend__item">
          <span
            className="legend__swatch"
            style={{ background: "var(--series-1)" }}
          />
          Predicted confidence
        </span>
        <span className="legend__item">
          <span className="legend__band" style={{ background: "var(--band)" }} />
          ±1 SD of the prediction
        </span>
        <span className="legend__item">
          <span
            className="legend__dot"
            style={{ background: "var(--series-2)" }}
          />
          Confidence you actually rated
        </span>
      </div>

      <div className="chart-wrap">
        <svg
          ref={svgRef}
          className="chart-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Predicted confidence for each of ${n} questions, on a 1 to 5 scale`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          onTouchStart={handleMove}
          onTouchMove={handleMove}
          onTouchEnd={() => setHover(null)}
        >
          {/* calibration region -- where ratings were collected */}
          {calibEndX !== null && (
            <>
              <rect
                x={PAD.left}
                y={PAD.top}
                width={calibEndX - PAD.left}
                height={plotH}
                fill="var(--surface-2)"
                opacity="0.75"
              />
              <line
                x1={calibEndX}
                y1={PAD.top}
                x2={calibEndX}
                y2={PAD.top + plotH}
                stroke="var(--border-strong)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.left + 6}
                y={PAD.top + 13}
                fontSize="10"
                fontWeight="700"
                fill="var(--text-muted)"
                letterSpacing="0.06em"
              >
                RATED
              </text>
              <text
                x={calibEndX + 7}
                y={PAD.top + 13}
                fontSize="10"
                fontWeight="700"
                fill="var(--text-muted)"
                letterSpacing="0.06em"
              >
                PREDICTED
              </text>
            </>
          )}

          {/* y grid + bucket boundaries */}
          {[1, 2, 3, 4, 5].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                y1={y(v)}
                x2={W - PAD.right}
                y2={y(v)}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 10}
                y={y(v) + 4}
                fontSize="11"
                textAnchor="end"
                fill="var(--text-muted)"
              >
                {v}
              </text>
            </g>
          ))}
          {[2.5, 4.5].map((v) => (
            <line
              key={v}
              x1={PAD.left}
              y1={y(v)}
              x2={W - PAD.right}
              y2={y(v)}
              stroke="var(--border-strong)"
              strokeWidth="1"
              strokeDasharray="2 4"
              opacity="0.7"
            />
          ))}
          {BUCKETS.map((b) => (
            <text
              key={b.name}
              x={W - PAD.right + 8}
              y={y((b.from + b.to) / 2) + 3.5}
              fontSize="10"
              fontWeight="600"
              textAnchor="start"
              fill="var(--text-muted)"
              opacity="0.9"
            >
              {b.name}
            </text>
          ))}

          {/* axes: left + bottom spine only, seaborn-style */}
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={PAD.top + plotH}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          <line
            x1={PAD.left}
            y1={PAD.top + plotH}
            x2={W - PAD.right}
            y2={PAD.top + plotH}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />

          {/* uncertainty band */}
          <polygon points={geom.band} fill="var(--band)" />

          {/* crosshair */}
          {hover && (
            <line
              x1={hover.cx}
              y1={PAD.top}
              x2={hover.cx}
              y2={PAD.top + plotH}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* predicted line */}
          <polyline
            points={geom.line}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* predicted markers -- 2px surface ring so they read over the band */}
          {geom.pts.map((p) => (
            <circle
              key={`p${p.i}`}
              cx={p.cx}
              cy={p.cy}
              r={hover && hover.i === p.i ? 6 : 4.5}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          ))}

          {/* the ratings the student actually gave */}
          {geom.pts
            .filter((p) => p.item.isCalibration)
            .map((p) => (
              <g key={`a${p.i}`}>
                <line
                  x1={p.cx}
                  y1={p.cy}
                  x2={p.cx}
                  y2={y(p.item.actual)}
                  stroke="var(--series-2)"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                  opacity="0.7"
                />
                <circle
                  cx={p.cx}
                  cy={y(p.item.actual)}
                  r="5.5"
                  fill="var(--series-2)"
                  stroke="var(--surface-1)"
                  strokeWidth="2"
                />
              </g>
            ))}

          {/* x labels */}
          {geom.pts.map((p) => (
            <text
              key={`x${p.i}`}
              x={p.cx}
              y={PAD.top + plotH + 18}
              fontSize="10.5"
              textAnchor="middle"
              fill={
                hover && hover.i === p.i ? "var(--text-primary)" : "var(--text-muted)"
              }
              fontWeight={hover && hover.i === p.i ? 700 : 400}
            >
              {p.i + 1}
            </text>
          ))}

          {/* selective direct labels */}
          {geom.pts
            .filter((p) => labelled.has(p.i))
            .map((p) => (
              <text
                key={`l${p.i}`}
                x={p.cx}
                y={p.cy - 11}
                fontSize="11"
                fontWeight="650"
                textAnchor={p.i === 0 ? "start" : "end"}
                fill="var(--text-secondary)"
              >
                {p.conf.toFixed(1)}
              </text>
            ))}

          {/* axis titles */}
          <text
            x={PAD.left + plotW / 2}
            y={H - 8}
            fontSize="11.5"
            fontWeight="600"
            textAnchor="middle"
            fill="var(--text-secondary)"
          >
            Question number
          </text>
          <text
            transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}
            x={14}
            y={PAD.top + plotH / 2}
            fontSize="11.5"
            fontWeight="600"
            textAnchor="middle"
            fill="var(--text-secondary)"
          >
            Confidence (1–5)
          </text>
        </svg>
      </div>

      {hover && <HoverCard point={hover} n={n} />}
    </div>
  );
}

function HoverCard({ point, n }) {
  const it = point.item;
  const p = it.prediction;
  // Keep the card inside the plot: flip it left once past the midpoint.
  const leftPct = (point.cx / W) * 100;
  const flip = leftPct > 58;

  return (
    <div
      className="tooltip"
      style={{
        left: `${Math.min(96, Math.max(4, leftPct))}%`,
        top: 42,
        transform: flip ? "translateX(-100%)" : "translateX(0)",
      }}
    >
      <div className="tooltip__title">
        Q{point.i + 1} of {n} · {it.isCalibration ? "Calibration" : "Technical"}
      </div>
      <div className="tooltip__row">
        <span>Predicted</span>
        <b>
          {p.confidence.toFixed(2)} · {p.label}
        </b>
      </div>
      {it.isCalibration && (
        <div className="tooltip__row">
          <span>You rated</span>
          <b>{it.actual}</b>
        </div>
      )}
      <div className="tooltip__row">
        <span>P({p.label})</span>
        <b>{(p.certainty * 100).toFixed(0)}%</b>
      </div>
      <div className="tooltip__row">
        <span>Answer</span>
        <b>{!it.selectedOption ? "skipped" : it.isCorrect ? "correct" : "wrong"}</b>
      </div>
      <div className="tooltip__row">
        <span>Time</span>
        <b>{it.timeSpent.toFixed(0)}s</b>
      </div>
    </div>
  );
}
