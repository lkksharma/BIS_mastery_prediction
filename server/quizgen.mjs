/**
 * quizgen.mjs -- writes the follow-up quiz (quiz 2 or 3 of a series).
 *
 * Two LangChain chains, both through the same model fallback list as the
 * guidance:
 *
 *   1. generate  previous attempt + weak concepts -> 15 new questions aimed at
 *                the weaknesses, distractors built from the student's own
 *                wrong choices
 *   2. verify    the questions WITHOUT their answer keys -> Gemini answers each
 *                one independently; a question whose key it disagrees with is
 *                dropped
 *
 * Generation is the step a model gets wrong most often (a wrong key, or two
 * defensible options), and a student marked wrong for a right answer learns the
 * wrong thing. The blind second pass catches most of those. Up to 12 survivors
 * go to the student; fewer than 8 is treated as a failure.
 *
 * Only the technical block is generated. The 3 calibration questions come from
 * a fixed, reviewed pool per level (src/data/questions.js): the confidence model
 * needs exactly 3 medium-to-hard rated items, and that is not something to
 * leave to generation.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  GuidanceRequest,
  createStructuredChain,
  invokeWithFallback,
} from "./guidance.mjs";

export const MAX_LEVEL = 3;
const GENERATE_COUNT = 15;
const KEEP_COUNT = 12;
const MIN_KEEP = 8;

/* ------------------------------------------------------------------ *
 * Request
 * ------------------------------------------------------------------ */
const str = (max) => z.string().max(max);

export const NextQuizRequest = z.object({
  level: z.number().int().min(2).max(MAX_LEVEL),
  previous: GuidanceRequest,
  // The coach's weak concepts for the previous attempt, when the browser has
  // them. Without them Gemini works the weaknesses out from the states.
  focus: z
    .array(
      z.object({
        concept: str(200),
        severity: z.enum(["none", "low", "moderate", "high"]),
        why: str(600).default(""),
      }),
    )
    .max(15)
    .default([]),
  history: z
    .array(
      z.object({
        level: z.number().int().min(1).max(MAX_LEVEL),
        score: z.number().int().min(0),
        total: z.number().int().min(1),
      }),
    )
    .max(MAX_LEVEL)
    .default([]),
});

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */
const GeneratedQuestion = z.object({
  topic: z.string().describe("The topic this question tests; a focus topic name where it is one."),
  targets: z
    .string()
    .describe("One sentence: the specific misconception or skill this question checks."),
  type: z.enum(["Theory", "Apply"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  text: z.string().describe("The full, self-contained question."),
  options: z.array(z.string()).describe("Exactly four distinct options."),
  correctAnswer: z.string().describe("The correct option, copied character for character."),
  explanation: z
    .string()
    .describe("One or two sentences: why it is right and why the most tempting distractor is wrong."),
});

const GeneratedQuiz = z.object({
  focusTopics: z.array(z.string()).describe("Two to four focus topics, most severe first."),
  questions: z.array(GeneratedQuestion),
});

const GENERATE_SYSTEM = `You write multiple-choice questions for a follow-up quiz. A student has just taken a quiz; you receive every question with their answer and two labels per question. Write quiz {level} of 3 in their series, aimed squarely at their weaknesses.

# Reading the previous attempt

- behaviouralState: mastery (correct, no hesitation); shaky (correct, but hesitated); misconception (wrong without hesitation -- a confidently held wrong belief, the most serious case); confusion (wrong after hesitating); skipped (no answer).
- predictedConfidence: a model's estimate of how confident the student felt, right about two times in three. A soft signal only.
- selectedOption against correctAnswer is the strongest evidence of WHAT the student believes.
- The coach's focus list, when it is not empty, names the weak concepts already identified, most severe first. Treat it as the primary list.
- Calibration questions are general logic items used only to measure confidence. Do NOT write questions about them. Every question you write is about the subject of the technical questions.

# Focus topics

Pick two to four focus topics, most severe first: misconceptions, then confusion and skipped, then shaky answers. Name them specifically, e.g. "Second normal form (partial dependency)", not "Databases".

# The questions

Write exactly {count} questions.

- At least {focus_min} of them on the focus topics, shared out in proportion to severity. The rest on other topics from the previous technical questions, to check that what the student got right still holds.
- New questions, not rewordings: change the scenario, the numbers or the direction of reasoning, so that remembering the previous answer does not help.
- Build distractors from the student's actual mistakes: if they chose 3NF for a relation that is only in 1NF, a distractor should tempt the same faulty reasoning in a new setting.
- Exactly four options, all distinct, similar in length and style, each plausible to someone with the misconception. No "all of the above", "none of the above" or "both A and B".
- Exactly one option is correct, and it must be unambiguously correct to an expert. correctAnswer is copied character for character from options.
- Self-contained: everything needed is in the question text. No references to the previous quiz, to diagrams or to "the question above".
- difficulty: {difficulty_rule}
- type: Theory for definitions and properties, Apply for working through a concrete case.
- explanation: one or two sentences on why the answer is right and why the most tempting distractor is wrong.
- Plain text, no markdown. Write arrows as ->.`;

const GENERATE_HUMAN = `Previous attempt (quiz {previous_level} of 3):
{previous_json}

Coach's focus list (may be empty):
{focus_json}

Scores so far in this series:
{history_json}`;

const generatePrompt = ChatPromptTemplate.fromMessages([
  ["system", GENERATE_SYSTEM],
  ["human", GENERATE_HUMAN],
]);

const DIFFICULTY_RULE = {
  2: "mostly medium, about a quarter hard, no more than two easy.",
  3: "mostly medium, about a third hard, none easy -- this is the last quiz in the series.",
};

/* ------------------------------------------------------------------ *
 * Verification: answer the questions blind.
 * ------------------------------------------------------------------ */
const Verification = z.object({
  answers: z.array(
    z.object({
      number: z.number().int(),
      answer: z.string().describe("The option judged correct, copied character for character."),
    }),
  ),
});

const verifyPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are an expert checking a quiz. Answer every multiple-choice question independently and carefully, as if sitting the quiz yourself. For each, return its number and the single option you judge correct, copied character for character from its options. Do not skip any.",
  ],
  ["human", "{questions_json}"],
]);

