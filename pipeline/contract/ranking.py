"""Weighted distance in absolute physical units — the contract's similarity definition.

Mirrors src/rank/ranking.ts exactly (see CLAUDE.md, "Similarity definition").
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from . import COMPARABLE_FEATURES

FeatureValues = Mapping[str, float | None]


@dataclass(frozen=True)
class Candidate:
    id: str
    features: FeatureValues


@dataclass(frozen=True)
class RankedCandidate:
    id: str
    rank: int | None
    distance: float
    score: float
    excluded_by_vegetation: bool
    #: Share of d² contributed by each used feature (sums to 1 when any feature is used).
    contributions: dict[str, float] = field(default_factory=dict)


def distance(
    target: FeatureValues,
    candidate: FeatureValues,
    weights: Mapping[str, float],
    scales: Mapping[str, float],
) -> tuple[float, dict[str, float]]:
    """Return (d, contributions). d = inf when no feature can be compared."""
    num = 0.0
    den = 0.0
    parts: dict[str, float] = {}
    for name in COMPARABLE_FEATURES:
        w = float(weights.get(name, 0.0))
        t = target.get(name)
        c = candidate.get(name)
        if w <= 0 or t is None or c is None:
            continue
        z = (float(c) - float(t)) / float(scales[name])
        term = w * z * z
        parts[name] = term
        num += term
        den += w
    if den == 0:
        return math.inf, {}
    total = sum(parts.values())
    contributions = {k: (v / total if total > 0 else 0.0) for k, v in parts.items()}
    return math.sqrt(num / den), contributions


def is_excluded(candidate: FeatureValues, ndvi_threshold: float) -> bool:
    ndvi = candidate.get("ndvi")
    return ndvi is not None and float(ndvi) > ndvi_threshold


def rank_candidates(
    target: FeatureValues,
    candidates: Iterable[Candidate],
    weights: Mapping[str, float],
    scales: Mapping[str, float],
    ndvi_threshold: float,
) -> list[RankedCandidate]:
    """Rank candidates for one target. Deterministic: ties broken by id."""
    scored: list[tuple[bool, float, str, dict[str, float]]] = []
    for cand in candidates:
        d, parts = distance(target, cand.features, weights, scales)
        scored.append((is_excluded(cand.features, ndvi_threshold), d, cand.id, parts))
    scored.sort(key=lambda s: (s[0], s[1], s[2]))

    out: list[RankedCandidate] = []
    rank = 0
    for excluded, d, cid, parts in scored:
        if not excluded:
            rank += 1
        out.append(
            RankedCandidate(
                id=cid,
                rank=None if excluded else rank,
                distance=d,
                score=0.0 if math.isinf(d) else math.exp(-d),
                excluded_by_vegetation=excluded,
                contributions=parts,
            )
        )
    return out
