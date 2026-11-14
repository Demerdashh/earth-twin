// Base imagery with a fallback chain: remote tiles (sources.ts) -> local low-res tiles
// (public/basemaps, real NASA tiles fetched by `npm run fetch:basemaps`) -> generated graticule.
import {
  Credit,
  type Ellipsoid,
  GeographicTilingScheme,
  type ImageryProvider,
  Rectangle,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';
import { FALLBACK_MAX_LEVEL } from '../config/basemaps';
import type { TileSource } from '../config/sources';

export type ImageryStatus =
  | { kind: 'remote'; source: TileSource }
  | { kind: 'local'; source: TileSource; reason: string }
  | { kind: 'graticule'; reason: string };

const PROBE_TIMEOUT_MS = 6000;

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

/** A plain graticule so the globe is never blank — clearly not imagery. */
function graticuleProvider(ellipsoid: Ellipsoid): SingleTileImageryProvider {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1a2230';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,180,200,0.35)';
    ctx.lineWidth = 1;
    for (let lon = 0; lon <= 360; lon += 30) {
      const x = (lon / 360) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = 0; lat <= 180; lat += 30) {
      const y = (lat / 180) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  return new SingleTileImageryProvider({
    url: canvas.toDataURL('image/png'),
    tileWidth: w,
    tileHeight: h,
    rectangle: Rectangle.MAX_VALUE,
    ellipsoid,
    credit: new Credit('No imagery available — graticule only'),
  });
}

/** Pick the first reachable imagery for a body. */
export async function resolveImagery(
  sources: readonly TileSource[],
  ellipsoid: Ellipsoid,
  preferredId?: string,
): Promise<{ provider: ImageryProvider; status: ImageryStatus }> {
  const ordered = [...sources].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
  for (const s of ordered) {
    if (await probe(level0(s.urlTemplate)))
      return { provider: remoteProvider(s, ellipsoid), status: { kind: 'remote', source: s } };
  }
  const primary = ordered[0];
  if (primary && (await probe(level0(localTemplate(primary))))) {
    return {
      provider: localProvider(primary, ellipsoid),
      status: { kind: 'local', source: primary, reason: 'Remote tile server unreachable' },
    };
  }
  return {
    provider: graticuleProvider(ellipsoid),
    status: { kind: 'graticule', reason: 'No imagery reachable (remote or local)' },
  };
}
