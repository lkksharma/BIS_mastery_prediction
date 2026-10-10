import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SignIn from "./components/SignIn";
import Landing from "./components/Landing";
import CalibrationStage from "./components/CalibrationStage";
import TechnicalStage from "./components/TechnicalStage";
import Results from "./components/Results";
import { createTelemetry } from "./lib/telemetry";
import { loadBank, saveAttempt, loadHistory, saveGeneratedQuiz } from "./lib/firestore";
import { fetchGuidance, buildGuidanceRequest, GUIDANCE_ENABLED } from "./lib/guidance";
import {
  MAX_LEVEL,
  newSeriesId,
  summarizeSeries,
  analysisFromAttempt,
  snapshotQuestion,
  requestNextQuiz,
} from "./lib/series";
import {
  watchAuth,
  resolveRedirect,
  signOutUser,
  isConfigured,
} from "./config/firebase";
import { scoreAttempt, MODEL_META } from "./model/predict";
import { DEFAULT_CONFIG, calibrationForLevel } from "./data/questions";

const STAGES = {
  LOADING: "loading",
  SIGNIN: "signin",
  LANDING: "landing",
  CALIBRATION: "calibration",
  TECHNICAL: "technical",
  GENERATING: "generating",
  SCORING: "scoring",
  RESULTS: "results",
};

