#!/usr/bin/env python3
"""Cut one target tile (Moon or Mars) at the same scale as the Earth tiles.

From a global equirectangular DEM (MOLA MEGDR, LOLA LDEM; coordinates from config/targets.json):
    python scripts/cut_target.py --key medusae_fossae --raster megt00n180hb.lbl --body mars --out data/targets

From a polar stereographic DEM in metres (e.g. a LOLA south-pole GeoTIFF):
    python scripts/cut_target.py --key shackleton_rim --raster lola_sp.tif --polar south --out data/targets

From NASA's App Development Challenge 2023 regional CSVs (height, latitude, longitude grids):
    python scripts/cut_target.py --key malapert_massif --adc-height Malapert_Height.csv \\
        --adc-lat Malapert_Lat.csv --adc-lon Malapert_Lon.csv --out data/targets

The ADC regions are only a few kilometres to tens of kilometres across. If a region is
smaller than the tile (size x res), the script stops and suggests a finer --res-m; cut the
Earth tiles at that same resolution (e.g. from Copernicus DEM 30 m) so the scales match.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from analoglens.geo import GlobalRaster, MetricRaster, haversine_km, polar_stereo_xy  # noqa: E402


def read_grid_csv(path) -> np.ndarray:
    """Read a numeric grid from CSV, dropping header rows/columns that do not parse."""
    grid = np.genfromtxt(path, delimiter=",", dtype=float)
    grid = np.atleast_2d(grid)
    grid = grid[~np.all(np.isnan(grid), axis=1)]
    return grid[:, ~np.all(np.isnan(grid), axis=0)]


def adc_tile(height_csv, lat_csv, lon_csv, size, res_m):
    h, la, lo = read_grid_csv(height_csv), read_grid_csv(lat_csv), read_grid_csv(lon_csv)
    if not (h.shape == la.shape == lo.shape):
        sys.exit(f"grid shapes differ: height {h.shape}, lat {la.shape}, lon {lo.shape}")
    dx = np.nanmedian(haversine_km(la[:, :-1], lo[:, :-1], la[:, 1:], lo[:, 1:], "moon")) * 1000
    dy = np.nanmedian(haversine_km(la[:-1], lo[:-1], la[1:], lo[1:], "moon")) * 1000
    if abs(dx - dy) / max(dx, dy) > 0.05:
        print(f"warning: pixels are not square ({dx:.1f} m x {dy:.1f} m); using their mean")
    src_res = (dx + dy) / 2
    extent_m = min(h.shape) * src_res
    if extent_m < size * res_m:
        finer = extent_m / size
        sys.exit(f"region is {extent_m / 1000:.1f} km across but the tile needs {size * res_m / 1000:.1f} km; "
                 f"rerun with --res-m {finer:.0f} or less (and cut Earth tiles at the same resolution)")
    raster = MetricRaster(h, x_left=0.0, y_top=h.shape[0] * src_res, res_m=src_res)
    cy, cx = (h.shape[0] / 2) * src_res, (h.shape[1] / 2) * src_res
    r0, c0 = h.shape[0] // 2, h.shape[1] // 2
    return raster.window(cx, cy, size, res_m), float(la[r0, c0]), float(lo[r0, c0]), src_res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key", required=True, help="target key in config/targets.json")
    ap.add_argument("--raster")
    ap.add_argument("--body", choices=["moon", "mars"])
    ap.add_argument("--polar", choices=["south", "north"])
    ap.add_argument("--adc-height")
    ap.add_argument("--adc-lat")
    ap.add_argument("--adc-lon")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--res-m", type=float, default=463.0)
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--out", required=True, help="output folder")
    args = ap.parse_args()

    targets = json.loads((ROOT / "config" / "targets.json").read_text(encoding="utf-8"))
    cfg = targets.get(args.key)
    if cfg is None:
        sys.exit(f"unknown target {args.key}; add it to config/targets.json first")
    lat = args.lat if args.lat is not None else cfg.get("lat")
    lon = args.lon if args.lon is not None else cfg.get("lon")

    if args.adc_height:
        tile, lat, lon, src_res = adc_tile(args.adc_height, args.adc_lat, args.adc_lon, args.size, args.res_m)
        print(f"ADC grid: {src_res:.1f} m per pixel; tile centre {lat:.4f}, {lon:.4f}")
    elif args.polar:
        if lat is None or lon is None:
            sys.exit("this target has no coordinates in config; pass --lat and --lon")
        raster = MetricRaster.from_geotiff(args.raster)
        cx, cy = polar_stereo_xy(lat, lon, body=cfg["body"], pole=args.polar)
        tile = raster.window(float(cx), float(cy), args.size, args.res_m)
        print("CHECK: open the PNG preview and confirm the feature sits in the middle (projection conventions vary)")
    else:
        if lat is None or lon is None:
            sys.exit("this target has no coordinates in config; pass --lat and --lon")
        raster = GlobalRaster.from_geotiff(args.raster, body=args.body or cfg["body"])
        tile = raster.tile(lat, lon, args.size, args.res_m, cfg["body"])

    valid = np.isfinite(tile).mean()
    if valid < 0.95:
        print(f"warning: only {valid:.0%} of the tile has data")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / f"{args.key}.npz", tile=tile.astype(np.float32), key=args.key, body=cfg["body"],
                        lat=lat, lon=lon, res_m=args.res_m)
    try:
        from analoglens.render import save_relief_png

        save_relief_png(tile, args.res_m, out / f"{args.key}.png")
        print(f"preview: {out / (args.key + '.png')}")
    except ImportError:
        pass
    print(f"saved {out / (args.key + '.npz')}: relief {np.nanmax(tile) - np.nanmin(tile):.0f} m")


if __name__ == "__main__":
    main()