/* ------------------------------------------------------------------ *
 * Chains
 * ------------------------------------------------------------------ */
export function createQuizChains({ apiKey, models, thinkingLevel }) {
  const unique = [...new Set(models)];
  return {
    generate: unique.map((model) => ({
      model,
      chain: createStructuredChain({
        prompt: generatePrompt,
        schema: GeneratedQuiz,
        name: "follow_up_quiz",
        apiKey,
        model,
        thinkingLevel,
      }),
    })),
    // Checking answers is where reasoning pays, and the output is tiny, so the
    // verifier keeps the model's default thinking.
    verify: unique.map((model) => ({
      model,
      chain: createStructuredChain({
        prompt: verifyPrompt,
        schema: Verification,
        name: "answer_check",
        apiKey,
        model,
        maxOutputTokens: 8192,
      }),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */
const norm = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normalise one generated question, or null if it is unusable. */
export function cleanQuestion(q) {
  const text = String(q.text || "").trim();
  const options = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
  if (text.length < 15 || options.length !== 4) return null;
  if (new Set(options.map(norm)).size !== 4) return null;
  if (options.some((o) => /^(all|none) of the above$/i.test(o))) return null;
  const correct = options.find((o) => norm(o) === norm(q.correctAnswer));
  if (!correct) return null;
  return {
    topic: String(q.topic || "").trim(),
    targets: String(q.targets || "").trim(),
    type: q.type === "Apply" ? "Apply" : "Theory",
    difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
    text,
    // Models put the right answer first far more often than chance would.
    options: shuffle(options),
    correctAnswer: correct,
    explanation: String(q.explanation || "").trim(),
  };
}

/**
 * Generate, clean, verify and number a follow-up quiz.
 * Returns { focusTopics, questions, answerKeyVerified, dropped, models }.
 */
export async function generateNextQuiz(chains, request, { signal, onFallback } = {}) {
  const previousLevel = Math.max(1, request.level - 1);
  const t0 = Date.now();
  const { output, model } = await invokeWithFallback(
    chains.generate,
    {
      level: String(request.level),
      count: String(GENERATE_COUNT),
      focus_min: String(Math.round(GENERATE_COUNT * 0.65)),
      difficulty_rule: DIFFICULTY_RULE[request.level] || DIFFICULTY_RULE[2],
      previous_level: String(previousLevel),
      previous_json: JSON.stringify(request.previous, null, 2),
      focus_json: JSON.stringify(request.focus, null, 2),
      history_json: JSON.stringify(request.history),
    },
    // A healthy model writes the 15 questions in 25-45 s.
    { signal, onFallback, attemptTimeoutMs: 75_000 },
  );

  const seen = new Set();
  const cleaned = output.questions
    .map(cleanQuestion)
    .filter((q) => q && !seen.has(norm(q.text)) && seen.add(norm(q.text)));

  const t1 = Date.now();
  let kept = cleaned;
  let answerKeyVerified = false;
  let verifyModel = null;
  try {
    const check = await invokeWithFallback(
      chains.verify,
      {
        questions_json: JSON.stringify(
          cleaned.map((q, i) => ({ number: i + 1, question: q.text, options: q.options })),
          null,
          2,
        ),
      },
      // Answering 15 questions takes a healthy model 15-30 s.
      { signal, onFallback, attemptTimeoutMs: 45_000 },
    );
    const answerOf = new Map(check.output.answers.map((a) => [a.number, a.answer]));
    kept = cleaned.filter((q, i) => norm(answerOf.get(i + 1) ?? "") === norm(q.correctAnswer));
    answerKeyVerified = true;
    verifyModel = check.model;
  } catch (err) {
    // A failed check should not cost the student their quiz; the questions go
    // out unverified and the saved quiz records that they were.
    if (signal?.aborted) throw err;
    console.warn("answer-key check failed, using unverified questions:", err?.message || err);
  }

  if (kept.length < MIN_KEEP) {
    throw Object.assign(
      new Error(
        `Only ${kept.length} of ${output.questions.length} generated questions passed the answer-key check.`,
      ),
      { status: 502, userMessage: "The new quiz did not pass its quality check. Try again." },
    );
  }

  const questions = kept.slice(0, KEEP_COUNT).map((q, i) => ({
    id: `g${request.level}_${i + 1}`,
    block: "technical",
    ...q,
  }));

  return {
    focusTopics: output.focusTopics.map((t) => String(t).trim()).filter(Boolean).slice(0, 4),
    questions,
    answerKeyVerified,
    dropped: output.questions.length - kept.length,
    models: { generate: model, verify: verifyModel },
    seconds: { generate: (t1 - t0) / 1000, verify: (Date.now() - t1) / 1000 },
  };
}
