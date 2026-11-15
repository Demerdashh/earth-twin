"""Build public/preloader/moon.jpg (512x256 equirectangular) from the bundled LRO WAC fallback tiles.

Real NASA imagery (LRO WAC global mosaic via Moon Trek, level 1 = 4x2 tiles of 256 px),
stitched and downsized so the preloader needs one ~25 KB file and no network.
Run: node tools/scripts/py.mjs tools/scripts/make_preloader_moon.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TILES = ROOT / "public" / "basemaps" / "trek_moon_lro_wac" / "1"
OUT = ROOT / "public" / "preloader" / "moon.jpg"

sheet = Image.new("RGB", (4 * 256, 2 * 256))
for y in range(2):
    for x in range(4):
        sheet.paste(Image.open(TILES / str(y) / f"{x}.jpg").convert("RGB"), (x * 256, y * 256))
OUT.parent.mkdir(parents=True, exist_ok=True)
sheet.resize((512, 256), Image.Resampling.LANCZOS).save(OUT, "JPEG", quality=82, optimize=True, progressive=True)
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
