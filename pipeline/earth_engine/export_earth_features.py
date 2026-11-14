"""TEMPLATE — Earth Engine export of Earth feature rasters into data/raw/earth/.

Owner: Role A (Earth). Not run in CI and not wired into the app: it exists so the real
pipeline has a starting point. Dataset ids come from src/config/sources.ts (exported to
pipeline/config/sources.json) — verify each one in the Earth Engine catalog before use.

Prerequisites (not installed by `npm run setup`; add pins to requirements.txt when used):
    tools/python/Scripts/python -m pip install earthengine-api
    tools/python/Scripts/earthengine authenticate      # stores credentials in your user profile
Then:
    python -m pipeline.earth_engine.export_earth_features --project <gcp-project> --region "-75,-30,-65,-18"

Exports go to Google Drive (folder `analog_finder_raw`); download them into data/raw/earth/
with the expected filenames listed in data/raw/README.md.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

SOURCES = Path(__file__).resolve().parents[1] / "config" / "sources.json"
SCALE_M = 1000  # export resolution; must match the unified grid chosen by the team


def dataset_ids() -> dict[str, str]:
    """Earth Engine asset ids keyed by our dataset id (from the single sources config)."""
    refs = json.loads(SOURCES.read_text(encoding="utf-8"))["datasets"]
    return {d["id"]: d["identifier"] for d in refs if d["body"] == "earth" and d["identifier"]}


def build_images(ee: Any, ids: dict[str, str], region: Any) -> dict[str, Any]:
    """Return {output_name: ee.Image}. Every step is a documented, physical-unit transform."""
    dem = ee.ImageCollection(ids["earth_copernicus_dem"]).select("DEM").mosaic().clip(region)
    slope = ee.Terrain.slope(dem)  # degrees
    # Roughness: std-dev of elevation in a 3x3 window, metres (same definition as Moon/Mars).
    roughness = dem.reduceNeighborhood(ee.Reducer.stdDev(), ee.Kernel.square(1))

    lst = ee.ImageCollection(ids["earth_modis_lst"]).filterDate("2023-01-01", "2024-01-01")
    # MOD11A2 LST scale factor 0.02 -> kelvin. Diurnal range = day - night, averaged over the year.
    day = lst.select("LST_Day_1km").mean().multiply(0.02)
    night = lst.select("LST_Night_1km").mean().multiply(0.02)
    temp_range = day.subtract(night).rename("temp_range_k")

    ndvi = ee.ImageCollection(ids["earth_modis_ndvi"]).filterDate("2023-01-01", "2024-01-01").select("NDVI").mean().multiply(0.0001)

    s2 = ee.ImageCollection(ids["earth_sentinel2"]).filterDate("2023-01-01", "2024-01-01").filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20)).median()
    # Placeholder mafic proxy (B12/B8A ratio). The real index definition belongs to the data owner.
    mineral = s2.select("B12").divide(s2.select("B8A")).rename("mineral_index")

    water = ee.Image(ids["earth_jrc_water"]).select("occurrence").divide(100).unmask(0)  # 0-1 indicator

    return {
        "earth_elevation_m": dem,
        "earth_slope_deg": slope,
        "earth_roughness_m": roughness,
        "earth_temp_range_k": temp_range,
        "earth_mineral_index": mineral,
        "earth_ice_indicator": water,
        "earth_ndvi": ndvi,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    parser.add_argument("--region", required=True, help="west,south,east,north in degrees")
    args = parser.parse_args()

    import ee  # imported lazily: optional dependency

    ee.Initialize(project=args.project)
    w, s, e, n = (float(v) for v in args.region.split(","))
    region = ee.Geometry.Rectangle([w, s, e, n])
    for name, image in build_images(ee, dataset_ids(), region).items():
        task = ee.batch.Export.image.toDrive(
            image=image.toFloat(), description=name, folder="analog_finder_raw", fileNamePrefix=name,
            region=region, scale=SCALE_M, crs="EPSG:4326", maxPixels=1e10,
        )
        task.start()
        print(f"started export {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
