# data/raw — downloaded source rasters (never committed)

Everything in this folder except this README is git-ignored. The real pipeline (owned by the
data team, not built yet) will read these files and write contract files to `public/data/`.
Until then the app runs on the mock set in `public/data/mock/`.

All products below are named in `src/config/sources.ts`. Product names and resolutions come from
the architecture doc and are **unverified** until someone checks them at the source; run
`npm run check:sources` for the ones with an HTTP-checkable catalog page.

## Expected layout and filenames

GeoTIFF, EPSG:4326 (planetocentric lon/lat for Moon/Mars), float32, nodata = NaN, physical units.

| File | Feature | Unit | Source (sources.ts id) | How to obtain |
| --- | --- | --- | --- | --- |
| `earth/earth_elevation_m.tif` | elevation_m | m | `earth_copernicus_dem` | `pipeline/earth_engine/export_earth_features.py` |
| `earth/earth_slope_deg.tif` | slope_deg | deg | `earth_copernicus_dem` | same script |
| `earth/earth_roughness_m.tif` | roughness | m | `earth_copernicus_dem` | same script |
| `earth/earth_temp_range_k.tif` | temp_range_k | K | `earth_modis_lst` | same script |
| `earth/earth_mineral_index.tif` | mineral_index | 0–1 | `earth_sentinel2` | same script (index definition still to be decided) |
| `earth/earth_ice_indicator.tif` | ice_indicator | 0–1 | `earth_jrc_water` | same script |
| `earth/earth_ndvi.tif` | ndvi | −1–1 | `earth_modis_ndvi` | same script |
| `moon/moon_elevation_m.tif` | elevation_m | m | `moon_lola_dem` | Moon Trek layer download for the target region, or PDS Geosciences Node (ODE) |
| `moon/moon_temp_range_k.tif` | temp_range_k | K | `moon_diviner` | PDS (Diviner derived products) |
| `moon/moon_mineral_index.tif` | mineral_index | 0–1 | `moon_m3` | PDS (M3 reflectance → band-ratio index) |
| `moon/moon_ice_indicator.tif` | ice_indicator | 0–1 | `moon_lpns` | PDS (Lunar Prospector neutron data) |
| `mars/mars_elevation_m.tif` | elevation_m | m | `mars_mola_dem` | Mars Trek layer download, or PDS ODE |
| `mars/mars_temp_range_k.tif` | temp_range_k | K | `mars_themis` | PDS (THEMIS / TES) |
| `mars/mars_mineral_index.tif` | mineral_index | 0–1 | `mars_crism` | PDS (CRISM / TES mineral maps) |
| `mars/mars_ice_indicator.tif` | ice_indicator | 0–1 | `mars_ice` | PDS (radar / neutron products) |

Slope and roughness for the Moon and Mars are derived from the DEM by the pipeline, using the body
radius (never Earth's).

## Rules

- Download only a bounded region around each target (risk table in `docs/ARCHITECTURE.md`).
- Record every download in `provenance.json` (source, product, resolution, date, processing steps).
- Keep raw files here, never in `tools/` or `public/`.
