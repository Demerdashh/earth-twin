# Analog Finder — team contract

Source of truth for the idea, architecture and plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
This file is **the data contract** between the data side (pipeline/, roles A, B, Similarity) and the
web side (src/, role C). The contract is the set of files in a data directory, described by the JSON
Schemas in [schemas/](schemas/). Changing a schema = changing the contract: bump `schema_version`,
update this file, and tell the whole team.

## Data directories and the DATA_SOURCE switch

| Directory | Contents | Who writes it |
| --- | --- | --- |
| `public/data/` | **Real** output (the model / real pipeline) | Data team |
| `public/data/mock/` | Mock set used until the real output is ready, for tests, and as the demo fallback | `npm run mock:generate` |
| `pipeline/mock/` | Mock specs (site list + plausible values) and the generator | Anyone, by PR |

The web app reads exactly one directory, chosen by **`DATA_SOURCE`** in
[src/config/data-source.ts](src/config/data-source.ts) (`mock` by default; override with
`VITE_DATA_SOURCE=real` at build/dev time). Swapping mock for real requires **no code changes**:
drop valid files into `public/data/` and set `DATA_SOURCE=real`.

Both sides validate against the same schemas:

- Pipeline: `npm run pipeline:validate -- public/data` (Python, `pipeline/validate_contract.py`). Writers call it before exiting.
- Web/CI: `npm run validate:data` (TypeScript, same validator module the browser uses, `src/data/validate.ts`).
- Browser: refuses invalid files at load time and shows every error with file + JSON path.

## Header (every JSON file)

```json
{ "schema_version": "1.0", "mock": false, "note": "…", "generated_at": "2026-11-14T00:00:00Z", "generator": "pipeline/export.py@<git sha>" }
```

`mock: true` requires a `note` explaining how the file was generated. The UI shows a **Mock data**
badge whenever any loaded file has `mock: true` and never labels those numbers as measurements.

## Features and units (absolute physical units — never per-body percentiles)

| Feature | Unit | Range | Meaning (same on every body) | Bodies |
| --- | --- | --- | --- | --- |
| `elevation_m` | m | -12000…30000 | Height relative to the body's reference surface (datums differ, so default weight is 0) | all |
| `slope_deg` | degrees | 0…90 | Mean surface slope over the cell / fingerprint radius | all |
| `roughness` | m | ≥ 0 | RMS of elevation residual after removing a local plane, at the grid scale | all |
| `temp_range_k` | K | ≥ 0 | Typical diurnal surface-temperature range (max − min) | all |
| `mineral_index` | 0…1 | 0…1 | Mafic (basaltic) index proxy from band ratios; 0 = felsic/anorthositic, 1 = strongly mafic | all |
| `ice_indicator` | 0…1 | 0…1 | **Indicator** of water/ice (neutron/radar on Moon/Mars; surface water/ice/permafrost on Earth). Not a measured abundance | all |
| `ndvi` | −1…1 | −1…1 | Vegetation index; used **only** as an exclusion filter | Earth only |

`null` = no data. A feature that is null on either side is skipped (its weight is dropped).

## Similarity definition (identical in Python and TypeScript)

For target fingerprint `t`, candidate `c`, weights `w`, fixed physical scales `s` (from
`earth_candidates.json → feature_scales`, identical for every body):

```
d     = sqrt( Σ_i w_i · ((c_i − t_i) / s_i)²  /  Σ_i w_i )     over features with w_i > 0 and both values non-null
score = exp(−d)                                                 in (0, 1]
```

Candidates with `ndvi > ndvi_threshold` are excluded (rank = null). Ranking: non-excluded by `d`
ascending, ties by `id` ascending; excluded last. Implementations:
[src/rank/ranking.ts](src/rank/ranking.ts) and [pipeline/contract/ranking.py](pipeline/contract/ranking.py);
a shared test asserts both give the same order as the exported `analogs_<target>.geojson`.

## Files

