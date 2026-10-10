/**
 * The API for free Node hosts (Render, etc.): a plain Node HTTP server.
 *
 * Routes (study guidance, follow-up quiz) live in api.mjs and are shared with
 * server/lambda.mjs; only the transport differs. Unlike server/index.mjs (local
 * development only) this one REQUIRES a valid Firebase ID token and sets CORS.
 *
 * Environment variables (set in the host's dashboard):
 *   GEMINI_API_KEY        required
 *   FIREBASE_PROJECT_ID   required; every call needs a token from this project
 *   ALLOWED_ORIGINS       optional, comma-separated extra origins (custom domain).
 *                         https://<project>.web.app, https://<project>.firebaseapp.com
 *                         and http://localhost:5173 are always allowed.
 *   PORT                  provided by the host
 *   GEMINI_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_THINKING_LEVEL   optional
 */
import { createServer } from "node:http";
import { DEFAULT_MODEL, DEFAULT_FALLBACKS, DEFAULT_THINKING_LEVEL } from "./guidance.mjs";
import { createChains, handleApi, readBody, requestSignal, routeFor } from "./api.mjs";
import { verifyFirebaseToken } from "./auth.mjs";

const env = process.env;
const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const PORT = Number(env.PORT || 10000);
const API_KEY = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
const PROJECT_ID = String(env.FIREBASE_PROJECT_ID || "").trim();
const MODELS = [
  env.GEMINI_MODEL || DEFAULT_MODEL,
  ...(env.GEMINI_FALLBACK_MODELS !== undefined
    ? list(env.GEMINI_FALLBACK_MODELS)
    : DEFAULT_FALLBACKS),
];
const THINKING = env.GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL;
const ALLOWED_ORIGINS = new Set([
  ...(PROJECT_ID
    ? [`https://${PROJECT_ID}.web.app`, `https://${PROJECT_ID}.firebaseapp.com`]
    : []),
  "http://localhost:5173",
  ...list(env.ALLOWED_ORIGINS),
]);

const TIMEOUT_MS = 170_000;

const chains = createChains({ apiKey: API_KEY, models: MODELS, thinkingLevel: THINKING });

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handlePost(route, req, res) {
  // Fail closed: never run unauthenticated.
  if (!PROJECT_ID) {
    return send(res, 500, { error: "The AI service is misconfigured (no project ID)." });
  }
  try {
    await verifyFirebaseToken(req.headers.authorization, PROJECT_ID);
  } catch (err) {
    return send(res, err.status || 401, { error: err.message });
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    return send(res, err.status || 400, { error: err.message });
  }
  const signal = requestSignal(res, TIMEOUT_MS);
  const { status, body } = await handleApi({ route, raw, chains, models: MODELS, signal });
  if (!res.destroyed) send(res, status, body);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const path =
    new URL(req.url, "http://localhost").pathname
      .replace(/\/{2,}/g, "/")
      .replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && (path === "/api/health" || path === "/")) {
      return send(res, 200, {
        ok: true,
        models: MODELS,
        hasKey: Boolean(API_KEY),
        auth: Boolean(PROJECT_ID),
      });
    }
    const route = req.method === "POST" ? routeFor(path) : null;
    if (route) return await handlePost(route, req, res);
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("unhandled:", err?.message || err);
    if (!res.headersSent) send(res, 500, { error: "Internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `API listening on :${PORT}  models=${MODELS.join(" > ")}  auth=${Boolean(PROJECT_ID)}`,
  );
});
