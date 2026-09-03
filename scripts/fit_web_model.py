"""
fit_web_model.py — fit the browser-side confidence model for BIS-quiz.

Constraint: the web app has Firestore only (no inference server), so the model
must be small enough to evaluate in JavaScript.  That means:

  * multinomial logistic regression  -> P(Low), P(Med), P(High)
  * ridge regression                 -> expected 1-5 confidence (for the line plot)

Both export as plain JSON weight vectors.

Features are restricted to what `Bis-quiz` telemetry actually logs in the
browser, plus the leave-one-out statistics over the CALIBRATION ratings.

Protocol (non-negotiable, CONTEXT.md sec.10):
  * GroupKFold by student_uid
  * calibration items drawn at random per attempt, 8 shuffles
  * scored ONLY on non-calibration rows
  * accuracy always reported next to its majority-class baseline + min-class recall

Usage:
    conda activate badminton
    python scripts/fit_web_model.py
"""

import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    cohen_kappa_score,
    f1_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PKL = os.path.join(os.path.dirname(ROOT), "cleaned.pkl")
OUT_JSON = os.path.join(ROOT, "src", "model", "coefficients.json")
OUT_CSV = os.path.join(ROOT, "scripts", "fit_web_model_results.csv")

K_CALIB = 3         # CONTEXT.md sec.7 -- k=3 is the knee
N_SHUFFLES = 8
N_FOLDS = 5
SEED = 17

# ---------------------------------------------------------------- target
# Bucketing C (CONTEXT.md sec.5): 1-2 -> Low, 3-4 -> Med, 5 -> High
CLASS_NAMES = ["Low", "Medium", "High"]
CLASS_CENTRES = [1.5, 3.5, 5.0]   # for the expected-value line


def bucket_c(v):
    v = int(v)
    if v <= 2:
        return 0
    if v <= 4:
        return 1
    return 2


# ------------------------------------------------------- feature builder
# Every feature here must be computable in the browser from telemetry the
# quiz already logs.  Names are mirrored 1:1 in src/model/predict.js.
FEATURES = [
    # --- calibration-block leave-one-out statistics (the load-bearing block)
    "calib_mean",          # mean of the OTHER calibration ratings
    "calib_std",
    "calib_min",
    "calib_max",
    "calib_range",
    "calib_high_frac",     # fraction of calibration ratings == 5
    "calib_low_frac",      # fraction of calibration ratings <= 2
    # --- per-question behaviour
    "is_correct",
    "log_time",
    "time_rel_attempt",    # log_time - attempt mean log_time
    "option_changes",
    "any_option_change",
    "marked_for_review",
    "review_click_count",
    "hesitated",
    "q_position_frac",
    # --- question metadata
    "q_difficulty_num",
    "q_is_theory",
    # --- attempt-level context
    "att_log_total_time",
    "att_unans_frac",
    "att_mean_changes",
    "att_n_items",
    "student_cgpa",
]

DIFF_MAP = {
    "very easy": 1, "easy": 2, "medium": 3, "moderate": 3,
    "hard": 4, "difficult": 4, "very hard": 5,
}


def load_frame():
    print(f"loading {PKL} ...", flush=True)
    df = pd.read_pickle(PKL)
    keep = [c for c in df.columns if not c.startswith("sbert_")]
    df = df[keep].copy()

    # `conf_valid` is the cleaned rating: NaN where the item was never answered,
    # answered-but-rated-0 already clipped to 1 (CONTEXT.md sec.3).
    df = df.dropna(subset=["conf_valid", "attempt_id", "student_uid"]).copy()
    df["confidence_rating"] = df["conf_valid"].astype(int)
    df = df[df["confidence_rating"].between(1, 5)]
    print(f"  {len(df):,} answered+rated rows  "
          f"{df['attempt_id'].nunique():,} attempts  "
          f"{df['student_uid'].nunique():,} students", flush=True)
    return df


