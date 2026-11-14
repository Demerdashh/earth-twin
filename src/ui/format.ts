import { FEATURE_META, type DataSet, type EarthFeature } from '../contract/types';

export function fmtValue(feature: EarthFeature, v: number | null | undefined): string {
  if (v == null) return 'no data';
  const m = FEATURE_META[feature];
  const n = v.toLocaleString('en-US', { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
  return m.unit ? `${n}${m.unit === '°' ? '' : ' '}${m.unit}` : n;
}

export const fmtCoord = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

export const fmtScore = (s: number): string => s.toFixed(3);

/** Human-readable source of a number, from provenance.json. */
export function provenanceLabel(data: DataSet, datasetId: string | undefined): string {
  if (!datasetId) return 'Source not recorded';
  const d = data.provenance.datasets.find((x) => x.id === datasetId);
  if (!d) return `Unknown dataset ${datasetId}`;
  const flags = [d.mock ? 'MOCK' : null, d.verified ? 'verified' : 'unverified'].filter(Boolean).join(', ');
  return `${d.product} — ${d.source} (${flags})`;
}
