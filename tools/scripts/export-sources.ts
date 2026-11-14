// Writes pipeline/config/sources.json from src/config/sources.ts (the single source of truth).
// Generated file — never edit by hand. Run: npm run export:sources
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, TILE_SOURCES } from '../../src/config/sources';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'pipeline', 'config', 'sources.json');
const doc = {
  _generated: 'DO NOT EDIT — generated from src/config/sources.ts by `npm run export:sources`',
  tiles: TILE_SOURCES,
  datasets: DATASETS,
};
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`wrote ${out} (${TILE_SOURCES.length} tile sources, ${DATASETS.length} datasets)`);