export default function App() {
  const [stage, setStage] = useState(STAGES.LOADING);
  const [bank, setBank] = useState(null);
  const [account, setAccount] = useState(null); // { uid, email, name, photo }
  const [authError, setAuthError] = useState(null);
  const [priorAttempts, setPriorAttempts] = useState(0);
  const [student, setStudent] = useState({ rollNumber: "", cgpa: null });
  const [analysis, setAnalysis] = useState(null);
  const [saveState, setSaveState] = useState("idle");
  // { status: "idle" | "loading" | "ready" | "error", data, error }
  const [guidance, setGuidance] = useState({ status: "idle" });
  // The quiz being taken: which questions, and where it sits in its series.
  const [quiz, setQuiz] = useState(null);
  // The signed-in student's attempts and generated follow-ups (Firestore).
  // Offline, it holds only this session's attempts.
  const [history, setHistory] = useState({ status: "idle", attempts: [], generated: [] });
  // Building the next quiz: { status: "idle" | "loading" | "error", level, error, args }
  const [generation, setGeneration] = useState({ status: "idle" });
  const [lastAttemptId, setLastAttemptId] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("bisq-theme") || "system",
  );

  // Fresh telemetry per quiz: a second quiz in the same session must not
  // inherit the first one's timings.
  const telemetryRef = useRef(createTelemetry());
  const generationAbort = useRef(null);
  const startedAt = useRef(null);
  // A quiz in progress must survive an auth token refresh without being reset.
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const refreshHistory = useCallback((uid) => {
    setHistory((h) => ({ ...h, status: "loading" }));
    return loadHistory(uid).then((h) => {
      setHistory({ status: h.ok ? "ready" : "error", attempts: h.attempts, generated: h.generated });
      setPriorAttempts(h.attempts.length);
    });
  }, []);

  /* ---------------------------------------------------- boot */
  useEffect(() => {
    let alive = true;

    loadBank().then((loaded) => {
      if (!alive) return;
      setBank(loaded);
      // Without Firebase there is nobody to sign in, so go straight to the
      // quiz. This has to happen here rather than in a separate effect keyed
      // on `stage`, or the auth listener below races it to SIGNIN first.
      if (!isConfigured) setStage(STAGES.LANDING);
    });

    if (!isConfigured) {
      return () => {
        alive = false;
      };
    }

    // Collect the result of a redirect sign-in before wiring up the listener,
    // so a redirect return does not flash the sign-in screen.
    resolveRedirect().catch((err) => alive && setAuthError(err.message));

    const stop = watchAuth((profile, err) => {
      if (!alive) return;
      if (err) setAuthError(err.message);

      setAccount(profile);
      if (profile) {
        setAuthError(null);
        refreshHistory(profile.uid);

        // Re-fetch the bank now that we are authenticated. The boot-time call
        // above runs before sign-in, so the `request.auth != null` rule denies
        // it and it falls back to the bundled bank -- meaning the seeded
        // Firestore questions would otherwise never be used at all.
        loadBank().then((fresh) => {
          if (!alive || fresh.source !== "firestore") return;
          // Never swap the bank out from under a quiz in progress.
          if (
            stageRef.current === STAGES.LOADING ||
            stageRef.current === STAGES.SIGNIN ||
            stageRef.current === STAGES.LANDING
          ) {
            setBank(fresh);
          }
        });
        // Only advance if we are still on a pre-quiz screen. A token refresh
        // mid-quiz re-fires this listener and must not restart the attempt.
        if (
          stageRef.current === STAGES.LOADING ||
          stageRef.current === STAGES.SIGNIN
        ) {
          setStage(STAGES.LANDING);
        }
      } else {
        setHistory({ status: "idle", attempts: [], generated: [] });
        if (stageRef.current !== STAGES.RESULTS) setStage(STAGES.SIGNIN);
      }
    });

    return () => {
      alive = false;
      stop();
    };
  }, []);

  /* ---------------------------------------------------- theme */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("bisq-theme", theme);
  }, [theme]);

  /* ---------------------------------------------------- focus tracking
   * Time only accrues while the tab is visible and focused. Without this a
   * student who alt-tabs away looks like deep deliberation, and time is one of
   * the model's inputs. */
  useEffect(() => {
    const onVis = () =>
      document.visibilityState === "hidden"
        ? telemetryRef.current.pause()
        : telemetryRef.current.resume();
    const onBlur = () => telemetryRef.current.pause();
    const onFocus = () => telemetryRef.current.resume();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /* ---------------------------------------------------- accidental exit */
  useEffect(() => {
    const inProgress =
      stage === STAGES.CALIBRATION || stage === STAGES.TECHNICAL;
    if (!inProgress) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  const config = bank?.config || DEFAULT_CONFIG;

  /* Gemini study guidance. Started from the submit handler rather than an
   * effect so StrictMode's double-mount does not send every attempt twice.
   * It never blocks the results page: the scores render at once and the
   * guidance fills in when it arrives. */
  const requestGuidance = useCallback((result) => {
    if (!GUIDANCE_ENABLED) return;
    setGuidance({ status: "loading" });
    fetchGuidance(result)
      .then((data) => setGuidance({ status: "ready", data }))
      .catch((err) => setGuidance({ status: "error", error: err.message }));
  }, []);

  /* ---------------------------------------------------- starting a quiz */
  const beginQuiz = useCallback(
    (q, s) => {
      telemetryRef.current = createTelemetry();
      setQuiz(q);
      setStudent(s);
      setAnalysis(null);
      setGuidance({ status: "idle" });
      setSaveState("idle");
      setLastAttemptId(null);
      setGeneration({ status: "idle" });
      startedAt.current = new Date().toISOString();
      setTimeLeft((config.totalTimeAllowedMinutes || 25) * 60);
      setStage(STAGES.CALIBRATION);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [config],
  );

  /** Quiz 1 of a new series, from the main bank. */
  const startBase = useCallback(
    (s) =>
      beginQuiz(
        {
          level: 1,
          kind: "base",
          seriesId: newSeriesId(),
          parentAttemptId: null,
          generatedQuizId: null,
          focusTopics: [],
          calibration: bank.calibration,
          technical: bank.technical,
          source: bank.source,
          answerKeyVerified: true,
        },
        s,
      ),
    [beginQuiz, bank],
  );

  /** A follow-up that was generated and saved, but never submitted. */
  const resumePending = useCallback(
    (doc, s) =>
      beginQuiz(
        {
          level: doc.level,
          kind: "follow-up",
          seriesId: doc.seriesId,
          parentAttemptId: doc.parentAttemptId || null,
          generatedQuizId: doc.id,
          focusTopics: doc.focusTopics || [],
          calibration: calibrationForLevel(doc.level, bank.calibration),
          technical: doc.technical,
          source: "generated",
          answerKeyVerified: doc.answerKeyVerified !== false,
        },
        s,
      ),
    [beginQuiz, bank],
  );

  /** Ask the API for quiz `level`, save it so it can be resumed, start it. */
  const generateFollowUp = useCallback(
    async (args) => {
      const { s, level, seriesId, parentAttemptId, previousAnalysis, focus, points } = args;
      generationAbort.current?.abort();
      const ctl = new AbortController();
      generationAbort.current = ctl;
      setGeneration({ status: "loading", level, args });
      setStage(STAGES.GENERATING);
      window.scrollTo({ top: 0, behavior: "auto" });

      try {
        const { quiz: made } = await requestNextQuiz({
          level,
          previous: buildGuidanceRequest(previousAnalysis),
          focus,
          history: points.map((p) => ({ level: p.level, score: p.score, total: p.total })),
          signal: ctl.signal,
        });

        let generatedQuizId = null;
        if (isConfigured && account?.uid) {
          const doc = {
            studentUid: account.uid,
            seriesId,
            level,
            parentAttemptId: parentAttemptId || null,
            focusTopics: made.focusTopics,
            technical: made.questions,
            answerKeyVerified: made.answerKeyVerified,
            models: made.models,
            createdAtIso: new Date().toISOString(),
          };
          const saved = await saveGeneratedQuiz(doc);
          if (saved.ok) {
            generatedQuizId = saved.id;
            setHistory((h) => ({ ...h, generated: [...h.generated, { id: saved.id, ...doc }] }));
          }
        }
        if (ctl.signal.aborted) return;

        beginQuiz(
          {
            level,
            kind: "follow-up",
            seriesId,
            parentAttemptId: parentAttemptId || null,
            generatedQuizId,
            focusTopics: made.focusTopics,
            calibration: calibrationForLevel(level, bank.calibration),
            technical: made.questions,
            source: "generated",
            answerKeyVerified: made.answerKeyVerified,
          },
          s,
        );
      } catch (err) {
        if (err?.name === "AbortError") return;
        setGeneration({ status: "error", level, args, error: err.message });
      }
    },
    [account, bank, beginQuiz],
  );

  const series = useMemo(() => summarizeSeries(history), [history]);

  /** Next quiz from the results page: this attempt and its guidance. */
  const continueFromResults = useCallback(() => {
    const weak =
      guidance.status === "ready" ? guidance.data.guidance.overall.weakConcepts : [];
    generateFollowUp({
      s: student,
      level: quiz.level + 1,
      seriesId: quiz.seriesId,
      parentAttemptId: lastAttemptId,
      previousAnalysis: analysis,
      focus: weak.map((c) => ({ concept: c.concept, severity: c.severity, why: c.why || "" })),
      points: series?.levels || [],
    });
  }, [guidance, generateFollowUp, student, quiz, lastAttemptId, analysis, series]);

  /** Next quiz from the home page: rebuilt from the saved attempt. */
  const continueFromHome = useCallback(
    (s) => {
      if (!series?.nextLevel) return;
      generateFollowUp({
        s,
        level: series.nextLevel,
        seriesId: series.seriesId,
        parentAttemptId: series.lastAttempt.id,
        previousAnalysis: analysisFromAttempt(series.lastAttempt, bank),
        focus: [],
        points: series.levels,
      });
    },
    [series, generateFollowUp, bank],
  );

  const submit = useCallback(async () => {
    setStage(STAGES.SCORING);
    const telemetry = telemetryRef.current;
    telemetry.pause();

    const calibrationItems = telemetry
      .finalise(quiz.calibration)
      .map((r) => ({ ...r, isCalibration: true }));
    const technicalItems = telemetry
      .finalise(quiz.technical)
      .map((r) => ({ ...r, isCalibration: false }));

    const result = scoreAttempt({
      calibrationItems,
      technicalItems,
      cgpa: student.cgpa,
    });
    setAnalysis(result);
    requestGuidance(result);

    const payload = {
      rollNumber: student.rollNumber,
      studentCgpa: student.cgpa,
      studentUid: account?.uid || null,
      studentEmail: account?.email || "",
      studentName: account?.name || "",
      // Retakes are allowed but flagged: filter to attemptNumber == 1 to keep
      // only first sittings, which is what the training data needed.
      attemptNumber: priorAttempts + 1,
      isRetake: priorAttempts > 0,
      timestamp: new Date().toISOString(),
      startedAt: startedAt.current,
      questionSource: quiz.source,
      // Where this attempt sits in its series (src/lib/series.js).
      seriesId: quiz.seriesId,
      quizLevel: quiz.level,
      quizKind: quiz.kind,
      parentAttemptId: quiz.parentAttemptId || null,
      generatedQuizId: quiz.generatedQuizId || null,
      focusTopics: quiz.focusTopics || [],
      answerKeyVerified: quiz.answerKeyVerified !== false,
      stateCounts: result.items.reduce(
        (acc, i) => ({ ...acc, [i.state]: (acc[i.state] || 0) + 1 }),
        {},
      ),
      // The questions as asked, so a follow-up can be generated from this
      // attempt later (from the home page) without the session that took it.
      questionSnapshot: [...quiz.calibration, ...quiz.technical].map(snapshotQuestion),
      modelVersion: MODEL_META.generated_by,
      calibrationRatings: result.calibration.ratings,
      calibrationLooMae: Number(result.calibration.looMae.toFixed(4)),
      calibrationReliability: result.calibration.reliability,
      correctCount: result.items.filter((i) => i.isCorrect).length,
      questionCount: result.items.length,
      correctPercentage:
        Math.round(
          (result.items.filter((i) => i.isCorrect).length / result.items.length) *
            10000,
        ) / 100,
      // one entry per question -- same field names as the existing Bis-quiz
      // export so the analysis scripts keep working unchanged
      behavioralMetrics: Object.fromEntries(
        result.items.map((i) => [
          i.questionId,
          {
            block: i.block,
            finalSelectedOption: i.selectedOption,
            timeSpent: i.timeSpent,
            optionChanges: i.optionChanges,
            markedForReview: i.markedForReview,
            reviewClickCount: i.reviewClickCount,
            visits: i.visits,
            confidenceRating: i.isCalibration ? i.actual : 0,
            isCorrect: i.isCorrect,
            predictedConfidence: Number(i.prediction.confidence.toFixed(4)),
            predictedClass: i.prediction.label,
            predictedProbs: i.prediction.probs.map((p) => Number(p.toFixed(4))),
            predictedSd: Number(i.prediction.sd.toFixed(4)),
            behaviouralState: i.state,
          },
        ]),
      ),
    };

    let savedId = null;
    if (isConfigured && account?.uid) {
      const res = await saveAttempt(payload);
      setSaveState(res.ok ? "saved" : "failed");
      if (res.ok) savedId = res.id;
    } else {
      setSaveState("failed");
    }
    // Recorded locally as well, so the progress chart and the next quiz work
    // at once -- and offline, where nothing reaches Firestore at all.
    const id = savedId || `local-${Date.now()}`;
    setLastAttemptId(id);
    setHistory((h) => ({ ...h, attempts: [...h.attempts, { id, ...payload }] }));
    setPriorAttempts((n) => n + 1);

    setStage(STAGES.RESULTS);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [quiz, student, account, priorAttempts, requestGuidance]);

  /* ---------------------------------------------------- timer
   * Gates the whole sitting; expiry force-submits whatever is there. */
  useEffect(() => {
    if (stage !== STAGES.CALIBRATION && stage !== STAGES.TECHNICAL) return;
    if (timeLeft === null) return;
    if (timeLeft <= 0) {
      submit();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, timeLeft, submit]);

  const counts = useMemo(
    () => ({
      calibration: bank?.calibration.length || 0,
      technical: bank?.technical.length || 0,
      total: (bank?.calibration.length || 0) + (bank?.technical.length || 0),
    }),
    [bank],
  );

  if (!bank || stage === STAGES.LOADING) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" />
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (stage === STAGES.SIGNIN) {
    return (
      <div className="app">
        <TopBar config={config} stage={stage} theme={theme} setTheme={setTheme} />
        <SignIn config={config} counts={counts} authError={authError} />
      </div>
    );
  }

  if (stage === STAGES.SCORING) {
    return (
      <div className="center-screen">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" />
          <p className="muted">Scoring your attempt…</p>
        </div>
      </div>
    );
  }

  const inQuiz = stage === STAGES.CALIBRATION || stage === STAGES.TECHNICAL;
  const goHome = () => {
    generationAbort.current?.abort();
    setGeneration({ status: "idle" });
    setStage(STAGES.LANDING);
    window.scrollTo({ top: 0, behavior: "auto" });
    // Pick up anything saved from another device or tab meanwhile.
    if (isConfigured && account?.uid) refreshHistory(account.uid);
  };

  return (
    <div className="app">
      <TopBar
        config={config}
        stage={stage}
        theme={theme}
        setTheme={setTheme}
        timeLeft={inQuiz ? timeLeft : null}
        level={inQuiz || stage === STAGES.RESULTS ? quiz?.level : null}
        account={stage === STAGES.LANDING ? account : null}
        onSignOut={stage === STAGES.LANDING ? signOutUser : null}
      />

      {stage === STAGES.LANDING && (
        <Landing
          config={config}
          counts={counts}
          offline={!isConfigured}
          account={account}
          priorAttempts={priorAttempts}
          series={series}
          historyStatus={history.status}
          onStart={startBase}
          onResume={(s) => resumePending(series.pending, s)}
          onContinue={continueFromHome}
        />
      )}

      {stage === STAGES.GENERATING && (
        <Generating generation={generation} onRetry={() => generateFollowUp(generation.args)} onHome={goHome} />
      )}

      {stage === STAGES.CALIBRATION && (
        <CalibrationStage
          key={`cal-${quiz.seriesId}-${quiz.level}`}
          questions={quiz.calibration}
          telemetry={telemetryRef.current}
          onComplete={() => {
            setStage(STAGES.TECHNICAL);
            window.scrollTo({ top: 0, behavior: "auto" });
          }}
        />
      )}

      {stage === STAGES.TECHNICAL && (
        <TechnicalStage
          key={`tech-${quiz.seriesId}-${quiz.level}`}
          questions={quiz.technical}
          telemetry={telemetryRef.current}
          onSubmit={submit}
        />
      )}

      {stage === STAGES.RESULTS && analysis && (
        <Results
          analysis={analysis}
          saveState={saveState}
          rollNumber={student.rollNumber}
          // submit() has already counted this attempt in priorAttempts.
          attemptNumber={priorAttempts}
          guidance={guidance}
          onRetryGuidance={() => requestGuidance(analysis)}
          quiz={quiz}
          seriesLevels={series?.seriesId === quiz?.seriesId ? series.levels : []}
          onNextQuiz={quiz && quiz.level < MAX_LEVEL ? continueFromResults : null}
          onHome={goHome}
        />
      )}
    </div>
  );
}

function TopBar({ config, stage, theme, setTheme, timeLeft, account, onSignOut, level }) {
  const of = level ? `Quiz ${level} of ${MAX_LEVEL} · ` : "";
  const subtitle =
    stage === STAGES.CALIBRATION
      ? `${of}Section 1 — confidence collected`
      : stage === STAGES.TECHNICAL
        ? `${of}Section 2 — confidence predicted`
        : stage === STAGES.GENERATING
          ? "Building your next quiz"
        : stage === STAGES.RESULTS
          ? "Your analysis"
          : config.subtitle;

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="topbar__title">
          {config.title}
          <span>{subtitle}</span>
        </div>

        {timeLeft !== null && timeLeft !== undefined && (
          <span className={`clock ${timeLeft < 120 ? "clock--urgent" : ""}`}>
            {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:
            {String(timeLeft % 60).padStart(2, "0")}
          </span>
        )}

        {account && (
          <span className="whoami" title={account.email}>
            {account.photo ? (
              <img className="whoami__avatar" src={account.photo} alt="" />
            ) : (
              <span className="whoami__avatar whoami__avatar--fallback">
                {(account.name || account.email || "?")[0].toUpperCase()}
              </span>
            )}
            <span className="whoami__email">{account.email}</span>
            {onSignOut && (
              <button type="button" className="whoami__out" onClick={onSignOut}>
                Sign out
              </button>
            )}
          </span>
        )}

        <div className="seg" role="group" aria-label="Colour theme">
          {["light", "system", "dark"].map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
            >
              {t === "system" ? "Auto" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function Generating({ generation, onRetry, onHome }) {
  const level = generation.level;
  return (
    <div className="shell shell--narrow" style={{ paddingTop: 48 }}>
      <div className="card">
        <p className="eyebrow">
          Quiz {level} of {MAX_LEVEL}
        </p>
        {generation.status === "error" ? (
          <>
            <h1 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
              The next quiz could not be built
            </h1>
            <div className="note" style={{ marginTop: 14 }}>
              {generation.error}
            </div>
            <div className="navrow">
              <button type="button" className="btn" onClick={onHome}>
                Back to home
              </button>
              <button type="button" className="btn btn--primary navrow__spacer" onClick={onRetry}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
              Writing quiz {level} around your weak spots
            </h1>
            <p style={{ color: "var(--text-secondary)", marginTop: 8, fontSize: 14.5 }}>
              New questions on the topics you found hardest, each one checked
              against its answer key before you see it. This usually takes
              30–60 seconds; the timer starts only when the quiz does.
            </p>
            <div className="guide-pending" style={{ marginTop: 20 }}>
              <div className="spinner spinner--sm" />
              <span>Generating and checking questions…</span>
            </div>
            <div className="navrow">
              <button type="button" className="btn btn--ghost" onClick={onHome}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
