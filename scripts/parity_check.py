"""
Python half of the parity harness.

Recomputes the fixture in scripts/parity_test.mjs using numpy and the exported
coefficients, then diffs against the JS output.  Any disagreement means the
browser is scoring a model that was never validated.

    node scripts/parity_test.mjs > /tmp/js.json
    python scripts/parity_check.py /tmp/js.json
"""

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COEF = json.load(open(os.path.join(ROOT, "src", "model", "coefficients.json")))

FEATURES = COEF["features"]
MU = np.array(COEF["scaler"]["mean"])
SD = np.array(COEF["scaler"]["scale"])
W = np.array(COEF["logistic"]["coef"])
B = np.array(COEF["logistic"]["intercept"])
RW = np.array(COEF["ridge"]["coef"])
RB = COEF["ridge"]["intercept"]
CENTRES = np.array(COEF["class_centres"])

DIFF_MAP = {"very easy": 1, "easy": 2, "medium": 3, "moderate": 3,
            "hard": 4, "difficult": 4, "very hard": 5}

CGPA = 7.4


def mk(**kw):
    base = dict(timeSpent=0.0, optionChanges=0, reviewClickCount=0,
                markedForReview=False, isCorrect=False, selectedOption="A",
                type="Reasoning", difficulty="medium", confidenceRating=0)
    base.update(kw)
    return base


CALIB = [
    mk(questionId="cal_1", timeSpent=44.0, optionChanges=1, isCorrect=False, confidenceRating=3),
    mk(questionId="cal_2", timeSpent=91.5, optionChanges=2, reviewClickCount=1,
       markedForReview=True, isCorrect=True, difficulty="hard", confidenceRating=2),
    mk(questionId="cal_3", timeSpent=18.25, isCorrect=True, confidenceRating=5),
]
TECH = [
    mk(questionId="tech_1", timeSpent=62.0, optionChanges=1, isCorrect=True, type="Theory"),
    mk(questionId="tech_2", timeSpent=12.5, isCorrect=False, type="Apply"),
    mk(questionId="tech_3", timeSpent=155.0, optionChanges=3, reviewClickCount=2,
       markedForReview=True, isCorrect=False, type="Theory", difficulty="hard"),
    mk(questionId="tech_4", timeSpent=0.0, selectedOption="", isCorrect=False, type="Apply"),
]
ALL = CALIB + TECH


def clip(v, lo, hi):
    return min(hi, max(lo, v))


def loo_stats(ratings, exclude=-1):
    r = np.array([v for i, v in enumerate(ratings) if i != exclude], dtype=float)
    return {
        "calib_mean": r.mean(),
        "calib_std": r.std(ddof=0),
        "calib_min": r.min(),
        "calib_max": r.max(),
        "calib_range": r.max() - r.min(),
        "calib_high_frac": float((r == 5).mean()),
        "calib_low_frac": float((r <= 2).mean()),
    }


def attempt_context(items):
    times = [clip(i["timeSpent"], 0, 900) for i in items]
    log_times = [np.log1p(t) for t in times]
    changes = [clip(i["optionChanges"], 0, 10) for i in items]
    return {
        "meanLogTime": float(np.mean(log_times)),
        "att_log_total_time": float(np.log1p(sum(times))),
        "att_mean_changes": float(np.mean(changes)),
        "att_n_items": len(items),
        "att_unans_frac": sum(1 for i in items if not i["selectedOption"]) / len(items),
        "n": len(items),
    }


