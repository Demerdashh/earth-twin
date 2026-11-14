// Downloads a tiny real basemap (levels 0-2) of the primary tile source per body into
// public/basemaps/<source id>/{z}/{y}/{x}.<ext>, used when the remote tile server is unreachable.
// Run: npm run fetch:basemaps   (safe to re-run; existing tiles are kept)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_SOURCES, type Body } from '../../src/config/sources';
import { FALLBACK_MAX_LEVEL, PRIMARY_SOURCE } from '../../src/config/basemaps';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(): Promise<void> {
  let failed = 0;
  for (const body of Object.keys(PRIMARY_SOURCE) as Body[]) {
    const src = TILE_SOURCES.find((s) => s.id === PRIMARY_SOURCE[body]);
    if (!src) throw new Error(`no tile source ${PRIMARY_SOURCE[body]}`);
    const ext = src.urlTemplate.split('.').pop() ?? 'jpg';
    let count = 0;
    for (let z = 0; z <= FALLBACK_MAX_LEVEL; z++) {
      const cols = src.tilingScheme === 'geographic' ? 2 ** (z + 1) : 2 ** z;
      const rows = 2 ** z;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const file = join(root, 'public', 'basemaps', src.id, String(z), String(y), `${x}.${ext}`);
          if (existsSync(file)) continue;
          const url = src.urlTemplate.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
          const res = await fetch(url);
          if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
            console.error(`  FAIL ${url} (HTTP ${res.status})`);
            failed += 1;
            continue;
          }
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
          count += 1;
        }
      }
    }
    console.log(`${body}: ${src.id} — ${count} new tile(s), levels 0-${FALLBACK_MAX_LEVEL}`);
  }
  process.exit(failed ? 1 : 0);
}

void main();
