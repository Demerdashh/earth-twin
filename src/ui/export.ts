import type { Ctx } from '../app/context';
import { EARTH_FEATURES, type AnalogsFile } from '../contract/types';
import { download } from './dom';

/** Current ranking as an analogs.schema.json-shaped FeatureCollection. */
export function buildGeoJson(ctx: Ctx): AnalogsFile {
  const { targetId, weights } = ctx.store.get();
  const rows = ctx.rank(targetId);
  const mock = ctx.data.mock;
  return {
    schema_version: '1.0',
    mock,
    ...(mock ? { note: 'Exported from Analog Finder using MOCK data — not measurements.' } : {}),
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    generator: 'analog-finder web export (user weights)',
    type: 'FeatureCollection',
    target_id: targetId,
    weights,
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.candidate.lon, r.candidate.lat] },
      properties: {
        candidate_id: r.id,
        name: r.candidate.name,
        rank: r.rank,
        score: Number(r.score.toFixed(6)),
        distance: Number.isFinite(r.distance) ? Number(r.distance.toFixed(6)) : 0,
        known_analog_id: r.candidate.known_analog_id,
        excluded_by_vegetation: r.excludedByVegetation,
      },
    })),
  };
}

const csvCell = (v: string | number | boolean | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(ctx: Ctx): string {
  const { targetId, weights } = ctx.store.get();
  const header = [
    'rank',
    'candidate_id',
    'name',
    'lat',
    'lon',
    'score',
    'distance',
    'status',
    'mock',
    ...EARTH_FEATURES,
    ...EARTH_FEATURES.map((f) => `${f}_source`),
  ];
  const lines = [
    `# target=${targetId}; weights=${JSON.stringify(weights)}; mock=${String(ctx.data.mock)}`,
    header.join(','),
  ];
  for (const r of ctx.rank(targetId)) {
    const c = r.candidate;
    const status = r.excludedByVegetation
      ? 'excluded_vegetation'
      : c.known_analog_id
        ? `known_analog:${c.known_analog_id}`
        : 'our_result_not_nasa_validated';
    lines.push(
      [
        r.rank,
        c.id,
        c.name,
        c.lat,
        c.lon,
        r.score.toFixed(6),
        Number.isFinite(r.distance) ? r.distance.toFixed(6) : '',
        status,
        ctx.data.mock,
        ...EARTH_FEATURES.map((f) => c.features[f]),
        ...EARTH_FEATURES.map((f) => c.provenance[f]),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function exportGeoJson(ctx: Ctx): void {
  const { targetId } = ctx.store.get();
  download(
    `analogs_${targetId}${ctx.data.mock ? '_MOCK' : ''}.geojson`,
    'application/geo+json',
    JSON.stringify(buildGeoJson(ctx), null, 2),
  );
}

export function exportCsv(ctx: Ctx): void {
  const { targetId } = ctx.store.get();
  download(`analogs_${targetId}${ctx.data.mock ? '_MOCK' : ''}.csv`, 'text/csv', buildCsv(ctx));
}
