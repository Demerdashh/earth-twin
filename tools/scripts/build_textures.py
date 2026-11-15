"""Build the globe textures in public/textures/ from real NASA tiles (config/imagery.json).

  earth.webp  Blue Marble shaded relief (GIBS), Web Mercator reprojected to equirectangular
  moon.webp   LRO WAC mosaic blended with LOLA hillshade for relief contrast
  mars.webp   Viking MDIM 2.1 colour blended with MOLA hillshade for relief contrast
  moon_dot.webp  tiny equirectangular Moon for the preloader dots

Display imagery only: nothing here is ever scored. Tiles are cached in tools/cache/tiles.
Run: node tools/scripts/py.mjs tools/scripts/build_textures.py
"""

from __future__ import annotations

import io
import json
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "cache" / "tiles"
OUT = ROOT / "public" / "textures"
IMAGERY = json.loads((ROOT / "config" / "imagery.json").read_text(encoding="utf-8"))
W, H = 2048, 1024  # output size: light enough for the web, sharp enough for the globe views
TILE = 256


def fetch(layer: dict, z: int, y: int, x: int) -> Image.Image:
    ext = layer["url"].rsplit(".", 1)[-1]
    path = CACHE / layer["product"] / str(z) / str(y) / f"{x}.{ext}"
    if not path.is_file():
        url = layer["url"].format(z=z, y=y, x=x)
        req = urllib.request.Request(url, headers={"User-Agent": "analoglens-texture-builder"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return Image.open(io.BytesIO(path.read_bytes())).convert("RGB")


def mosaic(layer: dict, z: int) -> np.ndarray:
    """Stitch a whole level into one float RGB array in [0, 1]."""
    cols = 2 ** (z + 1) if layer["scheme"] == "geographic" else 2**z
    rows = 2**z
    jobs = [(y, x) for y in range(rows) for x in range(cols)]
    with ThreadPoolExecutor(8) as pool:
        tiles = list(pool.map(lambda yx: fetch(layer, z, *yx), jobs))
    img = Image.new("RGB", (cols * TILE, rows * TILE))
    for (y, x), t in zip(jobs, tiles):
        img.paste(t.resize((TILE, TILE)), (x * TILE, y * TILE))
    return np.asarray(img, dtype=np.float32) / 255.0


def resize(a: np.ndarray, w: int = W, h: int = H) -> np.ndarray:
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((w, h), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0


def luminance(a: np.ndarray) -> np.ndarray:
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def stretch(a: np.ndarray, lo: float = 0.5, hi: float = 99.6) -> np.ndarray:
    p0, p1 = np.percentile(a, [lo, hi])
    return np.clip((a - p0) / max(p1 - p0, 1e-6), 0, 1)


def blend_relief(color: np.ndarray, shade: np.ndarray, strength: float) -> np.ndarray:
    """Multiply colour by a normalised hillshade so craters and ridges read clearly."""
    s = luminance(shade)
    s = s / max(float(np.median(s)), 1e-6)
    gain = (1 - strength) + strength * s
    return np.clip(color * gain[..., None], 0, 1)


def mercator_to_equirect(merc: np.ndarray) -> np.ndarray:
    size = merc.shape[0]
    lat = np.linspace(90, -90, H, endpoint=False) - 90 / H
    lat = np.clip(lat, -85.0511, 85.0511)
    y = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * size
    rows = np.clip(y.astype(int), 0, size - 1)
    cols = np.clip((np.arange(W) / W * merc.shape[1]).astype(int), 0, merc.shape[1] - 1)
    out = merc[rows][:, cols]
    # Web Mercator stops at +-85.05 deg: fill the caps with the mean colour of the 84 deg rows
    # instead of stretching the noisy edge row.
    raw_lat = np.linspace(90, -90, H, endpoint=False) - 90 / H
    north, south = raw_lat > 84, raw_lat < -84
    for cap, edge_lat in ((north, 84), (south, -84)):
        edge_row = out[int(np.argmin(np.abs(raw_lat - edge_lat)))]
        out[cap] = edge_row.mean(axis=0)
    return out


def save(a: np.ndarray, name: str, quality: int = 80) -> None:
    """WebP keeps the three globes at roughly 1 MB total."""
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(path, "WEBP", quality=quality, method=6)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def main() -> None:
    earth = mercator_to_equirect(mosaic(IMAGERY["earth"]["color"], 3))
    save(stretch(earth, 0.2, 99.8) ** 0.95, "earth.webp")

    moon = blend_relief(resize(mosaic(IMAGERY["moon"]["color"], 3)), resize(mosaic(IMAGERY["moon"]["shade"], 3)), 0.55)
    moon = stretch(moon) ** 1.05
    save(moon, "moon.webp", quality=70)
    save(resize(moon, 128, 64), "moon_dot.webp", quality=85)

    mars = blend_relief(resize(mosaic(IMAGERY["mars"]["color"], 3)), resize(mosaic(IMAGERY["mars"]["shade"], 3)), 0.45)
    save(stretch(mars, 0.3, 99.7), "mars.webp", quality=72)


if __name__ == "__main__":
    main()
