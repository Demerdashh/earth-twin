# AnalogLens (prep kit for NASA Space Apps 2026)

Challenge: *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars.*

AnalogLens ranks Earth locations as analogs for a Moon-base or Mars target **for a specific
mission task**, and explains every result dimension by dimension: what matches, how well, and
where the analogy breaks. Terrain shape (compared by a vision model on same-scale relief
images of Earth, Moon, and Mars) is one dimension among several, never the whole score.

> **Read this first**
> * `sample_out/` and `scripts/demo_synthetic.py` use **synthetic terrain and climate**. They prove
>   the pipeline works and give the frontend realistic JSON from hour 0. Never present those
>   numbers as findings; every synthetic file carries `"synthetic": true`.
> * Values marked **VERIFY** in `config/` are placeholders from memory. Replace them before presenting.
> * This is preparation code. Ask your local organizers how they treat code written before the
>   event, and say plainly in your submission what was prepared in advance.

## Quick start

Dependencies live in `pyproject.toml` and are pinned in `uv.lock`. Install
[uv](https://docs.astral.sh/uv/); it downloads Python 3.11 itself (see `.python-version`).

```bash
uv sync                                   # core: numpy, scipy, pillow (tests + synthetic demo)
uv run python tests/test_core.py          # 8 checks, a few seconds
uv run python scripts/demo_synthetic.py   # about 20 s, writes out/
```

Pick the extras your lane needs. `uv sync` installs exactly what you list, so list them all
in one command (running it again with fewer extras removes the others):

| Lane | Command |
| --- | --- |
| Frontend / API | `uv sync --extra serve` |
| Data pipeline | `uv sync --extra real --extra serve` |
| Everything, incl. DINOv2 (large torch download) | `uv sync --all-extras` |

Serve results (PowerShell first, then macOS/Linux):

```powershell
$env:ANALOGLENS_OUT = "out"; uv run uvicorn analoglens.api:app --reload   # http://127.0.0.1:8000/docs
```
```bash
ANALOGLENS_OUT=out uv run uvicorn analoglens.api:app --reload
```

Check DINOv2 once: `uv sync --all-extras` then `uv run python scripts/check_dino.py`.

**Colab** (pip only, torch already installed there): `pip install -q -e ".[real]"`. Do not
install the `dino` extra on Colab; it would replace Colab's GPU build of torch.

**Adding a dependency:** `uv add <package>` (or `uv add --optional real <package>`), then
commit both `pyproject.toml` and `uv.lock`. Never edit `uv.lock` by hand; if two people
change it at once, take either version and run `uv lock` again.

## What is in the box

```
analoglens/
  geo.py        metric tiles on any body (poles included), raster sampling, polar stereo helper
  terrain.py    slope, roughness, relief, linearity; the relief image the vision model sees
  embed.py      DINOv2 with 4-rotation averaging; descriptor fallback (no downloads)
  index.py      nearest-neighbour index (FAISS or numpy) with calibrated 0-1 terrain scores
  scoring.py    per-dimension scores, Earth-relative scoring, weighted geometric mean, novelty
  cards.py      fingerprint cards: bars, breaks with reasons, fixed limits, suggested tests
  validate.py   ROC-AUC, known-site percentiles, ablation
  render.py     shaded-relief PNGs for side-by-side views
  pipeline.py   runs everything and writes the JSON below
  api.py        FastAPI server for the pre-computed JSON (works offline)
  synthetic.py  synthetic terrain generators (testing only)
config/         dimensions, tasks, body limits, targets, known analogs, Egypt sites
scripts/        demo_synthetic, cut_tiles, cut_target, sample_climate, run_real, check_dino
tests/          core checks
sample_out/     output of the synthetic demo, ready for the frontend
```

## Saturday workflow with real data

All tiles share one grid: **463 m per pixel, 64 x 64 pixels (about 30 km)** for the regional
screen. For zoom-ins (NASA's south-pole region files, Kharga detail) pick a finer resolution
and cut Earth *and* targets at that same resolution.

1. **Earth tiles.** ETOPO 2022 at 15 arc-seconds (NOAA) for the regions you screen, plus
   Copernicus DEM 90 m tiles (free on AWS open data) around each known analog site, because
   validation needs tiles there.
   ```bash
   uv run python scripts/cut_tiles.py --raster etopo_N30E015.tif --raster etopo_N30E030.tif \
       --bbox 20 32 24 36 --step-km 30 --prefix EG --out data/earth_egypt.npz
   uv run python scripts/cut_tiles.py --raster cop90_*.tif --centers config/known_analogs.json \
       --prefix KN --out data/earth_known.npz
   ```
2. **Climate features.** Export monthly MODIS land surface temperature (MOD11C3) and NDVI
   (MOD13C2) as GeoTIFFs from AppEEARS, and MERRA-2 dust optical depth from Giovanni.
   ```bash
   uv run python scripts/sample_climate.py --tiles data/earth_egypt.npz \
       --monthly-lst "data/lst/*.tif" --monthly-ndvi "data/ndvi/*.tif" \
       --layer dust_aod=data/merra2_dust.tif --out data/earth_egypt_features.npz
   ```
   Do the same for `earth_known.npz`.
3. **Targets.** Coordinates and profiles come from `config/targets.json`.
   ```bash
   uv run python scripts/cut_target.py --key medusae_fossae --raster mola_megdr.lbl --body mars --out data/targets
   uv run python scripts/cut_target.py --key shackleton_rim --raster lola_64ppd.lbl --body moon --out data/targets
   ```
   Open each preview PNG and check the feature sits in the middle. For the south pole you can
   also use NASA's ready-gridded region files from the
   [App Development Challenge 2023 page](https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components/)
   (`--adc-height/--adc-lat/--adc-lon`); those regions are small, so the script tells you the
   finest resolution that fits.
4. **Run and serve.**
   ```bash
   uv run python scripts/run_real.py --earth data/earth_egypt.npz --earth data/earth_known.npz \
       --features data/earth_egypt_features.npz --features data/earth_known_features.npz \
       --targets data/targets --embedder auto --max-ndvi 0.3 --out out
   ANALOGLENS_OUT=out uv run uvicorn analoglens.api:app --reload
   ```
   `--max-ndvi 0.3` drops clearly green tiles before embedding (the analog-prone mask).

## API contract (frozen for the frontend)

| Endpoint | Returns |
| --- | --- |
| `GET /targets` | `targets[]`: key, label, body, lat, lon, tasks, profile, image |
| `GET /tasks` | `tasks{}` with label, weights, tests; `dimensions{}` with label and unit |
| `GET /rank?target=&task=&limit=` | `results[]`: rank, tile_id, lat, lon, score, coverage, dims{}, novel, nearest_known, nearest_known_km |
| `GET /card/{tile_id}?target=&task=` | score, strong_for[], bars[] (label, score, status, earth_value, target_value, unit, note), breaks[] (kind: data, unreachable, fixed), tests[], images{earth, target} |
| `GET /validation` | per target and task: auc, known_sites[] percentiles, ablation |
| `GET /img/<file>.png` | relief images used by cards |

Cards exist for the top N results of each list (`--cards`, default 20 for real runs, 10 in
the demo). Bar `status` is one of `strong` (0.7 or more), `partial` (0.4 to 0.7), `breaks`
(below 0.4), `closest on Earth` (target out of Earth's reach), or `no data`.

## How scoring works

* Each dimension scores 0 to 1 against the target: a Gaussian around the target value (in
  log space for roughness and relief), or calibrated cosine similarity for terrain shape.
* If no Earth tile comes close (nothing on Earth reaches −203 °C), dimensions flagged
  `earth_relative` are scored by closeness relative to the rest of Earth, shown as
  "closest on Earth", and the card states the gap. They never count as strong.
* A task's weights combine dimensions with a weighted geometric mean, so one terrible
  dimension drags the total down. Missing data lowers coverage instead of counting as a match.
* The novelty flag marks results more than 200 km from every known analog site.

To add a target, task, or dimension, edit the JSON in `config/`; no code changes needed.
New dimensions need a matching feature column (from `sample_climate.py --layer name=...`).

## Known limits

* DINOv2 is written but was not run in the build environment; run `scripts/check_dino.py`.
  The descriptor embedder is the tested fallback and the baseline for the ablation slide.
* Earth tiles near the poles (Antarctica) work geometrically, but MODIS and EMIT coverage
  thins out there; check the coverage numbers `sample_climate.py` prints.
* Kamil Crater is 45 m wide: it needs imagery or a 30 m DEM, not 463 m tiles.
* Terrain at 463 m per pixel shows craters, massifs, and yardang fields, not boulders or
  individual dunes; use the zoom scale for those.
