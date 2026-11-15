#!/usr/bin/env python3
"""Attach climate and surface features to Earth tiles by averaging rasters over each tile.

    python scripts/sample_climate.py --tiles data/earth_egypt.npz \\
        --monthly-lst "data/lst_day/*.tif" --monthly-lst "data/lst_night/*.tif" \\
        --lst-scale 0.02 --lst-offset -273.15 \\
        --monthly-ndvi "data/ndvi/*.tif" --ndvi-scale 0.0001 \\
        --layer dust_aod=data/merra2_dust_aod_annual.tif \\
        --layer ground_ice=data/permafrost_fraction.tif \\
        --out data/earth_egypt_features.npz

Produces lst_min_c, lst_max_c, lst_range_c, ndvi_mean, plus every --layer by name. Inputs
must be north-up lat/lon GeoTIFFs: AppEEARS and Giovanni both export those. The scale and
offset defaults above match MODIS MOD11C3 (LST, kelvin x 0.02) and MOD13C2 (NDVI x 0.0001);
check your product's documentation. Leaving a layer out is fine: missing data lowers a
tile's coverage instead of counting as a match.
"""
from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analoglens.geo import GlobalRaster, local_grid_latlon  # noqa: E402

SUB = 5  # sample a 5 x 5 grid across each tile's footprint


def footprints(lat, lon, extent_m):
    pts = [local_grid_latlon(la, lo, SUB, extent_m / SUB, "earth") for la, lo in zip(lat, lon)]
    return np.stack([p[0] for p in pts]), np.stack([p[1] for p in pts])


def tile_means(path, flat, flon, scale=1.0, offset=0.0, valid_range=None):
    vals = GlobalRaster.from_geotiff(path).sample(flat, flon) * scale + offset
    if valid_range is not None:
        vals = np.where((vals < valid_range[0]) | (vals > valid_range[1]), np.nan, vals)
    with np.errstate(all="ignore"):
        return np.nanmean(vals.reshape(vals.shape[0], -1), axis=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--monthly-lst", action="append", default=[], help="glob of monthly LST GeoTIFFs (repeatable)")
    ap.add_argument("--lst-scale", type=float, default=0.02)
    ap.add_argument("--lst-offset", type=float, default=-273.15)
    ap.add_argument("--monthly-ndvi", action="append", default=[], help="glob of monthly NDVI GeoTIFFs")
    ap.add_argument("--ndvi-scale", type=float, default=0.0001)
    ap.add_argument("--layer", action="append", default=[], help="name=path.tif, used as is")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    data = np.load(args.tiles)
    lat, lon, ids = data["lat"], data["lon"], data["ids"]
    extent_m = float(data["res_m"]) * data["tiles"].shape[1]
    flat, flon = footprints(lat, lon, extent_m)
    feats = {}

    lst_files = sorted(f for g in args.monthly_lst for f in glob.glob(g))
    if lst_files:
        stack = np.stack([tile_means(f, flat, flon, args.lst_scale, args.lst_offset, (-120, 90)) for f in lst_files])
        with np.errstate(all="ignore"):
            feats["lst_min_c"] = np.nanmin(stack, axis=0)
            feats["lst_max_c"] = np.nanmax(stack, axis=0)
        feats["lst_range_c"] = feats["lst_max_c"] - feats["lst_min_c"]
        print(f"LST from {len(lst_files)} files")
    ndvi_files = sorted(f for g in args.monthly_ndvi for f in glob.glob(g))
    if ndvi_files:
        stack = np.stack([tile_means(f, flat, flon, args.ndvi_scale, 0.0, (-1, 1)) for f in ndvi_files])
        with np.errstate(all="ignore"):
            feats["ndvi_mean"] = np.nanmean(stack, axis=0)
        print(f"NDVI from {len(ndvi_files)} files")
    for spec in args.layer:
        name, path = spec.split("=", 1)
        feats[name] = tile_means(path, flat, flon)
        print(f"{name} from {path}")
    if not feats:
        sys.exit("nothing to sample: pass --monthly-lst, --monthly-ndvi, or --layer")

    for name, values in feats.items():
        print(f"  {name}: {np.isfinite(values).mean():.0%} of tiles have data")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, ids=ids, **feats)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
