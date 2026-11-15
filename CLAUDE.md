# AnalogLens: team contract

Plan and timeline: [PLAN.md](PLAN.md). Decisions: [DECISIONS.md](DECISIONS.md) (one line per decision,
in the same commit as the change). Pipeline details and the frozen API contract: [README.md](README.md).

## Layout

| Path | Owner | What |
| --- | --- | --- |
| `analoglens/`, `scripts/`, `tests/test_core.py`, `notebooks/` | CV/AI, ML/data | Python pipeline: tiles, features, scoring, cards, validation |
| `config/` | everyone, by PR | The real configuration: targets, tasks, dimensions, body limits, known analogs, Egypt sites, imagery endpoints |
| `out/` (git-ignored) | pipeline | Run output. Published to the site with `npm run data:publish` |
| `public/data/` | `npm run data:publish` only | The published copy of `out/` that the site reads. Never edited by hand |
| `public/textures/` | `npm run textures` | Globe textures built from real NASA tiles (display only) |
| `src/`, `index.html`, `tests/web/` | Full-stack | The site: one three.js scene with the Moon, Earth and Mars |
| `tools/` | everyone | Local toolchain (`npm run setup`); only `tools/scripts/` and `tools/README.md` are committed |

## Data contract between the pipeline and the site

The site reads exactly the files the pipeline writes to `out/` (same JSON as the API in README.md):

| File | Read when |
| --- | --- |
| `manifest.json` | At start. If missing, the site shows "Awaiting pipeline output" and no scores |
| `validation.json` | At start |
| `rank/<target>__<task>.json` | When a target is opened and a task chosen |
| `cards/<target>__<task>__<tile>.json` | When a ranked tile is opened (top N only) |
| `img/*.png` | Card images (`/img/...` paths are resolved under `data/`) |

Rules, enforced in [src/data/out.ts](src/data/out.ts) (browser) and `tools/scripts/publish-data.ts` (publishing):

1. **Real data only.** Every published file must carry `"synthetic": false`. `sample_out/` and the
   synthetic demo can never be published or shown.
2. Malformed files are refused with the file name and the field; the site then says the output was refused.
3. Nothing on the site is a score unless it comes from these files. Targets, known analog sites and Egypt
   sites come from `config/` and are shown as places and documented links, never as results.
4. Coordinates the config marks as approximate or `VERIFY` are flagged on screen ("coordinates to verify").

## How links between bodies are drawn

From `config/` only (see [src/data/regions.ts](src/data/regions.ts)):

- **Known analog → target**: a site's `known_for` shares a specific tag with the target's `validation_tags`
  (generic body tags `mars`/`moon` ignored, same reason as in DECISIONS.md).
- **Egypt site → target**: the site's `analog_for` names the target.
- **Ranked tile → target**: from `rank/*.json` once real output is published.

## Commands

```bash
npm run setup         # tools/: uv, Python 3.11, pinned pipeline deps (uv.lock), npm deps, Chromium
npm run dev           # site at http://localhost:5173
npm run pipeline:test # python tests/test_core.py
npm run data:publish  # validate out/ and copy it to public/data/ (refuses synthetic)
npm run verify        # typecheck, lint, unit tests, pipeline tests, build
npm run test:e2e      # browser tests
```

Deploy: Vercel (`vercel.json`), every push to `main`.
