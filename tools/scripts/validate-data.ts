// Validates a contract data directory with the SAME validator the browser uses (src/data/validate.ts).
// Run: npm run validate:data                 (defaults to public/data/mock)
//      npm run validate:data -- public/data  (real output)
import { open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataSet, type DataReader } from '../../src/data/validate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(root, 'public', 'data', 'mock'));

const reader: DataReader = {
  baseUrl: dir,
  json: async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown,
  head: async (name, bytes) => {
    const fh = await open(join(dir, name), 'r');
    try {
      const buf = new Uint8Array(bytes);
      await fh.read(buf, 0, bytes, 0);
      return buf;
    } finally {
      await fh.close();
    }
  },
};

const result = await validateDataSet(reader);
if (result.ok) {
  console.log(
    `CONTRACT OK: ${dir} (mock=${String(result.data.mock)}, ${result.data.targets.targets.length} targets, ${result.data.candidates.candidates.length} candidates)`,
  );
} else {
  console.error(`CONTRACT INVALID: ${dir} (${result.errors.length} error(s))`);
  for (const e of result.errors) console.error(`  - ${e.file} ${e.path}: ${e.message}`);
  process.exit(1);
}
