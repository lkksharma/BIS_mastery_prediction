import React, { useRef, useState } from "react";
import { CHART_WINDOW } from "../lib/series";

/**
 * Progress across a quiz series: one stacked column per quiz, for the last
 * CHART_WINDOW (5) quizzes. The series is open-ended, so the chart slides:
 * once more than five quizzes are taken, the oldest drop off the left. The
 * table view still lists every quiz in the series.
 *
 * The column's height is the score (% correct), split into the answers that
 * were correct without hesitating (mastery) and those correct after
 * hesitating. Mastery is a subset of the score -- as two lines they coincide
 * whenever every correct answer was confident, and one line vanishes under the
 * other -- so part-to-whole columns it is. The total sits on top of each column.
 *
 * Series colours are categorical slots 1 and 3, the same as ConfidenceChart;
 * checked with the dataviz validator (CVD dE 23.1 light / 19.6 dark). Slot 3 is
 * under 3:1 on the light surface, so the total labels and the table view are
 * always there.
 *
 * Until five quizzes are taken, the remaining slots are drawn empty, so the
 * student sees where the next ones will land.
 */
// Narrow on purpose: five columns still read fine at phone width.
const W = 420;
const H = 250;
const PAD = { top: 26, right: 8, bottom: 46, left: 46 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const SERIES = [
  { key: "masteryPct", label: "Correct without hesitating", color: "var(--series-1)" },
  { key: "shakyPct", label: "Correct after hesitating", color: "var(--series-3)" },
];
const BAR = 50;
const GAP = 2; // surface gap between stacked segments

const y = (pct) => PAD.top + (1 - pct / 100) * plotH;
const fmt = (v) => `${Math.round(v)}%`;

export default function ProgressChart({ levels, currentLevel }) {
  const [view, setView] = useState("chart");
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const allPoints = [...levels]
    .sort((a, b) => a.level - b.level)
    .map((p) => ({ ...p, shakyPct: Math.max(0, p.scorePct - p.masteryPct) }));

  // The visible window: the last CHART_WINDOW quiz numbers, ending at the
  // latest one taken -- or quiz 1..5 while fewer than five exist.
  const latest = allPoints.length ? allPoints[allPoints.length - 1].level : 1;
  const first = Math.max(1, latest - CHART_WINDOW + 1);
  const slots = Array.from({ length: CHART_WINDOW }, (_, i) => first + i);
  const lastSlot = slots[slots.length - 1];
  const points = allPoints.filter((p) => p.level >= first);
  const hidden = allPoints.length - points.length;

  // Column centres: one equal slot per visible quiz.
  const x = (level) => PAD.left + ((level - first + 0.5) / CHART_WINDOW) * plotW;

  const handleMove = (evt) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const touch = evt.touches && evt.touches[0];
    const px = (((touch ? touch.clientX : evt.clientX) - rect.left) / rect.width) * W;
    let best = null;
    for (const p of points) if (!best || Math.abs(x(p.level) - px) < Math.abs(x(best.level) - px)) best = p;
    setHover(best && Math.abs(x(best.level) - px) < plotW / (CHART_WINDOW * 2) ? best : null);
  };

  return (
    <div>
      <div className="toggle-row">
        <div className="legend" style={{ margin: 0 }}>
          {SERIES.map((s) => (
            <span key={s.key} className="legend__item">
              <span className="legend__swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Progress view">
          {["chart", "table"].map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quiz</th>
                <th className="num">Score</th>
                <th className="num">Without hesitating</th>
                <th className="num">After hesitating</th>
                <th>Focused on</th>
              </tr>
            </thead>
            <tbody>
              {allPoints.map((p) => {
                const level = p.level;
                return (
                  <tr key={level}>
                    <td>
                      Quiz {level}
                      {level === currentLevel ? " (this one)" : ""}
                    </td>
                    <td className="num">{`${p.score}/${p.total} · ${fmt(p.scorePct)}`}</td>
                    <td className="num">{fmt(p.masteryPct)}</td>
                    <td className="num">{fmt(p.shakyPct)}</td>
                    <td>{level === 1 ? "Main quiz" : p.focusTopics.join(", ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-holder chart-fit">
          <div className="chart-wrap">
            <svg
              ref={svgRef}
              className="chart-svg chart-svg--fit"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Percent correct, split by hesitation, for quizzes ${points[0]?.level ?? 1} to ${latest} of this series`}
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
              onTouchStart={handleMove}
              onTouchMove={handleMove}
              onTouchEnd={() => setHover(null)}
            >
              {[0, 25, 50, 75, 100].map((t) => (
                <g key={t}>
                  <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
                  <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-muted)">
                    {t}%
                  </text>
                </g>
              ))}
              {slots.map((level) => {
                const taken = points.some((p) => p.level === level);
                return (
                  <g key={level}>
                    <text
                      x={x(level)}
                      y={H - PAD.bottom + 20}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight={level === currentLevel ? 650 : 500}
                      fill={taken ? "var(--text-secondary)" : "var(--text-muted)"}
                    >
                      Quiz {level}
                    </text>
                    {!taken && (
                      <text x={x(level)} y={H - PAD.bottom + 36} textAnchor="middle" fontSize="11.5" fill="var(--text-muted)">
                        {level === latest + 1 ? "up next" : "not yet"}
                      </text>
                    )}
                  </g>
                );
              })}

              {slots.map((level) => {
                const p = points.find((q) => q.level === level);
                const x0 = x(level) - BAR / 2;
                if (!p) {
                  return (
                    <rect
                      key={level}
                      x={x0}
                      y={PAD.top}
                      width={BAR}
                      height={plotH}
                      rx="4"
                      fill="none"
                      stroke="var(--border)"
                      strokeDasharray="4 4"
                    />
                  );
                }
                const base = y(0);
                const hM = (p.masteryPct / 100) * plotH;
                const hS = (p.shakyPct / 100) * plotH;
                const hot = hover?.level === p.level;
                return (
                  <g key={level} opacity={hover && !hot ? 0.55 : 1}>
                    {/* Rounded only at the data end; the base stays square on the axis. */}
                    {hM > 0 && (
                      <path
                        d={columnPath(x0, base - hM, BAR, hM, hS > GAP ? 0 : 4)}
                        fill={SERIES[0].color}
                      />
                    )}
                    {hS > GAP && (
                      <path
                        d={columnPath(x0, base - hM - hS, BAR, hS - (hM > 0 ? GAP : 0), 4)}
                        fill={SERIES[1].color}
                      />
                    )}
                    <text
                      x={x(level)}
                      y={base - hM - hS - 8}
                      textAnchor="middle"
                      fontSize="13.5"
                      fontWeight="650"
                      fill="var(--text-primary)"
                    >
                      {fmt(p.scorePct)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {hover && (
            <div
              className="tooltip"
              style={
                // Beside the column, never over it: right of it, except for
                // the right-hand columns, which have no room on that side.
                hover.level < lastSlot - 1
                  ? { left: `${((x(hover.level) + BAR / 2 + 8) / W) * 100}%`, top: 8 }
                  : { left: `${((x(hover.level) - BAR / 2 - 8) / W) * 100}%`, top: 8, transform: "translateX(-100%)" }
              }
            >
              <div className="tooltip__title">Quiz {hover.level}</div>
              <div className="tooltip__row">
                <span>Score</span>
                <b>
                  {hover.score}/{hover.total} · {fmt(hover.scorePct)}
                </b>
              </div>
              <div className="tooltip__row">
                <span>Without hesitating</span>
                <b>{fmt(hover.masteryPct)}</b>
              </div>
              <div className="tooltip__row">
                <span>After hesitating</span>
                <b>{fmt(hover.shakyPct)}</b>
              </div>
              {hover.level > 1 && hover.focusTopics.length > 0 && (
                <div className="tooltip__row" style={{ display: "block" }}>
                  <span>Focused on</span>
                  <div style={{ marginTop: 2 }}>{hover.focusTopics.join(", ")}</div>
                </div>
              )}
            </div>
          )}
          {hidden > 0 && (
            <p className="muted" style={{ marginTop: 6, fontSize: 12.5, textAlign: "center" }}>
              Showing your last {CHART_WINDOW} quizzes. Switch to Table to see all {allPoints.length}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A column whose top corners are rounded by `r` and whose base is square. */
function columnPath(x0, top, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  const bottom = top + h;
  return [
    `M${x0},${bottom}`,
    `V${top + rr}`,
    `Q${x0},${top} ${x0 + rr},${top}`,
    `H${x0 + w - rr}`,
    `Q${x0 + w},${top} ${x0 + w},${top + rr}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}
