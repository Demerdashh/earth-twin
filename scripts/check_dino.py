#!/usr/bin/env python3
"""Check that DINOv2 works on this machine before the event (run it on Wednesday).

    pip install torch            # CPU build is fine for a few thousand tiles
    python scripts/check_dino.py

It downloads the weights once into the torch hub cache (bring that cache folder on a USB
drive as a backup), embeds a few synthetic tiles, and checks that craters look more like
craters than like yardangs. If this fails, the pipeline still runs with --embedder descriptors.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analoglens import synthetic as S  # noqa: E402
from analoglens.embed import DinoEmbedder  # noqa: E402


def main():
    t0 = time.time()
    emb = DinoEmbedder()
    print(f"loaded {emb.name} on {emb.device} in {time.time() - t0:.1f} s")
    rng = np.random.default_rng(0)
    tiles = [S.crater_field(rng), S.crater_field(rng), S.yardang_field(rng), S.yardang_field(rng)]
    t0 = time.time()
    f = emb.embed(tiles, 463.0)
    print(f"embedded {len(tiles)} tiles x {emb.rotations} rotations in {time.time() - t0:.1f} s; vector size {f.shape[1]}")
    sim = f @ f.T
    print("cosine similarity (crater, crater, yardang, yardang):")
    print(np.round(sim, 3))
    same = (sim[0, 1] + sim[2, 3]) / 2
    cross = sim[:2, 2:].mean()
    print(f"same-type {same:.3f} vs cross-type {cross:.3f}: {'OK' if same > cross else 'UNEXPECTED, check the relief images'}")


if __name__ == "__main__":
    main()
