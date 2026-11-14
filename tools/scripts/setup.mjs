// Cross-platform entry point for `npm run setup`: dispatches to setup.ps1 (Windows) or setup.sh.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
// `npm run setup -- --python-only` skips npm/Playwright (useful while node_modules is being installed).
const pythonOnly = process.argv.includes('--python-only');
const [cmd, args] = isWin
  ? [
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(here, 'setup.ps1'),
        ...(pythonOnly ? ['-PythonOnly'] : []),
      ],
    ]
  : ['bash', [join(here, 'setup.sh'), ...(pythonOnly ? ['--python-only'] : [])]];

const result = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
