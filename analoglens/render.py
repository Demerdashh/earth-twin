"""Shaded-relief PNGs for the side-by-side terrain view on each card.

Earth and target tiles are rendered the same way (same normalisation, same sun), so what
people see side by side is exactly what the vision model compared.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .terrain import NORM_REL, hillshade, normalise_relief


def relief_rgb(dem: np.ndarray, res_m: float) -> np.ndarray:
    d = normalise_relief(dem, res_m)
    width_m = dem.shape[1] * res_m
    shade = hillshade(d, res_m)
    elev = np.clip(0.5 + d / (5.0 * NORM_REL * width_m), 0.0, 1.0)
    # Warm tint for high ground, cool for low: a gentle cue on top of the shading.
    low, high = np.array([0.36, 0.42, 0.50]), np.array([0.80, 0.70, 0.55])
    tint = low[None, None, :] * (1 - elev[..., None]) + high[None, None, :] * elev[..., None]
    rgb = (0.35 + 0.65 * shade[..., None]) * tint * 1.25
    return (np.clip(rgb, 0, 1) * 255).round().astype(np.uint8)


def save_relief_png(dem: np.ndarray, res_m: float, path, size_px: int = 256) -> str:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(relief_rgb(dem, res_m)).resize((size_px, size_px), Image.BICUBIC).save(path, optimize=True)
    return str(path)
