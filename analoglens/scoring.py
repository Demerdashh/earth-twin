"""Per-dimension similarity, task weighting, and ranking.

Rules that matter for honesty:
* Each dimension is scored separately (0 to 1) so the card can say where an analog holds
  and where it breaks.
* Dimensions are combined with a weighted geometric mean: one terrible dimension drags the
  total down instead of hiding behind good ones.
* Some targets cannot be reached anywhere on Earth (no Earth place gets to -203 C). Those
  dimensions are marked "earth_relative" in config: if no tile comes close, tiles are scored
  by how close they get relative to the rest of Earth, and the card states the gap.
* Missing data never counts as a match: weights are renormalised per tile and the total is
  scaled by coverage.
"""
from __future__ import annotations

import math

import numpy as np

from .geo import haversine_km

FLOOR = 0.02          # smallest per-dimension score used inside the geometric mean
REACHABLE = 0.6       # a dimension is "reachable" if some Earth tile scores at least this


def gaussian_similarity(x, target: float, sigma: float, log: bool = False) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if log:
        x = np.log(np.maximum(x, 1e-3))
        target = math.log(max(target, 1e-3))
    return np.exp(-0.5 * ((x - target) / sigma) ** 2)


def _closeness_percentile(distance: np.ndarray) -> np.ndarray:
    """1 for the closest tile on Earth, 0 for the farthest; NaN stays NaN."""
    out = np.full(distance.shape, np.nan)
    ok = np.isfinite(distance)
    n = int(ok.sum())
    if n == 0:
        return out
    order = np.argsort(distance[ok])
    ranks = np.empty(n)
    ranks[order] = np.arange(n)
    out[ok] = 1.0 - ranks / max(n - 1, 1)
    return out


def dimension_scores(features: dict, profile: dict, dims_cfg: dict, shape_scores=None):
    """Score every tile on every dimension the target has a value for.

    features: {feature_name: array over tiles}; profile: the target's values by feature name.
    Returns (scores, meta): scores[dim] is an array over tiles; meta[dim] describes how it
    was scored (absolute or relative) and, for relative ones, Earth's best value.
    """
    scores, meta = {}, {}
    for dim, spec in dims_cfg.items():
        if spec.get("kind") == "embedding":
            if shape_scores is not None:
                scores[dim] = np.asarray(shape_scores, dtype=float)
                meta[dim] = {"mode": "absolute", "reachable": True}
            continue
        feat = spec["feature"]
        target = profile.get(feat)
        if target is None or feat not in features:
            continue
        x = np.asarray(features[feat], dtype=float)
        s_abs = gaussian_similarity(x, target, spec["sigma"], spec.get("log", False))
        reachable = bool(np.nanmax(s_abs) >= REACHABLE) if np.isfinite(s_abs).any() else False
        if reachable or not spec.get("earth_relative", False):
            scores[dim] = s_abs
            meta[dim] = {"mode": "absolute", "reachable": reachable, "target": target}
        else:
            if spec.get("log", False):
                dist = np.abs(np.log(np.maximum(x, 1e-3)) - math.log(max(target, 1e-3)))
            else:
                dist = np.abs(x - target)
            scores[dim] = _closeness_percentile(dist)
            best = int(np.nanargmin(dist))
            meta[dim] = {"mode": "relative", "reachable": False, "target": target,
                         "best_earth_value": float(x[best])}
    return scores, meta


def combine(scores: dict, weights: dict):
    """Weighted geometric mean over the dimensions a task uses. Returns (total, coverage)."""
    dims = [d for d, w in weights.items() if w > 0 and d in scores]
    if not dims:
        raise ValueError("none of the task's dimensions have scores for this target")
    n = len(scores[dims[0]])
    num, den = np.zeros(n), np.zeros(n)
    for d in dims:
        s = np.asarray(scores[d], dtype=float)
        ok = np.isfinite(s)
        num[ok] += weights[d] * np.log(np.maximum(s[ok], FLOOR))
        den[ok] += weights[d]
    coverage = den / sum(weights[d] for d in dims)
    total = np.where(den > 0, np.exp(num / np.maximum(den, 1e-12)), 0.0) * coverage
    return total, coverage


def nearest_known(lat, lon, known_sites: list):
    """Distance (km) to the closest known analog site and that site's index for every tile."""
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    if not known_sites:
        return np.full(lat.shape, np.inf), np.full(lat.shape, -1)
    klat = np.array([k["lat"] for k in known_sites], float)
    klon = np.array([k["lon"] for k in known_sites], float)
    dist = haversine_km(lat[:, None], lon[:, None], klat[None, :], klon[None, :])
    return dist.min(axis=1), dist.argmin(axis=1)


def rank(ids, lat, lon, scores: dict, weights: dict, known_sites=None, novelty_km: float = 200.0,
         top: int = 50):
    """Rank tiles for one target and task. Returns (results, total) where results is a list
    of JSON-ready dicts (best first) and total is the full score array."""
    total, coverage = combine(scores, weights)
    dist_km, which = nearest_known(lat, lon, known_sites or [])
    order = np.argsort(-total)[:top]
    used = [d for d, w in weights.items() if w > 0 and d in scores]
    results = []
    for rank_no, i in enumerate(order, start=1):
        near = int(which[i])
        results.append({
            "rank": rank_no,
            "tile_id": str(ids[i]),
            "lat": round(float(lat[i]), 4),
            "lon": round(float(lon[i]), 4),
            "score": round(float(total[i]), 4),
            "coverage": round(float(coverage[i]), 3),
            "dims": {d: (None if not np.isfinite(scores[d][i]) else round(float(scores[d][i]), 3)) for d in used},
            "novel": bool(dist_km[i] > novelty_km),
            "nearest_known": known_sites[near]["name"] if near >= 0 else None,
            "nearest_known_km": None if not np.isfinite(dist_km[i]) else round(float(dist_km[i]), 1),
        })
    return results, total
