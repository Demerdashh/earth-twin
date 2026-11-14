// Probes every endpoint in src/config/sources.ts and reports OK / FAIL per source.
// Run: npm run check:sources        (exit code 1 if any *verified* source fails)
import { DATASETS, TILE_SOURCES, type TileSource } from '../../src/config/sources';

const TIMEOUT_MS = 20_000;

interface Probe {
  ok: boolean;
  detail: string;
}

async function probe(url: string, expect: 'image' | 'xml' | 'html'): Promise<Probe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'analog-finder-check-sources' } });
    const type = res.headers.get('content-type') ?? '';
    const cors = res.headers.get('access-control-allow-origin');
    await res.body?.cancel();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    if (expect === 'image' && !type.startsWith('image/'))
      return { ok: false, detail: `HTTP ${res.status} but content-type ${type}` };
    const corsNote =
      expect === 'image' ? (cors ? ` CORS=${cors}` : ' NO CORS header (browser may block WebGL use)') : '';
    return { ok: true, detail: `HTTP ${res.status} ${type}${corsNote}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

const tileUrl = (s: TileSource, z = 0, y = 0, x = 0): string =>
  s.urlTemplate.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));

async function main(): Promise<void> {
  let hardFail = 0;
  let offline = true;
  console.log('Tile sources');
  for (const s of TILE_SOURCES) {
    const caps = s.capabilitiesUrl ? await probe(s.capabilitiesUrl, 'xml') : { ok: true, detail: 'n/a' };
    const tile = await probe(tileUrl(s), 'image');
    if (caps.ok || tile.ok) offline = false;
    const ok = caps.ok && tile.ok;
    if (!ok && s.verification.status === 'verified') hardFail += 1;
    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'} ${pad(s.id, 24)} [config: ${pad(s.verification.status, 10)}] caps: ${caps.detail} | tile z0: ${tile.detail}`,
    );
  }
  console.log('\nDatasets');
  for (const d of DATASETS) {
    if (!d.catalogUrl) {
      console.log(
        `  SKIP ${pad(d.id, 24)} [config: ${pad(d.verification.status, 10)}] no catalog URL — ${d.verification.method}`,
      );
      continue;
    }
    const r = await probe(d.catalogUrl, 'html');
    if (r.ok) offline = false;
    console.log(
      `  ${r.ok ? 'OK  ' : 'FAIL'} ${pad(d.id, 24)} [config: ${pad(d.verification.status, 10)}] ${d.identifier ?? ''} — ${r.detail}`,
    );
  }
  if (offline) {
    console.log(
      '\nNo source reachable: network appears to be offline. Config entries stay as they are; the app falls back to local basemaps.',
    );
  }
  console.log(
    '\nNote: OK means the endpoint answered. Only mark an entry `verified` in src/config/sources.ts after also checking product, coverage and resolution.',
  );
  process.exit(hardFail > 0 ? 1 : 0);
}

void main();