def engineer(df):
    d = df.copy()
    d["confidence_rating"] = d["confidence_rating"].astype(int)
    d["y"] = d["confidence_rating"].map(bucket_c)

    d["time_spent"] = pd.to_numeric(d["time_spent"], errors="coerce").fillna(0).clip(0, 900)
    d["log_time"] = np.log1p(d["time_spent"])
    d["option_changes"] = pd.to_numeric(d["option_changes"], errors="coerce").fillna(0).clip(0, 10)
    d["review_click_count"] = pd.to_numeric(d["review_click_count"], errors="coerce").fillna(0).clip(0, 10)
    d["marked_for_review"] = d["marked_for_review"].astype(float).fillna(0)
    d["is_correct"] = d["is_correct"].astype(float).fillna(0)
    d["any_option_change"] = (d["option_changes"] > 0).astype(float)
    d["student_cgpa"] = pd.to_numeric(d["student_cgpa"], errors="coerce")
    d["student_cgpa"] = d["student_cgpa"].fillna(d["student_cgpa"].median())

    # attempt-relative time (browser-computable: it is just the sitting's own mean)
    g = d.groupby("attempt_id")
    d["_att_mean_logtime"] = g["log_time"].transform("mean")
    d["time_rel_attempt"] = d["log_time"] - d["_att_mean_logtime"]
    d["att_log_total_time"] = np.log1p(g["time_spent"].transform("sum"))
    d["att_mean_changes"] = g["option_changes"].transform("mean")
    d["att_n_items"] = g["question_id"].transform("count")
    if "att_unans_frac" in d.columns:
        d["att_unans_frac"] = pd.to_numeric(d["att_unans_frac"], errors="coerce").fillna(0)
    else:
        d["att_unans_frac"] = 0.0

    # hesitation flag -- the deterministic rule from CONTEXT.md sec.13
    d["hesitated"] = (
        (d["option_changes"] > 0)
        | (d["marked_for_review"] > 0)
        | (d["review_click_count"] > 0)
        | (d["time_rel_attempt"] > 0)
    ).astype(float)

    d["q_position_frac"] = g.cumcount() / np.maximum(d["att_n_items"] - 1, 1)

    diff = d["q_difficulty"].astype(str).str.strip().str.lower()
    d["q_difficulty_num"] = diff.map(DIFF_MAP).fillna(3.0)
    qt = d["q_type"].astype(str).str.strip().str.lower()
    d["q_is_theory"] = qt.str.contains("theor").astype(float)

    return d


def add_calibration_features(d, rng):
    """Pick K_CALIB items per attempt, then build LOO stats over their ratings.

    Calibration rows get TRUE leave-one-out stats (their own rating excluded);
    non-calibration rows see the whole calibration block.  This mirrors exactly
    what predict.js does in the browser.
    """
    d = d.sort_values(["attempt_id"]).reset_index(drop=True)
    is_calib = np.zeros(len(d), dtype=bool)

    idx_by_attempt = d.groupby("attempt_id").indices
    for att, idx in idx_by_attempt.items():
        if len(idx) <= K_CALIB:
            continue
        pick = rng.choice(idx, size=K_CALIB, replace=False)
        is_calib[pick] = True
    d["is_calib"] = is_calib

    cols = ["calib_mean", "calib_std", "calib_min", "calib_max",
            "calib_range", "calib_high_frac", "calib_low_frac"]
    out = np.full((len(d), len(cols)), np.nan)

    for att, idx in idx_by_attempt.items():
        sub = d.iloc[idx]
        cal_pos = idx[sub["is_calib"].values]
        if len(cal_pos) < 2:
            continue
        ratings = d.loc[cal_pos, "confidence_rating"].values.astype(float)
        for row in idx:
            if row in set(cal_pos):
                r = np.array([v for p, v in zip(cal_pos, ratings) if p != row])
            else:
                r = ratings
            if len(r) == 0:
                continue
            out[row] = [
                r.mean(),
                r.std(ddof=0),
                r.min(),
                r.max(),
                r.max() - r.min(),
                float((r == 5).mean()),
                float((r <= 2).mean()),
            ]

    for j, c in enumerate(cols):
        d[c] = out[:, j]
    return d.dropna(subset=cols)


def evaluate(y, pred, proba, tag):
    base = pd.Series(y).value_counts(normalize=True).max()
    row = {
        "split": tag,
        "n": len(y),
        "accuracy": accuracy_score(y, pred),
        "baseline": base,
        "balanced_acc": balanced_accuracy_score(y, pred),
        "macro_f1": f1_score(y, pred, average="macro"),
        "min_class_recall": recall_score(y, pred, average=None, zero_division=0).min(),
        "qwk": cohen_kappa_score(y, pred, weights="quadratic"),
    }
    try:
        row["auc_ovr"] = roc_auc_score(y, proba, multi_class="ovr", average="macro")
    except Exception:
        row["auc_ovr"] = np.nan
    return row


