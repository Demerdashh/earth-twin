// Probes every imagery endpoint in config/imagery.json and reports OK / FAIL per source.
// Run: npm run check:sources   (exit code 1 if any source fails)
import imagery from '../../config/imagery.json';

interface Layer {
  product: string;
  url: string;
  capabilities: string;
}

const TIMEOUT_MS = 20_000;

async function probe(url: string, image: boolean): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'analoglens-check-sources' } });
    const type = res.headers.get('content-type') ?? '';
    const cors = res.headers.get('access-control-allow-origin');
    await res.body?.cancel();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    if (image && !type.startsWith('image/')) return { ok: false, detail: `content-type ${type}` };
    if (image && !cors) return { ok: false, detail: 'no CORS header (the browser cannot use it in WebGL)' };
    return { ok: true, detail: `HTTP ${res.status}${image ? ` CORS=${cors ?? ''}` : ''}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

let failed = 0;
for (const [body, layers] of Object.entries(imagery)) {
  if (body.startsWith('_')) continue;
  for (const [role, layer] of Object.entries(layers as Record<string, Layer>)) {
    const caps = await probe(layer.capabilities, false);
    const tile = await probe(layer.url.replace('{z}', '0').replace('{y}', '0').replace('{x}', '0'), true);
    const ok = caps.ok && tile.ok;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${body}/${role} ${layer.product}: caps ${caps.detail} | tile ${tile.detail}`);
  }
}
process.exit(failed ? 1 : 0);
