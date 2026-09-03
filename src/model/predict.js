/**
 * predict.js -- browser-side confidence prediction.
 *
 * Mirrors scripts/fit_web_model.py exactly: same feature list, same order, same
 * clipping, same standardisation.  If you change one, change the other.
 *
 * Why this runs in the browser: the backend is Firestore only (no inference
 * server), so the model is a multinomial logistic regression + a ridge
 * regression -- two small weight matrices in coefficients.json.
 *
 * The load-bearing inputs are the leave-one-out statistics over the student's
 * CALIBRATION ratings.  Without collected ratings the model is anti-predictive
 * (CONTEXT.md sec.6: 47.8% at k=0, below the 50.1% majority baseline), which is
 * the whole reason the calibration block exists.
 */

import COEF from "./coefficients.json";

export const CLASS_NAMES = COEF.logistic.classes; // ["Low","Medium","High"]
export const CLASS_CENTRES = COEF.class_centres; // [1.5, 3.5, 5.0]
export const MODEL_METRICS = COEF.metrics;
export const MODEL_META = COEF._meta;

const FEATURES = COEF.features;
const MU = COEF.scaler.mean;
const SD = COEF.scaler.scale;
const W = COEF.logistic.coef; // [3][n_features]
const B = COEF.logistic.intercept; // [3]
const RW = COEF.ridge.coef; // [n_features]
const RB = COEF.ridge.intercept;

const DIFF_MAP = {
  "very easy": 1,
  easy: 2,
  medium: 3,
  moderate: 3,
  hard: 4,
  difficult: 4,
  "very hard": 5,
};

const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const log1p = (v) => Math.log(1 + Math.max(0, v));

/* ------------------------------------------------------------------ *
 * Leave-one-out statistics over the calibration ratings.
 *
 * `excludeIndex` is the position within `ratings` to drop.  Pass -1 (or
 * anything out of range) to use the whole block -- that is what every
 * technical question does, since none of them contributed a rating.
 * ------------------------------------------------------------------ */
export function looStats(ratings, excludeIndex = -1) {
  const r = ratings.filter((v, i) => i !== excludeIndex && Number.isFinite(v));
  if (r.length === 0) return null;

  const n = r.length;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const min = Math.min(...r);
  const max = Math.max(...r);

  return {
    calib_mean: mean,
    calib_std: Math.sqrt(variance),
    calib_min: min,
    calib_max: max,
    calib_range: max - min,
    calib_high_frac: r.filter((v) => v === 5).length / n,
    calib_low_frac: r.filter((v) => v <= 2).length / n,
    n,
  };
}

/* ------------------------------------------------------------------ *
 * Attempt-level aggregates -- computed once per submission.
 * `items` is the full ordered list of rows (calibration + technical).
 * ------------------------------------------------------------------ */
export function attemptContext(items) {
  const times = items.map((it) => clip(it.timeSpent, 0, 900));
  const logTimes = times.map(log1p);
  const meanLogTime = logTimes.reduce((a, b) => a + b, 0) / (logTimes.length || 1);
  const totalTime = times.reduce((a, b) => a + b, 0);
  const changes = items.map((it) => clip(it.optionChanges, 0, 10));

  return {
    meanLogTime,
    att_log_total_time: log1p(totalTime),
    att_mean_changes: changes.reduce((a, b) => a + b, 0) / (changes.length || 1),
    att_n_items: items.length,
    att_unans_frac:
      items.filter((it) => !it.selectedOption).length / (items.length || 1),
    n: items.length,
  };
}

/* ------------------------------------------------------------------ *
 * Feature vector for one question.
 * ------------------------------------------------------------------ */
export function buildFeatures(item, index, ctx, calib, cgpa) {
  const time = clip(item.timeSpent, 0, 900);
  const logTime = log1p(time);
  const timeRel = logTime - ctx.meanLogTime;
  const changes = clip(item.optionChanges, 0, 10);
  const reviews = clip(item.reviewClickCount, 0, 10);
  const marked = item.markedForReview ? 1 : 0;

  const difficulty =
    DIFF_MAP[String(item.difficulty || "medium").trim().toLowerCase()] ?? 3;

  const f = {
    calib_mean: calib.calib_mean,
    calib_std: calib.calib_std,
    calib_min: calib.calib_min,
    calib_max: calib.calib_max,
    calib_range: calib.calib_range,
    calib_high_frac: calib.calib_high_frac,
    calib_low_frac: calib.calib_low_frac,

    is_correct: item.isCorrect ? 1 : 0,
    log_time: logTime,
    time_rel_attempt: timeRel,
    option_changes: changes,
    any_option_change: changes > 0 ? 1 : 0,
    marked_for_review: marked,
    review_click_count: reviews,
    hesitated: changes > 0 || marked > 0 || reviews > 0 || timeRel > 0 ? 1 : 0,
    q_position_frac: ctx.n > 1 ? index / (ctx.n - 1) : 0,

    q_difficulty_num: difficulty,
    q_is_theory: /theor/i.test(String(item.type || "")) ? 1 : 0,

    att_log_total_time: ctx.att_log_total_time,
    att_unans_frac: ctx.att_unans_frac,
    att_mean_changes: ctx.att_mean_changes,
    att_n_items: ctx.att_n_items,
    student_cgpa: Number.isFinite(cgpa) ? cgpa : null,
  };

  // Standardise in the training feature order.  A null (CGPA not supplied)
  // becomes 0 in z-space, i.e. the training mean -- the neutral value.
  return FEATURES.map((name, j) => {
    const raw = f[name];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) return 0;
    return SD[j] === 0 ? 0 : (raw - MU[j]) / SD[j];
  });
}

