"""Overlay colour ramps. Keep in sync with src/config/colormaps.ts (the UI legends)."""

from __future__ import annotations

from typing import Final

# (position 0-1, (r, g, b, a)) — alpha encodes confidence so low values fade out.
RAMPS: Final[dict[str, list[tuple[float, tuple[int, int, int, int]]]]] = {
    "similarity": [
        (0.00, (13, 27, 42, 0)),
        (0.25, (31, 78, 121, 110)),
        (0.50, (42, 157, 143, 170)),
        (0.75, (233, 196, 106, 210)),
        (1.00, (255, 244, 214, 235)),
    ],
    "vegetation_exclusion": [
        (0.00, (120, 200, 120, 0)),
        (1.00, (120, 200, 120, 150)),
    ],
    "water_ice": [
        (0.00, (90, 170, 255, 0)),
        (0.50, (90, 170, 255, 120)),
        (1.00, (200, 235, 255, 220)),
    ],
}


def sample(ramp: str, value: float) -> tuple[int, int, int, int]:
    stops = RAMPS[ramp]
    v = min(1.0, max(0.0, value))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if v <= p1:
            t = 0.0 if p1 == p0 else (v - p0) / (p1 - p0)
            r, g, b, a = (round(c0[i] + (c1[i] - c0[i]) * t) for i in range(4))
            return (r, g, b, a)
    return stops[-1][1]
