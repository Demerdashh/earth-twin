#!/usr/bin/env python3
"""End-to-end run on SYNTHETIC terrain and climate.

Why it exists: it proves the whole pipeline works before any real data is downloaded, and it
writes exactly the JSON the frontend reads, so the full-stack developers can build against it
from hour 0. Every output is flagged "synthetic": true. Never present these numbers as findings.

    python scripts/demo_synthetic.py                  # descriptor embedder, about a minute
    python scripts/demo_synthetic.py --embedder dino  # needs torch + cached DINOv2 weights
    python scripts/demo_synthetic.py --n 1200 --out out_big
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analoglens import synthetic as S  # noqa: E402
from analoglens.embed import get_embedder  # noqa: E402
from analoglens.pipeline import run_pipeline  # noqa: E402

RES_M, N_PX = 463.0, 64

# Earth tile mix: share, latitude band (absolute degrees), generator, NDVI range, dust range.
MIX = {
    "crater":      (0.05, (15, 40), "crater",     (0.03, 0.12), (0.25, 0.60)),
    "crater_cold": (0.02, (65, 78), "crater",     (0.02, 0.10), (0.02, 0.08)),
    "yardang":     (0.06, (18, 35), "yardang",    (0.01, 0.06), (0.40, 0.80)),
    "dune":        (0.08, (15, 35), "dune",       (0.01, 0.06), (0.40, 0.80)),
    "massif":      (0.08, (10, 70), "massif",     (0.10, 0.50), (0.05, 0.25)),
    "hills":       (0.22, (0, 60),  "hills",      (0.30, 0.75), (0.03, 0.20)),
    "plain_arid":  (0.12, (15, 40), "plain",      (0.04, 0.15), (0.20, 0.50)),
    "plain_icy":   (0.08, (60, 80), "plain",      (0.05, 0.30), (0.02, 0.08)),
    "cone_field":  (0.07, (10, 65), "cone_field", (0.05, 0.40), (0.05, 0.30)),
    "plain_green": (0.22, (0, 55),  "plain",      (0.50, 0.85), (0.02, 0.15)),
}

# Which synthetic types count as true analogs of each target (for the AUC check).
POSITIVE_TYPES = {
    "shackleton_rim": {"crater", "crater_cold"},
    "malapert_massif": {"massif"},
    "medusae_fossae": {"yardang"},
    "arcadia_planitia": {"plain_icy"},
}
KNOWN_TAG = {"crater": "crater", "crater_cold": "crater", "yardang": "yardang",
             "plain_icy": "permafrost", "massif": "massif"}


def make_tile(rng, gen: str, kind: str):
    if gen == "crater":
        return S.crater_field(rng)
    if gen == "plain":
        return S.plain(rng, pits=int(rng.integers(3, 8)) if kind == "plain_icy" else 0)
    return S.GENERATORS[gen](rng)


def climate(rng, lat: float, ndvi_range, dust_range, kind: str) -> dict:
    """Plausible-looking but invented climate numbers."""
    ndvi = rng.uniform(*ndvi_range)
    mean = 30.0 - 0.0065 * lat ** 2 + rng.normal(0, 2.5)
    swing = 8.0 + 0.35 * abs(lat) + 35.0 * (1.0 - ndvi) + rng.normal(0, 4)
    if kind in ("plain_icy", "crater_cold"):
        ice = rng.uniform(0.6, 1.0)
    elif abs(lat) > 60:
        ice = rng.uniform(0.3, 0.7)
    else:
        ice = 0.0
    return {"ndvi_mean": ndvi, "lst_min_c": mean - swing / 2, "lst_range_c": swing,
            "dust_aod": rng.uniform(*dust_range), "ground_ice": ice}


def build_earth(n: int, seed: int):
    rng = np.random.default_rng(seed)
    kinds = rng.choice(list(MIX), size=n, p=[v[0] for v in MIX.values()])
    tiles, lat, lon, feats = [], [], [], {k: [] for k in ("ndvi_mean", "lst_min_c", "lst_range_c", "dust_aod", "ground_ice")}
    for kind in kinds:
        _, (lo, hi), gen, ndvi_r, dust_r = MIX[kind]
        la = rng.uniform(lo, hi) * (1 if kind in ("plain_icy", "crater_cold") and rng.random() < 0.8 else rng.choice([-1, 1]))
        lat.append(la)
        lon.append(rng.uniform(-180, 180))
        tiles.append(make_tile(rng, gen, kind))
        for k, v in climate(rng, la, ndvi_r, dust_r, kind).items():
            feats[k].append(v)
    kinds = [str(k) for k in kinds]
    # One Kharga-like yardang tile at Kharga's position, deliberately NOT in the known list:
    # the novelty filter should surface it as a candidate new analog.
    kinds.append("yardang")
    lat.append(25.45)
    lon.append(30.55)
    tiles.append(S.yardang_field(rng))
    for k, v in climate(rng, 25.45, MIX["yardang"][3], MIX["yardang"][4], "yardang").items():
        feats[k].append(v)
    ids = [f"E{i:05d}" for i in range(len(tiles))]
    return {"ids": ids, "lat": np.array(lat), "lon": np.array(lon), "tiles": np.stack(tiles).astype(np.float32),
            "features": {k: np.array(v) for k, v in feats.items()}}, kinds


def build_targets(seed: int, real_cfg: dict) -> dict:
    rng = np.random.default_rng(seed + 1)
    tiles = {
        # Shackleton: 21 km wide, 4.2 km deep (depth/diameter 0.2), cratered surroundings.
        "shackleton_rim": S.crater_field(rng, radius_px=22.7, depth_ratio=0.2, rim_ratio=0.014,
                                         small=(8, 20), noise_m=(10, 20)),
        "malapert_massif": S.massif(rng, height_m=(4500, 5000)),
        "medusae_fossae": S.yardang_field(rng, height_m=(120, 300), spacing_px=(4.0, 6.0)),
        "arcadia_planitia": S.plain(rng, relief_m=(5, 15), pits=6),
    }
    targets = {}
    for key, tile in tiles.items():
        cfg = {k: v for k, v in real_cfg[key].items() if not k.startswith("_")}
        cfg["tile"] = tile.astype(np.float32)
        cfg["notes"] = "SYNTHETIC terrain standing in for the real DEM tile"
        targets[key] = cfg
    return targets


def known_sites_from(kinds, earth, seed: int, per_type: int = 3):
    rng = np.random.default_rng(seed + 2)
    sites = []
    for kind, tag in KNOWN_TAG.items():
        idx = [i for i, k in enumerate(kinds[:-1]) if k == kind]  # never pick the Kharga-like tile
        for j, i in enumerate(rng.choice(idx, size=min(per_type, len(idx)), replace=False), start=1):
            sites.append({"name": f"Known {kind.replace('_', ' ')} site {j} (synthetic)",
                          "lat": float(earth["lat"][i]), "lon": float(earth["lon"][i]), "known_for": [tag]})
    return sites


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=600, help="number of synthetic Earth tiles")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--embedder", default="descriptors", choices=["descriptors", "dino", "auto"])
    ap.add_argument("--out", default=str(ROOT / "out"))
    args = ap.parse_args()

    cfg_dir = ROOT / "config"
    load = lambda name: json.loads((cfg_dir / name).read_text(encoding="utf-8"))  # noqa: E731
    tasks, dims, bodies, real_targets = load("tasks.json"), load("dimensions.json"), load("bodies.json"), load("targets.json")
    dims = {k: v for k, v in dims.items() if not k.startswith("_")}

    t0 = time.time()
    earth, kinds = build_earth(args.n, args.seed)
    targets = build_targets(args.seed, real_targets)
    known = known_sites_from(kinds, earth, args.seed)
    positives = {t: np.array([k in types for k in kinds]) for t, types in POSITIVE_TYPES.items()}
    for site in known:  # the synthetic known sites satisfy the real targets' validation tags
        tag = site["known_for"][0]
        site["known_for"] = {"crater": ["crater"], "yardang": ["yardang"], "permafrost": ["permafrost"],
                             "massif": ["massif"]}[tag]

    print(f"SYNTHETIC demo: {len(earth['ids'])} Earth tiles, {len(targets)} targets, {len(known)} known sites")
    summary = run_pipeline(earth, targets, tasks, dims, bodies, known, args.out, get_embedder(args.embedder),
                           RES_M, positives_by_target=positives, synthetic=True)

    print("\nWhat ranks on top (synthetic types in the top 10):")
    kind_of = dict(zip(earth["ids"], kinds))
    for key in summary["validation"]:
        ranked = json.loads((Path(args.out) / "rank" / f"{key}.json").read_text())["results"]
        top = Counter(kind_of[r["tile_id"]] for r in ranked[:10])
        novel = sum(r["novel"] for r in ranked[:10])
        print(f"  {key:42s} {dict(top.most_common(3))}  novel in top 10: {novel}")
    kharga_id = earth["ids"][-1]
    ranked = json.loads((Path(args.out) / "rank" / "medusae_fossae__wind_erosion_science.json").read_text())["results"]
    pos = next((r["rank"] for r in ranked if r["tile_id"] == kharga_id), None)
    print(f"\nKharga-like tile ({kharga_id}) rank for Medusae Fossae x wind erosion: "
          f"{pos if pos else 'not in top 50'} (it is deliberately absent from the known list)")
    print(f"\nWrote {args.out} in {time.time() - t0:.1f} s. Serve it with:\n"
          f"  ANALOGLENS_OUT={args.out} uvicorn analoglens.api:app --reload")


if __name__ == "__main__":
    main()
