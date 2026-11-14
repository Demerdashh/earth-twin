"""Geodesy helpers. Always pass the body radius — never assume Earth."""

from __future__ import annotations

import math
from typing import Final

#: Mean radii in metres used for great-circle distances.
#: Earth: IUGG mean radius. Moon: IAU 1737.4 km. Mars: IAU 2015 equatorial 3396.19 km.
BODY_RADIUS_M: Final[dict[str, float]] = {
    "earth": 6_371_008.8,
    "moon": 1_737_400.0,
    "mars": 3_396_190.0,
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float, body: str) -> float:
    r = BODY_RADIUS_M[body] / 1000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))
