# tools/: project-local toolchain

Everything the project needs is installed **inside this folder** by `npm run setup`
(`tools/scripts/setup.ps1` on Windows, `tools/scripts/setup.sh` elsewhere). Nothing is installed
globally, no `sudo`, no changes to system or user settings. Re-running setup is safe. Only this README
and `tools/scripts/` are committed.

| Path | Contents |
| --- | --- |
| `tools/bin/` | `uv`, standalone CPython 3.11 (`cpython/`), Playwright Chromium (`ms-playwright/`) |
| `tools/python/` | Python 3.11 virtual environment with the `analoglens` package (editable) |
| `tools/scripts/` | Our scripts (committed) |
| `tools/cache/` | Download archives; pip, uv and npm caches; NASA tiles used to build textures |

## Tools

| Tool | Version | Why | How installed |
| --- | --- | --- | --- |
| uv | 0.13.8 | Fetch CPython 3.11; export the exact pins from `uv.lock` | GitHub release archive into `tools/bin` |
| CPython | 3.11 | Pipeline runtime (`.python-version`) | `uv python install 3.11` into `tools/bin/cpython` |
| Pipeline packages | pinned in `uv.lock` (numpy, scipy, pillow; extras via `-Extras real,serve`) | `analoglens` pipeline, tests, texture build | `uv export --frozen` then `pip install` into `tools/python` (pip because uv's cache renames are blocked by antivirus on some Windows machines) |
| Node.js / npm | system Node 20 or newer | Vite, TypeScript, tests | **Not installed by setup**: must be on PATH |
| npm packages | pinned in `package-lock.json` | Site (three.js) and tooling | `npm ci` into the project's `node_modules/` |
| Playwright Chromium | matches `@playwright/test` | Browser tests | `npx playwright install chromium` into `tools/bin/ms-playwright` |

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `setup.mjs` → `setup.ps1` / `setup.sh` | `npm run setup` (`-- --python-only`) | Create `tools/` and install everything |
| `py.mjs` | used by `npm run pipeline:test`, `npm run textures` | Run the project Python |
| `publish-data.ts` | `npm run data:publish [-- dir]` | Validate the real `out/` and copy it to `public/data/`; refuses synthetic output |
| `check-sources.ts` | `npm run check:sources` | Probe every imagery endpoint in `config/imagery.json` (OK/FAIL, CORS) |
| `build_textures.py` | `npm run textures` | Build `public/textures/*.webp` from real NASA tiles |
