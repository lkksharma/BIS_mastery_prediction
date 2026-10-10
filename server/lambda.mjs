/**
 * AWS Lambda entry point for the API, served through a function URL.
 *
 * Routes (study guidance, follow-up quiz) live in api.mjs and are shared with
 * the local and Render servers; only the transport differs. Deployed by
 * scripts/deploy_guidance_lambda.sh, which bundles this file with esbuild.
 *
 * Configuration is Lambda environment variables:
 *   GEMINI_API_KEY          required
 *   FIREBASE_PROJECT_ID     when set, every call needs a valid Firebase ID token
 *   GEMINI_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_THINKING_LEVEL   optional
 *
 * CORS is configured on the function URL itself (allowed origin = the site),
 * so this handler sets no CORS headers of its own; Lambda answers preflights.
 */
import { DEFAULT_MODEL, DEFAULT_FALLBACKS, DEFAULT_THINKING_LEVEL } from "./guidance.mjs";
import { createChains, handleApi, routeFor } from "./api.mjs";
import { verifyFirebaseToken } from "./auth.mjs";

// Stop this long before Lambda's own timeout so the student gets a readable
// error rather than a bare 502 from a killed function.
const HEADROOM_MS = 8_000;

const env = process.env;
const API_KEY = String(env.GEMINI_API_KEY || "").trim();
const PROJECT_ID = String(env.FIREBASE_PROJECT_ID || "").trim();
const MODELS = [
  env.GEMINI_MODEL || DEFAULT_MODEL,
  ...(env.GEMINI_FALLBACK_MODELS !== undefined
    ? env.GEMINI_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACKS),
];
const THINKING = env.GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL;

// Built once per container, reused across warm invocations.
const chains = createChains({ apiKey: API_KEY, models: MODELS, thinkingLevel: THINKING });

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

export async function handler(event, context) {
  const method = event.requestContext?.http?.method || "GET";
  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";

  if (method === "GET" && (path === "/api/health" || path === "/")) {
    return json(200, { ok: true, models: MODELS, hasKey: Boolean(API_KEY), auth: Boolean(PROJECT_ID) });
  }
  const route = method === "POST" ? routeFor(path) : null;
  if (!route) return json(404, { error: "Not found" });

  if (PROJECT_ID) {
    try {
      await verifyFirebaseToken(event.headers?.authorization, PROJECT_ID);
    } catch (err) {
      return json(err.status || 401, { error: err.message });
    }
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";
  const budget = Math.max(5_000, (context?.getRemainingTimeInMillis?.() ?? 180_000) - HEADROOM_MS);
  const { status, body } = await handleApi({
    route,
    raw,
    chains,
    models: MODELS,
    signal: AbortSignal.timeout(budget),
  });
  return json(status, body);
}
