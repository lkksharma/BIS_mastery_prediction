/**
 * Quiz series: quiz 1 (the main bank), then up to two generated follow-ups,
 * each aimed at the weaknesses the previous attempt showed.
 *
 * Every attempt records where it sits:
 *   seriesId         shared by the attempts of one series; a new quiz 1 starts
 *                    a new series (retaking quiz 1 stays allowed, as before)
 *   quizLevel        1, 2 or 3
 *   quizKind         "base" for quiz 1, "follow-up" for 2 and 3
 *   parentAttemptId  the attempt the follow-up was generated from
 *   generatedQuizId  the generated_quizzes document it was taken from
 *
 * A generated quiz is saved before the student starts it, so one interrupted
 * by a sign-out or a closed tab can be picked up again from the home page.
 */
import { postApi } from "./guidance";

export const MAX_LEVEL = 3;

export function newSeriesId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const time = (doc) => Date.parse(doc.timestamp || doc.createdAtIso || "") || 0;

// Attempts saved before series existed are quiz 1 of a series of their own.
export const seriesOf = (a) => a.seriesId || a.id;
export const levelOf = (a) => a.quizLevel || 1;

/** The handful of numbers the progress chart needs from one attempt. */
export function attemptSummary(a) {
  const metrics = Object.values(a.behavioralMetrics || {});
  const total = a.questionCount || metrics.length || 0;
  const score = a.correctCount ?? metrics.filter((m) => m.isCorrect).length;
  const mastery =
    a.stateCounts?.mastery ?? metrics.filter((m) => m.behaviouralState === "mastery").length;
  return {
    id: a.id,
    level: levelOf(a),
    score,
    total,
    scorePct: total ? (score / total) * 100 : 0,
    masteryPct: total ? (mastery / total) * 100 : 0,
    focusTopics: a.focusTopics || [],
    timestamp: a.timestamp,
  };
}

/**
 * Where the student stands in their most recent series.
 *
 * history = { attempts: [...], generated: [...] }, each item carrying its
 * Firestore id as `id`. Returns null when there is no attempt yet.
 */
export function summarizeSeries(history) {
  const attempts = [...(history?.attempts || [])].sort((a, b) => time(b) - time(a));
  if (attempts.length === 0) return null;

  const latest = attempts[0];
  const seriesId = seriesOf(latest);
  const inSeries = attempts.filter((a) => seriesOf(a) === seriesId);

  // One entry per level: the most recent sitting of it.
  const byLevel = new Map();
  for (const a of inSeries) if (!byLevel.has(levelOf(a))) byLevel.set(levelOf(a), a);
  const levels = [...byLevel.values()].sort((a, b) => levelOf(a) - levelOf(b));
  const lastDone = levels[levels.length - 1];
  const highest = levelOf(lastDone);

  const taken = new Set(attempts.map((a) => a.generatedQuizId).filter(Boolean));
  const pending =
    (history?.generated || [])
      .filter((g) => g.seriesId === seriesId && g.level === highest + 1 && !taken.has(g.id))
      .sort((a, b) => time(b) - time(a))[0] || null;

  return {
    seriesId,
    levels: levels.map(attemptSummary),
    lastAttempt: lastDone,
    pending,
    nextLevel: highest < MAX_LEVEL ? highest + 1 : null,
    complete: highest >= MAX_LEVEL,
  };
}

/**
 * Rebuild the minimal analysis object buildGuidanceRequest() needs from a
 * saved attempt document -- used when the follow-up is started from the home
 * page, after the in-memory results of that attempt are long gone.
 *
 * Attempts carry a questionSnapshot; older ones do not, so their questions are
 * looked up in the current bank by id instead.
 */
export function analysisFromAttempt(doc, bank) {
  const metrics = doc.behavioralMetrics || {};
  const byId = new Map(
    [...(bank?.calibration || []), ...(bank?.technical || [])].map((q) => [q.id, q]),
  );
  const questions =
    doc.questionSnapshot?.length > 0
      ? doc.questionSnapshot
      : Object.keys(metrics).map((id) => byId.get(id)).filter(Boolean);

  const items = questions.map((q) => {
    const m = metrics[q.id] || {};
    const probs = m.predictedProbs || [];
    return {
      questionId: q.id,
      isCalibration: q.block === "calibration",
      type: q.type || "",
      difficulty: q.difficulty || "medium",
      text: q.text,
      prompt: q.prompt || "",
      options: q.options || [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || "",
      selectedOption: m.finalSelectedOption || "",
      isCorrect: Boolean(m.isCorrect),
      state:
        m.behaviouralState ||
        (!m.finalSelectedOption ? "skipped" : m.isCorrect ? "mastery" : "confusion"),
      prediction: {
        label: m.predictedClass || "Medium",
        confidence: Math.min(5, Math.max(1, Number(m.predictedConfidence) || 3)),
        certainty: probs.length ? Math.max(...probs) : 0.5,
      },
      actual: q.block === "calibration" && m.confidenceRating ? m.confidenceRating : null,
      timeSpent: m.timeSpent || 0,
      optionChanges: m.optionChanges || 0,
      markedForReview: Boolean(m.markedForReview),
      visits: m.visits || 0,
    };
  });
  return { items, calibration: { reliability: doc.calibrationReliability || "moderate" } };
}

/** The bits of a question worth keeping on the attempt for later. */
export function snapshotQuestion(q) {
  return {
    id: q.id,
    block: q.block,
    type: q.type || "",
    difficulty: q.difficulty || "medium",
    ...(q.topic ? { topic: q.topic } : {}),
    text: q.text,
    ...(q.prompt ? { prompt: q.prompt } : {}),
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation || "",
  };
}

/** Ask the API to write quiz `level` from the previous attempt. */
export function requestNextQuiz({ level, previous, focus = [], history = [], signal }) {
  return postApi(
    "/api/quiz/next",
    { level, previous, focus, history },
    { signal, unreachable: "Could not reach the server to build your next quiz." },
  );
}
