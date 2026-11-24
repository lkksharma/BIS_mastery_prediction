/**
 * analysisCache.js -- client-side caching for quiz analysis results.
 *
 * Saves the full analysis and guidance of completed quizzes to localStorage
 * so a student can click on recent quizzes on the home page and instantly
 * inspect their confidence profile, question review, and study plan without
 * re-querying or re-running Gemini.
 */

const PREFIX = "bisq_analysis_";

export function getAnalysisKey(seriesId, level) {
  return `${PREFIX}${seriesId}_${level}`;
}

/**
 * Cache an analysis result for a given series and level.
 */
export function saveCachedAnalysis({
  seriesId,
  level,
  attemptId,
  analysis,
  guidance,
  quiz,
  rollNumber,
  attemptNumber,
}) {
  if (!seriesId || !level) return;
  try {
    const key = getAnalysisKey(seriesId, level);
    const data = {
      seriesId,
      level,
      attemptId: attemptId || null,
      analysis,
      guidance: guidance || { status: "idle" },
      quiz,
      rollNumber,
      attemptNumber,
      savedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
    if (attemptId) {
      localStorage.setItem(`${PREFIX}att_${attemptId}`, JSON.stringify(data));
    }
  } catch (err) {
    console.warn("Could not cache quiz analysis in localStorage:", err);
  }
}

/**
 * Update the guidance field for an already cached analysis.
 */
export function updateCachedGuidance(seriesId, level, guidance) {
  if (!seriesId || !level) return;
  try {
    const key = getAnalysisKey(seriesId, level);
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      data.guidance = guidance;
      localStorage.setItem(key, JSON.stringify(data));
      if (data.attemptId) {
        localStorage.setItem(`${PREFIX}att_${data.attemptId}`, JSON.stringify(data));
      }
    }
  } catch (err) {
    console.warn("Could not update cached guidance:", err);
  }
}

/**
 * Retrieve cached analysis for a given quiz level in a series.
 */
export function getCachedAnalysis(seriesId, level, attemptId) {
  try {
    if (seriesId && level) {
      const raw = localStorage.getItem(getAnalysisKey(seriesId, level));
      if (raw) return JSON.parse(raw);
    }
    if (attemptId) {
      const raw = localStorage.getItem(`${PREFIX}att_${attemptId}`);
      if (raw) return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("Could not retrieve cached quiz analysis:", err);
  }
  return null;
}
