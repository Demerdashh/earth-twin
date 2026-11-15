// Base imagery with a fallback: remote tiles (sources.ts), else the bundled low-resolution copy of
// the body's primary layer (public/basemaps — real NASA tiles fetched by `npm run fetch:basemaps`).
import {
  Credit,
  type Ellipsoid,
  GeographicTilingScheme,
  type ImageryProvider,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';
import { FALLBACK_MAX_LEVEL, PRIMARY_SOURCE } from '../config/basemaps';
import type { TileSource } from '../config/sources';

export type ImageryStatus =
  { kind: 'remote'; source: TileSource } | { kind: 'local'; source: TileSource; reason: string };

/** Generous: on slow machines the first Viewer build can block the main thread for seconds. */
const PROBE_TIMEOUT_MS = 12_000;

async function probe(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    await res.body?.cancel();
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const tilingScheme = (s: TileSource, ellipsoid: Ellipsoid) =>
  s.tilingScheme === 'geographic'
    ? new GeographicTilingScheme({ ellipsoid })
    : new WebMercatorTilingScheme({ ellipsoid });

const level0 = (template: string): string => template.replace('{z}', '0').replace('{y}', '0').replace('{x}', '0');

export function localTemplate(s: TileSource): string {
  const ext = s.urlTemplate.split('.').pop() ?? 'jpg';
  return `${import.meta.env.BASE_URL}basemaps/${s.id}/{z}/{y}/{x}.${ext}`;
}

export function remoteProvider(s: TileSource, ellipsoid: Ellipsoid): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: s.urlTemplate, // {y} = row from the top, as in WMTS TileRow
    tilingScheme: tilingScheme(s, ellipsoid),
    maximumLevel: s.maximumLevel,
    credit: new Credit(s.credit),
  });
}

export function localProvider(s: TileSource, ellipsoid: Ellipsoid): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: localTemplate(s),
    tilingScheme: tilingScheme(s, ellipsoid),
    maximumLevel: FALLBACK_MAX_LEVEL,
    credit: new Credit(`${s.credit} (offline low-resolution copy)`),
  });
}

/** The body's primary layer — the only one with a bundled offline copy. */
export const fallbackSource = (sources: readonly TileSource[]): TileSource | undefined =>
  sources.find((s) => s.id === PRIMARY_SOURCE[s.body]) ?? sources[0];

/** Probe all remote sources in parallel; take the preferred reachable one, else the local copy. */
export async function resolveImagery(
  sources: readonly TileSource[],
  ellipsoid: Ellipsoid,
  preferredId?: string,
): Promise<{ provider: ImageryProvider; status: ImageryStatus }> {
  const ordered = [...sources].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
  const reachable = await Promise.all(ordered.map((s) => probe(level0(s.urlTemplate))));
  const remote = ordered.find((_, i) => reachable[i]);
  if (remote) return { provider: remoteProvider(remote, ellipsoid), status: { kind: 'remote', source: remote } };
  const local = fallbackSource(sources);
  if (!local) throw new Error('no imagery source configured for this body');
  return {
    provider: localProvider(local, ellipsoid),
    status: { kind: 'local', source: local, reason: 'remote tile server unreachable' },
  };
}
