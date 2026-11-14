// Runs the project-local Python (tools/python) with the given arguments, from the repo root.
// Usage: node tools/scripts/py.mjs -m pipeline.mock.generate
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const py =
  process.platform === 'win32'
    ? join(root, 'tools', 'python', 'Scripts', 'python.exe')
    : join(root, 'tools', 'python', 'bin', 'python');

if (!existsSync(py)) {
  console.error(`Project Python not found at ${py}. Run \`npm run setup\` first.`);
  process.exit(1);
}
const result = spawnSync(py, process.argv.slice(2), { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
