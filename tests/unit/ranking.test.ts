import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnalogsFile, EarthCandidatesFile, TargetsFile, Weights } from '../../src/contract/types';
import { distance, rankCandidates } from '../../src/rank/ranking';

const mock = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../public/data/mock/${name}`, import.meta.url), 'utf8'));
const candidates = mock('earth_candidates.json') as EarthCandidatesFile;
const targets = mock('targets.json') as TargetsFile;
const scales = candidates.feature_scales;
const W: Weights = {
  elevation_m: 0,
  slope_deg: 1,
  roughness: 1,
  temp_range_k: 1,
  mineral_index: 1,
  ice_indicator: 0.5,
};
const T = { elevation_m: 0, slope_deg: 10, roughness: 50, temp_range_k: 80, mineral_index: 0.5, ice_indicator: 0.1 };

describe('distance', () => {
  it('is zero for identical features', () => {
    expect(distance(T, T, W, scales).d).toBe(0);
  });
  it('uses fixed physical scales, not percentiles', () => {
    const { d, contributions } = distance(T, { ...T, slope_deg: 15 }, W, scales);
    expect(d).toBeCloseTo(Math.sqrt(1 / 4.5), 10);
    expect(contributions.slope_deg).toBeCloseTo(1, 10);
  });
  it('skips null values and zero weights', () => {
    expect(distance(T, { ...T, temp_range_k: null, elevation_m: 99999 }, W, scales).d).toBe(0);
  });
  it('is infinite when nothing can be compared', () => {
    expect(distance(T, {}, W, scales).d).toBe(Infinity);
  });
});

describe('rankCandidates', () => {
  it('excludes vegetated candidates and ranks them last', () => {
    const r = rankCandidates(
      T,
      [
        { id: 'green', features: { ...T, ndvi: 0.8 } },
        { id: 'far', features: { ...T, slope_deg: 30, ndvi: 0 } },
        { id: 'near', features: { ...T, ndvi: 0.1 } },
      ],
      W,
      scales,
      0.3,
    );
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      ['near', 1],
      ['far', 2],
      ['green', null],
    ]);
  });

  it('reorders when weights change', () => {
    const a = { id: 'a', features: { ...T, slope_deg: 20 } };
    const b = { id: 'b', features: { ...T, temp_range_k: 130 } };
    expect(rankCandidates(T, [a, b], { ...W, slope_deg: 5, temp_range_k: 0.1 }, scales, 0.3)[0]?.id).toBe('b');
    expect(rankCandidates(T, [a, b], { ...W, slope_deg: 0.1, temp_range_k: 5 }, scales, 0.3)[0]?.id).toBe('a');
  });

  it('matches the Python pipeline ranking exported in analogs_<target>.geojson (parity)', () => {
    for (const t of targets.targets) {
      const exported = mock(`analogs_${t.id}.geojson`) as AnalogsFile;
      const pool = candidates.candidates.filter((c) => candidates.per_target[t.id]?.includes(c.id));
      const ts = rankCandidates(t.features, pool, exported.weights, scales, candidates.ndvi_threshold);
      expect(ts.map((r) => r.id)).toEqual(exported.features.map((f) => f.properties.candidate_id));
      ts.forEach((r, i) => expect(r.score).toBeCloseTo(exported.features[i]!.properties.score, 5));
    }
  });

  it('mock slider weights visibly change the order for every target', () => {
    for (const t of targets.targets) {
      const base = rankCandidates(
        t.features,
        candidates.candidates,
        candidates.default_weights,
        scales,
        candidates.ndvi_threshold,
      ).map((r) => r.id);
      const tweaked = rankCandidates(
        t.features,
        candidates.candidates,
        { ...candidates.default_weights, temp_range_k: 0, slope_deg: 3 },
        scales,
        candidates.ndvi_threshold,
      ).map((r) => r.id);
      expect(tweaked).not.toEqual(base);
    }
  });
});
