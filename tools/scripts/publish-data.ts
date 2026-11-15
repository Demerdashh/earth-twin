// Publish the real pipeline output for the static site:  out/  ->  public/data/
// Validates every JSON file with the same guards the browser uses (src/data/out.ts) and refuses
// synthetic output, so nothing from sample_out or the demo can ever reach the page.
// Run: npm run data:publish            (from ./out)
//      npm run data:publish -- path/to/out
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractError, checkCard, checkManifest, checkRank, checkValidation } from '../../src/data/out';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(process.cwd(), process.argv[2] ?? join(root, 'out'));
const dest = join(root, 'public', 'data');

const read = (rel: string): unknown => JSON.parse(readFileSync(join(src, rel), 'utf8')) as unknown;

function fail(msg: string): never {
  console.error(`NOT PUBLISHED: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(src, 'manifest.json'))) fail(`${src} has no manifest.json (run the pipeline first)`);

try {
  const manifest = checkManifest(read('manifest.json'));
  for (const f of ['targets.json', 'tasks.json']) {
    const doc = read(f) as { synthetic?: unknown };
    if (doc.synthetic === true) throw new ContractError(`${f}: refused, "synthetic" is true`);
  }
  checkValidation(read('validation.json'));
  const ranks = readdirSync(join(src, 'rank')).filter((f) => f.endsWith('.json'));
  for (const f of ranks) checkRank(read(join('rank', f)), `rank/${f}`);
  const cards = readdirSync(join(src, 'cards')).filter((f) => f.endsWith('.json'));
  for (const f of cards) checkCard(read(join('cards', f)), `cards/${f}`);

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const entry of ['manifest.json', 'targets.json', 'tasks.json', 'validation.json', 'rank', 'cards', 'img'])
    if (existsSync(join(src, entry))) cpSync(join(src, entry), join(dest, entry), { recursive: true });
  console.log(
    `PUBLISHED ${src} -> public/data (generated ${manifest.generated}, ${ranks.length} rankings, ${cards.length} cards)`,
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