def build_features(item, index, ctx, calib):
    t = clip(item["timeSpent"], 0, 900)
    log_time = float(np.log1p(t))
    time_rel = log_time - ctx["meanLogTime"]
    changes = clip(item["optionChanges"], 0, 10)
    reviews = clip(item["reviewClickCount"], 0, 10)
    marked = 1.0 if item["markedForReview"] else 0.0

    f = dict(calib)
    f.update({
        "is_correct": 1.0 if item["isCorrect"] else 0.0,
        "log_time": log_time,
        "time_rel_attempt": time_rel,
        "option_changes": changes,
        "any_option_change": 1.0 if changes > 0 else 0.0,
        "marked_for_review": marked,
        "review_click_count": reviews,
        "hesitated": 1.0 if (changes > 0 or marked > 0 or reviews > 0 or time_rel > 0) else 0.0,
        "q_position_frac": index / (ctx["n"] - 1) if ctx["n"] > 1 else 0.0,
        "q_difficulty_num": DIFF_MAP.get(str(item["difficulty"]).strip().lower(), 3),
        "q_is_theory": 1.0 if "theor" in str(item["type"]).lower() else 0.0,
        "att_log_total_time": ctx["att_log_total_time"],
        "att_unans_frac": ctx["att_unans_frac"],
        "att_mean_changes": ctx["att_mean_changes"],
        "att_n_items": float(ctx["att_n_items"]),
        "student_cgpa": CGPA,
    })
    raw = np.array([float(f[name]) for name in FEATURES])
    return (raw - MU) / SD


def predict(x):
    logits = W @ x + B
    e = np.exp(logits - logits.max())
    probs = e / e.sum()
    ridge = float(np.clip(RW @ x + RB, 1, 5))
    expected = float(probs @ CENTRES)
    var = float(probs @ (CENTRES - expected) ** 2)
    return {
        "probs": probs.tolist(),
        "ridge": ridge,
        "expected": expected,
        "confidence": 0.5 * ridge + 0.5 * expected,
        "sd": float(np.sqrt(var)),
    }


def main():
    if len(sys.argv) < 2:
        print("usage: python scripts/parity_check.py /tmp/js.json")
        return 2
    js = json.load(open(sys.argv[1]))

    ctx = attempt_context(ALL)
    ratings = [i["confidenceRating"] for i in CALIB]

    failures = []

    def cmp(label, a, b, tol=1e-9):
        a = np.atleast_1d(np.asarray(a, dtype=float))
        b = np.atleast_1d(np.asarray(b, dtype=float))
        if a.shape != b.shape:
            failures.append(f"{label}: shape {a.shape} vs {b.shape}")
            return
        d = float(np.max(np.abs(a - b)))
        status = "ok " if d <= tol else "FAIL"
        if d > tol:
            failures.append(f"{label}: max abs diff {d:.3e}")
        print(f"  [{status}] {label:<34} max|diff| = {d:.3e}")

    print("context")
    for k in ["meanLogTime", "att_log_total_time", "att_mean_changes",
              "att_n_items", "att_unans_frac"]:
        cmp(k, ctx[k], js["context"][k])

    print("\nleave-one-out statistics")
    full = loo_stats(ratings, -1)
    cmp("looAll", [full[k] for k in sorted(full)],
        [js["looAll"][k] for k in sorted(full)])
    for i in range(3):
        h = loo_stats(ratings, i)
        cmp(f"looHoldout[{i}]", [h[k] for k in sorted(h)],
            [js["looHoldout"][i][k] for k in sorted(h)])

    print("\nstandardised feature vectors")
    for idx, item in enumerate(ALL):
        calib = loo_stats(ratings, idx) if idx < 3 else full
        x = build_features(item, idx, ctx, calib)
        cmp(f"x[{idx}] {item['questionId']}", x, js["vectors"][idx])

    print("\npredictions")
    for idx, item in enumerate(ALL):
        calib = loo_stats(ratings, idx) if idx < 3 else full
        p = predict(build_features(item, idx, ctx, calib))
        jp = js["predictions"][idx]
        cmp(f"probs[{idx}]", p["probs"], jp["probs"])
        cmp(f"ridge[{idx}]", p["ridge"], jp["ridge"])
        cmp(f"confidence[{idx}]", p["confidence"], jp["confidence"])
        cmp(f"sd[{idx}]", p["sd"], jp["sd"])

    print("\n" + "=" * 60)
    if failures:
        print(f"PARITY FAILED — {len(failures)} mismatch(es)")
        for f in failures:
            print("  " + f)
        return 1
    print("PARITY OK — JS and Python agree to 1e-9 on every value")
    return 0


if __name__ == "__main__":
    sys.exit(main())