def main():
    df = load_frame()
    d0 = engineer(df)

    rows = []
    fold_logit_coefs, fold_logit_int = [], []
    fold_ridge_coefs, fold_ridge_int = [], []
    scaler_means, scaler_scales = [], []

    for shuf in range(N_SHUFFLES):
        rng = np.random.default_rng(SEED + shuf)
        d = add_calibration_features(d0, rng)

        X = d[FEATURES].astype(float).values
        y = d["y"].values
        yc = d["confidence_rating"].astype(float).values
        groups = d["student_uid"].values
        eval_mask = ~d["is_calib"].values          # score on NON-calibration rows only

        gkf = GroupKFold(n_splits=N_FOLDS)
        oof_pred = np.zeros(len(d), dtype=int)
        oof_proba = np.zeros((len(d), 3))

        for tr, te in gkf.split(X, y, groups):
            sc = StandardScaler().fit(X[tr])
            Xtr, Xte = sc.transform(X[tr]), sc.transform(X[te])

            clf = LogisticRegression(
                max_iter=2000, C=1.0, multi_class="multinomial",
                class_weight="balanced", solver="lbfgs",
            ).fit(Xtr, y[tr])
            rdg = Ridge(alpha=5.0).fit(Xtr, yc[tr])

            oof_proba[te] = clf.predict_proba(Xte)
            oof_pred[te] = clf.predict(Xte)

            if shuf == 0:
                fold_logit_coefs.append(clf.coef_)
                fold_logit_int.append(clf.intercept_)
                fold_ridge_coefs.append(rdg.coef_)
                fold_ridge_int.append(rdg.intercept_)
                scaler_means.append(sc.mean_)
                scaler_scales.append(sc.scale_)

        r = evaluate(y[eval_mask], oof_pred[eval_mask], oof_proba[eval_mask],
                     f"shuffle{shuf}")
        r["shuffle"] = shuf
        rows.append(r)
        print(f"  shuffle {shuf}: acc={r['accuracy']:.4f} "
              f"(base {r['baseline']:.4f})  bal={r['balanced_acc']:.4f} "
              f"minrec={r['min_class_recall']:.4f}  auc={r['auc_ovr']:.4f}",
              flush=True)

    res = pd.DataFrame(rows)
    res.to_csv(OUT_CSV, index=False)

    print("\n" + "=" * 68)
    print(f"CALIBRATION-BLOCK MODEL  (k={K_CALIB}, {N_SHUFFLES} shuffles, "
          f"{N_FOLDS}-fold GroupKFold by student)")
    print("=" * 68)
    summary = {}
    for c in ["accuracy", "baseline", "balanced_acc", "macro_f1",
              "min_class_recall", "qwk", "auc_ovr"]:
        m, s = res[c].mean(), res[c].std()
        summary[c] = float(m)
        summary[c + "_sd"] = float(s)
        print(f"  {c:<18} {m:.4f}  (sd {s:.4f})")
    print(f"  {'lift over baseline':<18} "
          f"{(res['accuracy'].mean() - res['baseline'].mean()) * 100:+.2f} pts")

    # ---- final export: average the fold models (all share the same scaler space
    #      only after we also average the scaler; folds differ by <1% here)
    mean_mu = np.mean(scaler_means, axis=0)
    mean_sd = np.mean(scaler_scales, axis=0)
    logit_W = np.mean(fold_logit_coefs, axis=0)
    logit_b = np.mean(fold_logit_int, axis=0)
    ridge_w = np.mean(fold_ridge_coefs, axis=0)
    ridge_b = float(np.mean(fold_ridge_int))

    payload = {
        "_meta": {
            "generated_by": "scripts/fit_web_model.py",
            "source": os.path.basename(PKL),
            "k_calibration": K_CALIB,
            "bucketing": "C  (1-2 Low / 3-4 Med / 5 High)",
            "protocol": f"{N_FOLDS}-fold GroupKFold by student_uid, "
                        f"{N_SHUFFLES} random calibration draws, "
                        f"scored on non-calibration rows only",
            "caveat": "Validated with SAME-SUBJECT calibration items. "
                      "The deployed app uses generic-reasoning calibration "
                      "items; CONTEXT.md sec.7 measured cross-domain transfer "
                      "at r=0.557 vs 0.794 within-subject, so expect roughly "
                      "6-12 accuracy points below the figures reported here.",
        },
        "metrics": summary,
        "features": FEATURES,
        "scaler": {"mean": mean_mu.tolist(), "scale": mean_sd.tolist()},
        "logistic": {
            "classes": CLASS_NAMES,
            "coef": logit_W.tolist(),
            "intercept": logit_b.tolist(),
        },
        "ridge": {"coef": ridge_w.tolist(), "intercept": ridge_b},
        "class_centres": CLASS_CENTRES,
    }

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nwrote {OUT_JSON}")
    print(f"wrote {OUT_CSV}")

    # feature importance readout (standardised coefficients)
    imp = pd.DataFrame({
        "feature": FEATURES,
        "abs_logit": np.abs(logit_W).max(axis=0),
        "ridge": ridge_w,
    }).sort_values("abs_logit", ascending=False)
    print("\ntop features (|standardised logistic coef|):")
    print(imp.head(14).to_string(index=False))


if __name__ == "__main__":
    sys.exit(main())
