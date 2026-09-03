/**
 * Parity harness: runs a fixed synthetic attempt through src/model/predict.js
 * and dumps the raw features, standardised vector and both heads as JSON.
 *
 * scripts/parity_check.py recomputes the same numbers with pandas + numpy and
 * diffs them.  Run `node scripts/parity_test.mjs > /tmp/js.json` then the
 * Python side.  The two implementations must agree to 1e-9 or the browser is
 * silently scoring a different model than the one that was validated.
 */

import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

const ENTRY = `
import { scoreAttempt, buildFeatures, attemptContext, looStats, predictOne }
  from ${JSON.stringify(join(ROOT, "src/model/predict.js"))};
export { scoreAttempt, buildFeatures, attemptContext, looStats, predictOne };
`;

const dir = mkdtempSync(join(tmpdir(), "parity-"));
const entryPath = join(dir, "entry.js");
writeFileSync(entryPath, ENTRY);
const outPath = join(dir, "bundle.mjs");

await build({
  entryPoints: [entryPath],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outPath,
  loader: { ".json": "json" },
  logLevel: "silent",
});

const M = await import(pathToFileURL(outPath).href);

/* -------------------------------------------------- the fixture ---- */
const mk = (o) => ({
  timeSpent: 0,
  optionChanges: 0,
  reviewClickCount: 0,
  markedForReview: false,
  isCorrect: false,
  selectedOption: "A",
  type: "Reasoning",
  difficulty: "medium",
  ...o,
});

const calibrationItems = [
  mk({ questionId: "cal_1", timeSpent: 44.0, optionChanges: 1, isCorrect: false, confidenceRating: 3 }),
  mk({ questionId: "cal_2", timeSpent: 91.5, optionChanges: 2, reviewClickCount: 1, markedForReview: true, isCorrect: true, difficulty: "hard", confidenceRating: 2 }),
  mk({ questionId: "cal_3", timeSpent: 18.25, isCorrect: true, confidenceRating: 5 }),
];

const technicalItems = [
  mk({ questionId: "tech_1", timeSpent: 62.0, optionChanges: 1, isCorrect: true, type: "Theory" }),
  mk({ questionId: "tech_2", timeSpent: 12.5, isCorrect: false, type: "Apply", difficulty: "medium" }),
  mk({ questionId: "tech_3", timeSpent: 155.0, optionChanges: 3, reviewClickCount: 2, markedForReview: true, isCorrect: false, type: "Theory", difficulty: "hard" }),
  mk({ questionId: "tech_4", timeSpent: 0, selectedOption: "", isCorrect: false, type: "Apply", difficulty: "medium" }),
];

const CGPA = 7.4;

const result = M.scoreAttempt({ calibrationItems, technicalItems, cgpa: CGPA });
const ctx = M.attemptContext([...calibrationItems, ...technicalItems]);
const ratings = calibrationItems.map((i) => i.confidenceRating);

const vectors = result.items.map((it, i) => {
  const calib = it.isCalibration ? M.looStats(ratings, i) : M.looStats(ratings, -1);
  return M.buildFeatures(it, i, ctx, calib, CGPA);
});

console.log(
  JSON.stringify(
    {
      context: {
        meanLogTime: ctx.meanLogTime,
        att_log_total_time: ctx.att_log_total_time,
        att_mean_changes: ctx.att_mean_changes,
        att_n_items: ctx.att_n_items,
        att_unans_frac: ctx.att_unans_frac,
      },
      looAll: M.looStats(ratings, -1),
      looHoldout: ratings.map((_, i) => M.looStats(ratings, i)),
      vectors,
      predictions: result.items.map((it) => ({
        id: it.questionId,
        probs: it.prediction.probs,
        ridge: it.prediction.ridge,
        expected: it.prediction.expected,
        confidence: it.prediction.confidence,
        sd: it.prediction.sd,
        label: it.prediction.label,
      })),
      states: result.items.map((it) => it.state),
      calibration: result.calibration,
    },
    null,
    2,
  ),
);
