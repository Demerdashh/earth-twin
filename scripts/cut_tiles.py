#!/usr/bin/env python3
"""Cut metric Earth tiles from DEM GeoTIFFs (e.g. ETOPO 2022 15-arc-second tiles).

Grid over a bounding box:
    python scripts/cut_tiles.py --raster etopo_N30E015.tif --raster etopo_N30E030.tif \\
        --bbox 20 32 24 36 --step-km 30 --res-m 463 --size 64 --prefix EG --out data/earth_egypt.npz

Specific centres (CSV with columns id,lat,lon, or a config JSON with a "sites" list):
    python scripts/cut_tiles.py --raster ... --centers data/egypt_sites.csv --out data/egypt_sites.npz
    python scripts/cut_tiles.py --raster ... --centers config/known_analogs.json --out data/known.npz

Validation only works if the Earth tiles include the known analog sites, so always cut
config/known_analogs.json too (Copernicus DEM 90 m tiles around each site are enough).

Ocean tiles are dropped unless at least --min-land-frac of pixels are above sea level.
Lower it (or pass --min-land-frac 0) for depressions below sea level such as Qattara.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analoglens.geo import GlobalRaster, local_grid_latlon  # noqa: E402


def safe_id(text: str) -> str:
    """Tile ids become file names and URL parts: keep letters, digits, _ and -."""
    return re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")[:60] or "tile"


def grid_centres(lat_min, lat_max, lon_min, lon_max, step_km):
    """Centres about step_km apart on the ground (longitude spacing widens with latitude)."""
    centres = []
    lat = lat_min + step_km / 111.32 / 2
    while lat < lat_max:
        dlon = step_km / (111.32 * max(math.cos(math.radians(lat)), 0.05))
        lon = lon_min + dlon / 2
        while lon < lon_max:
            centres.append((round(lat, 5), round(lon, 5)))
            lon += dlon
        lat += step_km / 111.32
    return centres


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raster", action="append", required=True, help="DEM GeoTIFF (repeat for several tiles)")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("LAT_MIN", "LAT_MAX", "LON_MIN", "LON_MAX"))
    ap.add_argument("--centers", help="CSV with id,lat,lon")
    ap.add_argument("--step-km", type=float, default=30.0)
    ap.add_argument("--res-m", type=float, default=463.0)
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--min-valid", type=float, default=0.95, help="minimum fraction of pixels with data")
    ap.add_argument("--min-land-frac", type=float, default=0.5, help="minimum fraction of pixels above 0 m")
    ap.add_argument("--prefix", default="E")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rasters = [GlobalRaster.from_geotiff(p) for p in args.raster]
    if args.centers and args.centers.endswith(".json"):
        sites = json.loads(Path(args.centers).read_text(encoding="utf-8"))["sites"]
        centres = [(float(s["lat"]), float(s["lon"])) for s in sites]
        names = [safe_id(f"{args.prefix}_{s['name']}") for s in sites]
    elif args.centers:
        with open(args.centers, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        centres = [(float(r["lat"]), float(r["lon"])) for r in rows]
        names = [safe_id(r["id"]) for r in rows]
    elif args.bbox:
        centres = grid_centres(*args.bbox, args.step_km)
        names = None
    else:
        ap.error("give --bbox or --centers")

    tiles, lats, lons, ids = [], [], [], []
    for k, (la, lo) in enumerate(centres):
        glat, glon = local_grid_latlon(la, lo, args.size, args.res_m, "earth")
        tile = np.full(glat.shape, np.nan)
        for r in rasters:  # first raster with data wins, so neighbouring source tiles stitch
            vals = r.sample(glat, glon)
            tile = np.where(np.isfinite(tile), tile, vals)
        valid = np.isfinite(tile)
        if valid.mean() < args.min_valid or (np.nan_to_num(tile, nan=-1) > 0).mean() < args.min_land_frac:
            continue
        tiles.append(tile.astype(np.float32))
        lats.append(la)
        lons.append(lo)
        ids.append(names[k] if names else safe_id(f"{args.prefix}{len(ids):05d}"))

    if not tiles:
        sys.exit("no tiles kept: check the bbox, the rasters' coverage, and --min-land-frac")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, tiles=np.stack(tiles), lat=np.array(lats), lon=np.array(lons), ids=np.array(ids),
                        res_m=args.res_m, sources=np.array(args.raster))
    print(f"kept {len(tiles)} of {len(centres)} tiles -> {out}")


if __name__ == "__main__":
    main()
