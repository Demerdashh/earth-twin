"""Does the engine find what we already know? Checks for the validation slide.

* site_percentiles(): for each known analog site, the best score among tiles within a
  radius, as a percentile of all tiles. "Haughton is in the top 3% for crater targets."
* roc_auc(): how well scores separate positives (tiles at known analogs of the right kind)
  from everything else. 0.5 is chance, 1.0 is perfect.
* ablation(): the same AUC with one dimension switched off, to show what it adds.
"""
from __future__ import annotations

import numpy as np
from scipy.stats import rankdata

from .geo import haversine_km
from .scoring import combine


def roc_auc(scores: np.ndarray, positive: np.ndarray) -> float | None:
    scores, positive = np.asarray(scores, float), np.asarray(positive, bool)
    ok = np.isfinite(scores)
    scores, positive = scores[ok], positive[ok]
    n_pos, n_neg = int(positive.sum()), int((~positive).sum())
    if n_pos == 0 or n_neg == 0:
        return None
    ranks = rankdata(scores)  # average ranks for ties
    return float((ranks[positive].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def site_percentiles(lat, lon, total, sites: list, radius_km: float = 100.0):
    lat, lon, total = np.asarray(lat, float), np.asarray(lon, float), np.asarray(total, float)
    report = []
    for site in sites:
        dist = haversine_km(lat, lon, site["lat"], site["lon"])
        near = dist <= radius_km
        if not near.any():
            report.append({"site": site["name"], "status": f"no tile within {radius_km:.0f} km"})
            continue
        best = float(np.nanmax(total[near]))
        pct = float((total < best).mean() * 100)
        report.append({"site": site["name"], "best_score": round(best, 4), "percentile": round(pct, 1),
                       "top_percent": round(100 - pct, 1)})
    return report


def positives_near(lat, lon, sites: list, radius_km: float = 100.0) -> np.ndarray:
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    mask = np.zeros(lat.shape, bool)
    for site in sites:
        mask |= haversine_km(lat, lon, site["lat"], site["lon"]) <= radius_km
    return mask


def ablation(scores: dict, weights: dict, positive: np.ndarray, drop: str) -> dict:
    """AUC with every dimension versus with `drop` removed (weights renormalised)."""
    full, _ = combine(scores, weights)
    reduced_weights = {d: w for d, w in weights.items() if d != drop}
    reduced, _ = combine(scores, reduced_weights)
    return {"dimension": drop, "auc_with": roc_auc(full, positive), "auc_without": roc_auc(reduced, positive)}