| File | Schema | Purpose |
| --- | --- | --- |
| `manifest.json` | [manifest.schema.json](schemas/manifest.schema.json) | Entry point. Lists every other file, overlays (with bounds and value range) and grids |
| `targets.json` | [targets.schema.json](schemas/targets.schema.json) | Moon/Mars targets: id, body, lat/lon, `radius_km`, fingerprint `features`, per-feature provenance |
| `earth_candidates.json` | [earth_candidates.schema.json](schemas/earth_candidates.schema.json) | Earth candidates with features, `feature_scales`, `default_weights`, `ndvi_threshold`, and `per_target` pools (≤ 300 ids each) |
| `analogs_<target_id>.geojson` | [analogs.schema.json](schemas/analogs.schema.json) | Ranked FeatureCollection for one target at default weights |
| `similarity_<target_id>.png` | listed in `manifest.overlays` (kind `similarity`) | Equirectangular RGBA heatmap; bounds/size in the manifest; validator checks PNG signature and IHDR size |
| `provenance.json` | [provenance.schema.json](schemas/provenance.schema.json) | One record per dataset (source, product, resolution, date, processing steps, url, verified, mock) + run log |
| `known_analogs.json` | [known_analogs.schema.json](schemas/known_analogs.schema.json) | Recognised analog sites used for validation (coordinates flagged until verified) |
| `validation_report.json` | [validation_report.schema.json](schemas/validation_report.schema.json) | Rank of each known analog per target |
| `grid_<body>.json` | [grid.schema.json](schemas/grid.schema.json) | Sparse equirectangular feature grid for click popups |

Other overlay kinds: `vegetation` (Earth, NDVI exclusion lens) and `water_ice` (any body, labelled "indicator").

### Minimal examples

```json
// targets.json → targets[]
{ "id": "shackleton_rim", "name": "Shackleton crater rim", "body": "moon", "lat": -89.67, "lon": 129.78,
  "radius_km": 20, "description": "…", "coords_verified": false,
  "features": { "elevation_m": 1500, "slope_deg": 12, "roughness": 60, "temp_range_k": 60, "mineral_index": 0.25, "ice_indicator": 0.6 },
  "provenance": { "elevation_m": "moon_lola_dem", "temp_range_k": "moon_diviner" } }
```

```json
// earth_candidates.json → candidates[]
{ "id": "atacama_yungay", "name": "Atacama — Yungay", "lat": -24.1, "lon": -70.0, "region": "Atacama Desert",
  "country": "Chile", "known_analog_id": "atacama", "coords_verified": false,
  "features": { "elevation_m": 1000, "slope_deg": 3, "roughness": 20, "temp_range_k": 42, "mineral_index": 0.35, "ice_indicator": 0, "ndvi": 0.03 },
  "provenance": { "elevation_m": "earth_copernicus_dem" } }
```

## Scientific rules (non-negotiable)

1. Real data only for any number shown as a result; mock data is flagged and badged.
2. Compare in absolute physical units, never per-body percentiles.
3. Every dataset has a provenance record, surfaced in the UI.
4. Analogs cover terrain, thermal range, mineralogy and aridity — **not** gravity, radiation or vacuum.
5. A candidate with `known_analog_id: null` is labelled **"our result, not NASA-validated"**.
6. Coordinates and dataset names are flagged (`coords_verified`, `verification.status`) until checked.

## External endpoints

All tile URLs and dataset names live in [src/config/sources.ts](src/config/sources.ts) only.
`npm run check:sources` probes them; `npm run export:sources` copies dataset refs for the pipeline.

## Ownership

| Role | Owns |
| --- | --- |
| A — Earth | Earth Engine export, Earth features → `earth_candidates.json`, `grid_earth.json` |
| B — Moon & Mars | Trek/PDS, fingerprints → `targets.json`, `grid_moon.json`, `grid_mars.json` |
| Similarity | ranking, `analogs_*.geojson`, `similarity_*.png`, `validation_report.json`, `provenance.json` |
| C — Interface | `src/`, Story/Explore, pitch |

The **AI and model** section of the architecture is intentionally empty and owned by the domain owner.

## Conventions

- Toolchain lives in `tools/` only (`npm run setup`); never install globally.
- Python 3.11 in `tools/python`, typed (`mypy`), tested (`pytest`). TypeScript strict, ESLint + Prettier.
- One branch per person; run `npm run verify` before pushing.
