# tools/ — project-local toolchain

Everything the project needs is installed **inside this folder** by `npm run setup`
(`tools/scripts/setup.ps1` on Windows, `tools/scripts/setup.sh` elsewhere). Nothing is installed
globally, no `sudo`, no changes to system or user settings. Re-running setup is safe: each step is
skipped when already done. Only this README and `tools/scripts/` are committed.

| Path | Contents |
| --- | --- |
| `tools/bin/` | Downloaded binaries: `uv`, standalone CPython (`cpython/`), Playwright browsers (`ms-playwright/`) |
| `tools/python/` | Python 3.11 virtual environment (`python -m venv tools/python`) |
| `tools/node/` | Reserved for a standalone Node toolchain (unused: Node ≥ 20 from the system is required) |
| `tools/scripts/` | Our scripts (committed) |
| `tools/cache/` | Download archives, pip / uv / npm caches |

## Tools

| Tool | Version | Why | How installed |
| --- | --- | --- | --- |
| uv | 0.13.8 | Fetches a standalone CPython 3.11 (the machine may have a different Python) | GitHub release zip → `tools/bin/uv.exe` |
| CPython | 3.11 (3.11.18 at time of writing) | Pipeline runtime required by the brief | `uv python install 3.11` with `UV_PYTHON_INSTALL_DIR=tools/bin/cpython` |
| Python packages | see `requirements.txt` (numpy 2.2.6, pillow 11.3.0, jsonschema 4.25.1, pytest 8.4.2, mypy 1.18.2) | Contract validation, mock generation, tests, typing | `tools/python` venv, `pip install -r requirements.txt` (pip cache in `tools/cache/pip`) |
| Node.js / npm | system Node ≥ 20 (tested 22.23.1 / npm 10.9.8) | Vite, TypeScript, tests | **Not installed by setup** — must be present on PATH |
| npm packages | pinned in `package.json` / `package-lock.json` | Web app and dev tooling | `npm ci` into the project's `node_modules/` (cache in `tools/cache/npm`) |
| Playwright Chromium | matches `@playwright/test` 1.65.1 | End-to-end smoke test and screenshots | `npx playwright install chromium` with `PLAYWRIGHT_BROWSERS_PATH=tools/bin/ms-playwright` |

### Optional, installed on demand (not in `requirements.txt`)

| Tool | Version | Why | How installed |
| --- | --- | --- | --- |
| imageio-ffmpeg (bundles an ffmpeg 7.1 binary) | 0.6.0 | Extract frames from the design reference videos in `vid-reference/` | `tools/python/Scripts/python -m pip install imageio-ffmpeg==0.6.0` (lands inside `tools/python`) |

## Scripts (`tools/scripts/`)

| Script | npm command | Purpose |
| --- | --- | --- |
| `setup.mjs` → `setup.ps1` / `setup.sh` | `npm run setup` (`-- --python-only` to skip npm/Playwright) | Create `tools/`, install everything, print versions |
| `py.mjs` | used by `npm run mock:generate`, `pipeline:*` | Run the project-local Python |
| `check-sources.ts` | `npm run check:sources` | Probe every endpoint in `src/config/sources.ts`, OK/FAIL per source |
| `export-sources.ts` | `npm run export:sources` | Write `pipeline/config/sources.json` from `sources.ts` |
| `validate-data.ts` | `npm run validate:data [-- dir]` | Validate a data directory with the browser's validator |
| `fetch-basemaps.ts` | `npm run fetch:basemaps` | Download levels 0–2 of the primary imagery per body into `public/basemaps/` (offline fallback) |
| `make_preloader_moon.py` | `node tools/scripts/py.mjs tools/scripts/make_preloader_moon.py` | Build the 35 KB preloader Moon texture from the bundled LRO WAC tiles |

## Not installed (by design)

- **GDAL / rasterio, earthengine-api**: needed only by the real pipeline, which the data team owns.
  Add pinned versions to `requirements.txt` when that work starts; setup will install them into `tools/python`.
- **Earth Engine credentials**: `earthengine authenticate` stores credentials in the user profile;
  that is a deliberate, manual step for whoever runs the export.
