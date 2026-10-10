/**
 * api.mjs -- the API's routes, independent of how requests arrive.
 *
 * server/index.mjs (local dev), server/render.mjs (Render) and
 * server/lambda.mjs (AWS Lambda) each handle transport -- reading the body,
 * CORS, the Firebase token check, timeouts -- and then hand the request here,
 * so the three cannot drift apart.
 *
 *   POST /api/guidance   attempt -> study guidance         (guidance.mjs)
 *   POST /api/quiz/next  attempt -> follow-up quiz 2 or 3  (quizgen.mjs)
 */
import {
  GuidanceRequest,
  createGuidanceChains,
  describeFailure,
  generateGuidance,
} from "./guidance.mjs";
import { NextQuizRequest, createQuizChains, generateNextQuiz } from "./quizgen.mjs";

export const MAX_BODY = 512 * 1024;

/** Which handler a POST path maps to, or null. "/" and "/guidance" are kept
 *  for clients built before the routes were namespaced. */
export function routeFor(path) {
  const p = String(path || "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  if (p === "/api/guidance" || p === "/guidance" || p === "/") return "guidance";
  if (p === "/api/quiz/next" || p === "/quiz/next") return "quiz";
  return null;
}

export function createChains({ apiKey, models, thinkingLevel }) {
  if (!apiKey) return null;
  return {
    guidance: createGuidanceChains({ apiKey, models, thinkingLevel }),
    quiz: createQuizChains({ apiKey, models, thinkingLevel }),
  };
}

const ROUTES = {
  guidance: {
    schema: GuidanceRequest,
    async run(chains, data, opts) {
      const { guidance, model, linkStats } = await generateGuidance(chains.guidance, data, opts);
      return {
        body: { guidance, model, generatedAt: new Date().toISOString() },
        log: { questions: data.questions.length, model, links: linkStats },
      };
    },
  },
  quiz: {
    schema: NextQuizRequest,
    async run(chains, data, opts) {
      const quiz = await generateNextQuiz(chains.quiz, data, opts);
      return {
        body: { quiz, level: data.level, generatedAt: new Date().toISOString() },
        log: {
          level: data.level,
          kept: quiz.questions.length,
          dropped: quiz.dropped,
          verified: quiz.answerKeyVerified,
          models: quiz.models,
          phases: quiz.seconds,
        },
      };
    },
  },
};

/**
 * Run one API request. Never throws; always returns { status, body }.
 * `raw` is the request body as text.
 */
export async function handleApi({ route, raw, chains, models, signal }) {
  if (!chains) {
    return { status: 503, body: { error: "The AI service is not configured (no Gemini key)." } };
  }
  if (raw.length > MAX_BODY) return { status: 413, body: { error: "Request body too large" } };

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "Body is not valid JSON" } };
  }
  const handler = ROUTES[route];
  const parsed = handler.schema.safeParse(json);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Request does not match the expected shape", issues: parsed.error.issues.slice(0, 5) },
    };
  }

  const started = Date.now();
  try {
    const { body, log } = await handler.run(chains, parsed.data, {
      signal,
      onFallback: (m, err) =>
        console.warn(`${m} unavailable (${err?.status || err?.lc_error_code || "error"}), trying the next model`),
    });
    console.log(
      JSON.stringify({ event: route, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), ...log }),
    );
    return { status: 200, body };
  } catch (err) {
    console.error(`${route} failed:`, err?.message || err);
    if (signal?.aborted) {
      return { status: 504, body: { error: "Gemini took too long to respond. Try again." } };
    }
    return {
      status: err?.status && err.status >= 400 && err.status < 600 && err.userMessage ? err.status : 502,
      body: { error: err?.userMessage || describeFailure(err, models) },
    };
  }
}

/** Read a node:http request body as text, capped at MAX_BODY. */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** An AbortSignal that fires on timeout or when the client goes away.
 *  `res` close (not `req`) is the reliable disconnect signal once the body
 *  has been read. */
export function requestSignal(res, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  res.on("close", () => {
    clearTimeout(timer);
    if (!res.writableEnded) controller.abort(new Error("client disconnected"));
  });
  return controller.signal;
}
