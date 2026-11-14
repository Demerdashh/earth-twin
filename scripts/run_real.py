#!/usr/bin/env python3
"""Run AnalogLens on real data and write the JSON the API serves.

    python scripts/run_real.py --earth data/earth_egypt.npz --features data/earth_egypt_features.npz \\
        --targets data/targets --embedder auto --out out

Repeat --earth/--features for several regions (features are matched to tiles by id). Every
target .npz in --targets (from cut_target.py) must use the same resolution and tile size as
the Earth tiles. Known analog sites for validation come from config/known_analogs.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from analoglens.embed import get_embedder  # noqa: E402
from analoglens.pipeline import run_pipeline  # noqa: E402


def load_cfg(name):
    data = json.loads((ROOT / "config" / name).read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")} if isinstance(data, dict) else data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--earth", action="append", required=True)
    ap.add_argument("--features", action="append", default=[])
    ap.add_argument("--targets", required=True, help="folder of target .npz files")
    ap.add_argument("--embedder", default="auto", choices=["auto", "dino", "descriptors"])
    ap.add_argument("--max-ndvi", type=float, default=None,
                    help="drop clearly green tiles before embedding (e.g. 0.3); needs ndvi_mean")
    ap.add_argument("--cards", type=int, default=20, help="cards written per target and task")
    ap.add_argument("--novelty-km", type=float, default=200.0)
    ap.add_argument("--out", default="out")
    ap.add_argument("--known", default=None,
                    help="JSON with a 'sites' list to report percentiles for instead of config/known_analogs.json, "
                         "e.g. config/egypt_candidates.json (use a separate --out: novelty flags follow this list)")
    ap.add_argument("--radius-km", type=float, default=100.0,
                    help="a site is credited with the best tile within this distance")
    args = ap.parse_args()

    parts = [np.load(p) for p in args.earth]
    res = {float(p["res_m"]) for p in parts}
    if len(res) != 1:
        sys.exit(f"Earth tiles use different resolutions: {sorted(res)}")
    res_m = res.pop()
    tiles = np.concatenate([p["tiles"] for p in parts])
    ids = [str(i) for p in parts for i in p["ids"]]
    if len(set(ids)) != len(ids):
        sys.exit("duplicate tile ids across --earth files; use a different --prefix per region in cut_tiles.py")
    lat = np.concatenate([p["lat"] for p in parts])
    lon = np.concatenate([p["lon"] for p in parts])

    features = {}
    pos = {tid: i for i, tid in enumerate(ids)}
    for path in args.features:
        f = np.load(path)
        rows = [pos.get(str(t)) for t in f["ids"]]
        for name in f.files:
            if name == "ids":
                continue
            col = features.setdefault(name, np.full(len(ids), np.nan))
            for r, v in zip(rows, f[name]):
                if r is not None:
                    col[r] = v

    keep = np.ones(len(ids), bool)
    if args.max_ndvi is not None:
        if "ndvi_mean" not in features:
            sys.exit("--max-ndvi needs ndvi_mean in --features")
        keep = ~(features["ndvi_mean"] > args.max_ndvi)
        print(f"analog-prone mask keeps {keep.sum()} of {len(ids)} tiles")
    earth = {"ids": [i for i, k in zip(ids, keep) if k], "lat": lat[keep], "lon": lon[keep], "tiles": tiles[keep],
             "features": {k: v[keep] for k, v in features.items()}}

    cfg_targets = load_cfg("targets.json")
    targets = {}
    for path in sorted(Path(args.targets).glob("*.npz")):
        t = np.load(path)
        key = str(t["key"])
        if float(t["res_m"]) != res_m or t["tile"].shape[0] != tiles.shape[1]:
            sys.exit(f"{path.name}: resolution/size differs from the Earth tiles ({res_m} m, {tiles.shape[1]} px)")
        cfg = dict(cfg_targets[key])
        cfg.update(tile=t["tile"], lat=float(t["lat"]), lon=float(t["lon"]))
        targets[key] = cfg
    if not targets:
        sys.exit(f"no target .npz files in {args.targets}")

    if args.known:
        known = json.loads(Path(args.known).read_text(encoding="utf-8"))["sites"]
        for site in known:  # candidate lists name targets ("analog_for"); borrow those targets' tags
            if "known_for" not in site:
                site["known_for"] = sorted({tag for key in site.get("analog_for", [])
                                            for tag in cfg_targets.get(key, {}).get("validation_tags", [])})
    else:
        known = load_cfg("known_analogs.json")["sites"]
    dims = load_cfg("dimensions.json")
    run_pipeline(earth, targets, load_cfg("tasks.json"), dims, load_cfg("bodies.json"), known, args.out,
                 get_embedder(args.embedder), res_m, cards_per_task=args.cards, novelty_km=args.novelty_km,
                 validation_radius_km=args.radius_km)
    print(f"done: serve with ANALOGLENS_OUT={args.out} uvicorn analoglens.api:app --reload")


if __name__ == "__main__":
    main()
