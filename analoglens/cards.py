"""Build the analog fingerprint card for one Earth tile, one target, and one task.

A card answers the statement's three questions in order: what is similar (bars marked
strong), how similar (the scores), and where the analogy breaks (red rows with reasons,
then the fixed limits no place on Earth can reproduce).
"""
from __future__ import annotations

import numpy as np

STRONG, PARTIAL = 0.7, 0.4


def status(score, relative: bool = False) -> str:
    """strong / partial / breaks; "closest on Earth" when the target is out of Earth's reach,
    so a relative score can never be shown as a strong match."""
    if score is None or not np.isfinite(score):
        return "no data"
    if relative:
        return "closest on Earth"
    return "strong" if score >= STRONG else ("partial" if score >= PARTIAL else "breaks")


def _fmt(value, unit: str) -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "n/a"
    v = float(value)
    text = f"{v:,.0f}" if abs(v) >= 100 else (f"{v:.1f}" if abs(v) >= 1 else f"{v:.2f}")
    return f"{text} {unit}".strip().replace("-", "\u2212", 1) if v < 0 else f"{text} {unit}".strip()


def build_card(i: int, tile_id: str, target_key: str, target: dict, task_key: str, task: dict,
               dims_cfg: dict, scores: dict, meta: dict, features: dict, total: float,
               body_limits: list, nearest: dict | None = None, images: dict | None = None) -> dict:
    bars, breaks = [], []
    for dim, weight in sorted(task["weights"].items(), key=lambda kv: -kv[1]):
        if dim not in scores or weight <= 0:
            continue
        spec = dims_cfg[dim]
        raw = scores[dim][i]
        score = None if not np.isfinite(raw) else round(float(raw), 3)
        relative = meta[dim]["mode"] == "relative"
        bar = {"dimension": dim, "label": spec["label"], "weight": weight, "score": score,
               "status": status(raw, relative)}
        feat = spec.get("feature")
        if feat:
            earth_value = features.get(feat, [np.nan] * (i + 1))[i]
            target_value = target["profile"].get(feat)
            bar.update({"earth_value": None if not np.isfinite(earth_value) else round(float(earth_value), 3),
                        "target_value": target_value, "unit": spec.get("unit", "")})
        if relative:
            bar["note"] = "No place on Earth reaches the target value; scored against the closest places on Earth"
            breaks.append({"dimension": dim, "kind": "unreachable",
                           "text": f"{spec['label']}: the target is {_fmt(meta[dim]['target'], spec.get('unit', ''))}; "
                                   f"the closest anywhere on Earth is {_fmt(meta[dim]['best_earth_value'], spec.get('unit', ''))}"})
        elif bar["status"] == "breaks":
            if feat:
                text = (f"{spec['label']}: here {_fmt(bar.get('earth_value'), spec.get('unit', ''))}, "
                        f"target {_fmt(bar.get('target_value'), spec.get('unit', ''))}")
            else:
                text = f"{spec['label']}: landforms differ (similarity {score})"
            breaks.append({"dimension": dim, "kind": "data", "text": text})
        bars.append(bar)
    breaks.extend({"dimension": lim["name"].lower(), "kind": "fixed", "text": lim["text"]} for lim in body_limits)
    return {
        "tile_id": tile_id,
        "target": target_key,
        "target_label": target.get("label", target_key),
        "task": task_key,
        "task_label": task.get("label", task_key),
        "score": round(float(total), 4),
        "strong_for": [b["label"] for b in bars if b["status"] == "strong"],
        "bars": bars,
        "breaks": breaks,
        "tests": task.get("tests", []),
        "nearest_known": nearest,
        "images": images or {},
    }