/* ------------------------------------------------------------------ *
 * The two heads.
 * ------------------------------------------------------------------ */
function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function predictOne(x) {
  const logits = W.map((row, k) => row.reduce((a, w, j) => a + w * x[j], B[k]));
  const probs = softmax(logits);

  // Ridge head: the continuous 1-5 rating the student would most likely give.
  const ridge = clip(RW.reduce((a, w, j) => a + w * x[j], RB), 1, 5);

  // Expected value under the class distribution, and its spread.  The spread is
  // what the chart's band shows -- it widens exactly where the model is unsure.
  const expected = probs.reduce((a, p, k) => a + p * CLASS_CENTRES[k], 0);
  const variance = probs.reduce(
    (a, p, k) => a + p * (CLASS_CENTRES[k] - expected) ** 2,
    0,
  );

  const argmax = probs.indexOf(Math.max(...probs));

  return {
    probs,
    label: CLASS_NAMES[argmax],
    labelIndex: argmax,
    confidence: (0.5 * ridge + 0.5 * expected), // blended point estimate, 1-5
    ridge,
    expected,
    sd: Math.sqrt(variance),
    certainty: Math.max(...probs),
  };
}

/* ------------------------------------------------------------------ *
 * Behavioural state taxonomy -- CONTEXT.md sec.13.
 * Deterministic rule over logged fields; no model, no caveat.
 * ------------------------------------------------------------------ */
export const STATES = {
  mastery: { label: "Mastery", note: "Correct, answered without hesitation" },
  shaky: { label: "Shaky", note: "Correct, but hesitated on the way" },
  misconception: {
    label: "Misconception",
    note: "Wrong and confident — a belief to correct",
  },
  confusion: { label: "Confusion", note: "Wrong after visible hesitation" },
  skipped: { label: "Not answered", note: "No option selected" },
};

export function behaviouralState(item, ctx) {
  if (!item.selectedOption) return "skipped";
  const timeRel = log1p(clip(item.timeSpent, 0, 900)) - ctx.meanLogTime;
  const hesitated =
    clip(item.optionChanges, 0, 10) > 0 ||
    item.markedForReview ||
    clip(item.reviewClickCount, 0, 10) > 0 ||
    timeRel > 0;

  if (item.isCorrect) return hesitated ? "shaky" : "mastery";
  return hesitated ? "confusion" : "misconception";
}

/* ------------------------------------------------------------------ *
 * Top-level scoring for a whole attempt.
 *
 * calibrationItems -- the 3 rated rows, each carrying `.confidenceRating`
 * technicalItems   -- everything after, no ratings collected
 *
 * Calibration rows are scored under TRUE leave-one-out (their own rating is
 * withheld), which gives an honest read on how well the block predicts this
 * particular student before we extend it to the unrated questions.
 * ------------------------------------------------------------------ */
export function scoreAttempt({ calibrationItems, technicalItems, cgpa }) {
  const all = [...calibrationItems, ...technicalItems];
  const ctx = attemptContext(all);
  const ratings = calibrationItems.map((it) => Number(it.confidenceRating));

  const calibrationResults = calibrationItems.map((item, i) => {
    const loo = looStats(ratings, i); // hold out this question's own rating
    const x = buildFeatures(item, i, ctx, loo, cgpa);
    const p = predictOne(x);
    return {
      ...item,
      index: i,
      isCalibration: true,
      actual: ratings[i],
      prediction: p,
      state: behaviouralState(item, ctx),
      absError: Math.abs(p.confidence - ratings[i]),
    };
  });

  const full = looStats(ratings, -1); // technical questions see all 3 ratings
  const technicalResults = technicalItems.map((item, k) => {
    const i = calibrationItems.length + k;
    const x = buildFeatures(item, i, ctx, full, cgpa);
    const p = predictOne(x);
    return {
      ...item,
      index: i,
      isCalibration: false,
      actual: null,
      prediction: p,
      state: behaviouralState(item, ctx),
      absError: null,
    };
  });

  /* Leave-one-out quality of the calibration block itself.  MAE on 3 held-out
   * ratings is a small sample -- it is a reliability hint for this student, not
   * a statistic.  It is reported as such in the UI. */
  const maes = calibrationResults.map((r) => r.absError);
  const looMae = maes.reduce((a, b) => a + b, 0) / (maes.length || 1);
  const bandHit = calibrationResults.filter(
    (r) => r.absError <= Math.max(0.75, r.prediction.sd),
  ).length;

  const spread = full ? full.calib_range : 0;
  const reliability =
    spread === 0
      ? "flat"        // rated everything the same -- no within-student signal
      : looMae <= 0.75
        ? "strong"
        : looMae <= 1.25
          ? "moderate"
          : "weak";

  return {
    items: [...calibrationResults, ...technicalResults],
    calibrationResults,
    technicalResults,
    context: ctx,
    calibration: {
      ratings,
      mean: full ? full.calib_mean : null,
      spread,
      looMae,
      bandHit,
      bandTotal: calibrationResults.length,
      reliability,
    },
  };
}
