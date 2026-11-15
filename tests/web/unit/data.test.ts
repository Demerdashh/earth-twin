import { describe, expect, it } from 'vitest';
import { ContractError, checkCard, checkManifest, checkRank } from '../../../src/data/out';
import { buildGraph, rankedRegions, targetRegionId } from '../../../src/data/regions';

const manifest = {
  generated: '2026-11-15T03:00:00+00:00',
  synthetic: false,
  embedder: 'descriptors',
  res_m: 463,
  tile_px: 64,
  earth_tiles: 1200,
  targets: ['medusae_fossae'],
  novelty_km: 200,
};
const result = {
  rank: 1,
  tile_id: 'EG00042',
  lat: 25.4,
  lon: 30.5,
  score: 0.71,
  coverage: 1,
  dims: { slope: 0.9 },
  novel: false,
  nearest_known: 'Kharga Depression',
  nearest_known_km: 12,
};

describe('pipeline output guards', () => {
  it('accept real output', () => {
    expect(checkManifest(manifest).earth_tiles).toBe(1200);
    expect(
      checkRank({ target: 'medusae_fossae', task: 'rover_mobility', synthetic: false, results: [result] }, 'r').results,
    ).toHaveLength(1);
  });

  it('refuse synthetic output everywhere (no sample_out numbers can reach the page)', () => {
    expect(() => checkManifest({ ...manifest, synthetic: true })).toThrow(ContractError);
    expect(() => checkManifest({ ...manifest, synthetic: undefined })).toThrow(/synthetic/);
    expect(() => checkRank({ target: 't', task: 'k', synthetic: true, results: [] }, 'r')).toThrow(/synthetic/);
    expect(() => checkCard({ synthetic: true }, 'c')).toThrow(/synthetic/);
  });

  it('reject malformed files with the file name', () => {
    expect(() =>
      checkRank({ target: 't', task: 'k', synthetic: false, results: [{ ...result, lat: 200 }] }, 'rank/x.json'),
    ).toThrow(/rank\/x\.json.*lat/);
    expect(() =>
      checkRank({ target: 't', task: 'k', synthetic: false, results: [{ ...result, score: 1.4 }] }, 'r'),
    ).toThrow(/score/);
  });
});

describe('regions and links from the real config', () => {
  const g = buildGraph();
  const linkedTo = (target: string): string[] =>
    g.links.filter((l) => l.from === targetRegionId(target)).map((l) => g.regions.find((r) => r.id === l.to)!.name);

  it('places only targets that have coordinates', () => {
    const targets = g.regions.filter((r) => r.kind === 'target').map((r) => r.targetKey);
    expect(targets).toContain('medusae_fossae');
    expect(targets).not.toContain('malapert_massif'); // lat/lon still null in config
    expect(g.pendingTargets.map((t) => t.key)).toContain('malapert_massif');
  });

  it('links Medusae Fossae to the yardang/aeolian sites and the Egypt sites that name it', () => {
    const names = linkedTo('medusae_fossae');
    expect(names).toEqual(
      expect.arrayContaining(['Lut Desert yardangs, Iran', 'Death Valley', 'Kharga Depression', 'Great Sand Sea']),
    );
  });

  it('ignores generic body tags such as "mars" when linking', () => {
    // Atacama is tagged only hyperarid + mars: it must not link to every Mars target.
    expect(linkedTo('medusae_fossae')).not.toContain('Atacama Desert (Yungay)');
  });

  it('turns ranked tiles into Earth regions linked to their target', () => {
    const r = rankedRegions('medusae_fossae', 'rover_mobility', [result]);
    expect(r.regions[0]).toMatchObject({ body: 'earth', kind: 'ranked', lat: 25.4 });
    expect(r.links[0]).toMatchObject({ from: targetRegionId('medusae_fossae'), kind: 'ranked' });
  });
});
