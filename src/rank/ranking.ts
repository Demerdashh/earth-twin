// Weighted distance in absolute physical units — the contract's similarity definition.
// Mirrors pipeline/contract/ranking.py exactly (CLAUDE.md, "Similarity definition").
import {
  COMPARABLE_FEATURES,
  type ComparableFeature,
  type FeatureValues,
  type Scales,
  type Weights,
} from '../contract/types';

export interface RankInput {
  id: string;
  features: FeatureValues;
}

export interface Ranked {
  id: string;
  /** 1-based; null when excluded by the vegetation filter. */
  rank: number | null;
  distance: number;
  score: number;
  excludedByVegetation: boolean;
  /** Share of d² from each used feature (sums to 1 when any feature is used). */
  contributions: Partial<Record<ComparableFeature, number>>;
}

export function distance(
  target: FeatureValues,
  candidate: FeatureValues,
  weights: Weights,
  scales: Scales,
): { d: number; contributions: Partial<Record<ComparableFeature, number>> } {
  let num = 0;
  let den = 0;
  const parts: Partial<Record<ComparableFeature, number>> = {};
  for (const name of COMPARABLE_FEATURES) {
    const w = weights[name];
    const t = target[name];
    const c = candidate[name];
    if (!(w > 0) || t == null || c == null) continue;
    const z = (c - t) / scales[name];
    const term = w * z * z;
    parts[name] = term;
    num += term;
    den += w;
  }
  if (den === 0) return { d: Infinity, contributions: {} };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const contributions: Partial<Record<ComparableFeature, number>> = {};
  for (const [k, v] of Object.entries(parts) as [ComparableFeature, number][]) {
    contributions[k] = total > 0 ? v / total : 0;
  }
  return { d: Math.sqrt(num / den), contributions };
}

export const isExcluded = (c: FeatureValues, ndviThreshold: number): boolean =>
  c.ndvi != null && c.ndvi > ndviThreshold;

/** Python's sort on (excluded, d, id): ids compare by code point, like Python str. */
const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function rankCandidates(
  target: FeatureValues,
  candidates: readonly RankInput[],
  weights: Weights,
  scales: Scales,
  ndviThreshold: number,
): Ranked[] {
  const scored = candidates.map((c) => {
    const { d, contributions } = distance(target, c.features, weights, scales);
    return { id: c.id, d, contributions, excluded: isExcluded(c.features, ndviThreshold) };
  });
  scored.sort((a, b) => Number(a.excluded) - Number(b.excluded) || a.d - b.d || cmpId(a.id, b.id));
  let rank = 0;
  return scored.map((s) => {
    if (!s.excluded) rank += 1;
    return {
      id: s.id,
      rank: s.excluded ? null : rank,
      distance: s.d,
      score: Number.isFinite(s.d) ? Math.exp(-s.d) : 0,
      excludedByVegetation: s.excluded,
      contributions: s.contributions,
    };
  });
}
