"""The data contract shared with the web app (see CLAUDE.md and schemas/)."""

from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
SCHEMA_DIR: Final = REPO_ROOT / "schemas"
SCHEMA_VERSION: Final = "1.0"

#: Features compared between bodies, in contract order. Units are in CLAUDE.md.
COMPARABLE_FEATURES: Final[tuple[str, ...]] = (
    "elevation_m",
    "slope_deg",
    "roughness",
    "temp_range_k",
    "mineral_index",
    "ice_indicator",
)
EARTH_FEATURES: Final[tuple[str, ...]] = (*COMPARABLE_FEATURES, "ndvi")

FEATURE_UNITS: Final[dict[str, str]] = {
    "elevation_m": "m",
    "slope_deg": "deg",
    "roughness": "m",
    "temp_range_k": "K",
    "mineral_index": "index 0-1",
    "ice_indicator": "indicator 0-1",
    "ndvi": "NDVI",
}
