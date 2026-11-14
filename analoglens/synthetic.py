"""Synthetic terrain for testing the pipeline offline. NOT real data.

Each generator returns an elevation tile in metres on a square grid. Magnitudes are
plausible at about 463 m per pixel (64 px is about 30 km), so the physical bars behave
sensibly, but none of this stands in for real DEMs in a presentation.
"""
from __future__ import annotations

import numpy as np


def fractal(rng: np.random.Generator, n: int = 64, beta: float = 3.2) -> np.ndarray:
    """Unit-variance fractal noise with power spectrum ~ k^-beta."""
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    k = np.hypot(fx, fy)
    k[0, 0] = 1.0
    amp = k ** (-beta / 2.0)
    amp[0, 0] = 0.0
    z = np.real(np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))))
    return (z - z.mean()) / (z.std() + 1e-12)


def _grid(n):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    return yy, xx


def _crater(r, radius, depth, rim):
    """Bowl, raised rim, and an ejecta blanket that decays outside the rim."""
    inside = r < radius
    bowl = -depth * (1 - (r / radius) ** 2) + rim
    blanket = rim * (radius / np.maximum(r, 1e-6)) ** 3
    return np.where(inside, bowl, blanket)


def crater_field(rng, n=64, res_m=463.0, radius_px=None, depth_ratio=None, rim_ratio=0.04,
                 small=(3, 10), noise_m=(15, 60)):
    """One main crater plus small ones. Depth ratio is depth / diameter: about 0.2 for
    fresh lunar craters (Shackleton: 4.2 km deep, 21 km wide), lower for eroded Earth ones."""
    yy, xx = _grid(n)
    radius_px = radius_px or rng.uniform(9, 24)
    depth_ratio = depth_ratio or rng.uniform(0.08, 0.15)
    cy, cx = n / 2 + rng.normal(0, 2.5), n / 2 + rng.normal(0, 2.5)
    diameter_m = 2 * radius_px * res_m
    z = _crater(np.hypot(yy - cy, xx - cx), radius_px, depth_ratio * diameter_m, rim_ratio * diameter_m)
    for _ in range(rng.integers(*small)):
        rr = rng.uniform(1.2, 3.5)
        sy, sx = rng.uniform(0, n, 2)
        z += _crater(np.hypot(yy - sy, xx - sx), rr, 0.18 * 2 * rr * res_m, 0.03 * 2 * rr * res_m)
    return z + fractal(rng, n, 3.3) * rng.uniform(*noise_m)


def yardang_field(rng, n=64, height_m=(30, 90), spacing_px=(3.0, 6.0), angle=None, noise_m=8.0):
    """Streamlined ridges: blunt upwind, tapering downwind, aligned with the wind."""
    yy, xx = _grid(n)
    theta = rng.uniform(0, np.pi) if angle is None else angle
    u = (xx - n / 2) * np.cos(theta) + (yy - n / 2) * np.sin(theta)    # along the wind
    v = -(xx - n / 2) * np.sin(theta) + (yy - n / 2) * np.cos(theta)   # across the wind
    z = np.zeros((n, n))
    spacing = rng.uniform(*spacing_px)
    for v0 in np.arange(-n, n, spacing):
        for _ in range(rng.integers(1, 4)):
            u0 = rng.uniform(-n, n)
            length = rng.uniform(5, 16)
            width = rng.uniform(0.7, 1.6)
            s = u - u0
            along = np.where(s > 0, np.exp(-0.5 * (s / length) ** 2), np.exp(-0.5 * (s / (0.3 * length)) ** 2))
            z += rng.uniform(*height_m) * np.exp(-0.5 * ((v - v0 - rng.normal(0, 0.4)) / width) ** 2) * along
    return z + fractal(rng, n, 3.0) * noise_m


def dune_field(rng, n=64, height_m=(20, 60), wavelength_px=(4.0, 9.0), angle=None, noise_m=5.0):
    """Asymmetric transverse ridges (gentle stoss, steep lee) with some sinuosity."""
    yy, xx = _grid(n)
    theta = rng.uniform(0, np.pi) if angle is None else angle
    u = (xx - n / 2) * np.cos(theta) + (yy - n / 2) * np.sin(theta)
    v = -(xx - n / 2) * np.sin(theta) + (yy - n / 2) * np.cos(theta)
    lam = rng.uniform(*wavelength_px)
    v_bent = v + rng.uniform(0.5, 2.0) * np.sin(2 * np.pi * u / rng.uniform(15, 40))
    phase = (v_bent / lam) % 1.0
    profile = np.where(phase < 0.75, phase / 0.75, (1.0 - phase) / 0.25)
    return rng.uniform(*height_m) * profile + fractal(rng, n, 3.2) * noise_m


def massif(rng, n=64, height_m=(1500, 4500), sigma_px=(9, 16), ridge_m=(150, 600)):
    """A mountain block with ridged flanks."""
    yy, xx = _grid(n)
    cy, cx = n / 2 + rng.normal(0, 4, 2)
    sigma = rng.uniform(*sigma_px)
    dome = rng.uniform(*height_m) * np.exp(-0.5 * (((yy - cy) / sigma) ** 2 + ((xx - cx) / (sigma * rng.uniform(0.7, 1.4))) ** 2))
    ridges = (1 - np.abs(fractal(rng, n, 2.8))) * rng.uniform(*ridge_m)
    return dome + ridges * (dome / dome.max() + 0.2)


def hills(rng, n=64, relief_m=(100, 600)):
    return fractal(rng, n, rng.uniform(2.9, 3.6)) * rng.uniform(*relief_m) / 3.0


def plain(rng, n=64, relief_m=(4, 20), pits=0, res_m=463.0):
    yy, xx = _grid(n)
    z = fractal(rng, n, 3.4) * rng.uniform(*relief_m) + (xx * rng.normal(0, 0.3) + yy * rng.normal(0, 0.3))
    for _ in range(pits):
        rr = rng.uniform(1.0, 2.5)
        sy, sx = rng.uniform(0, n, 2)
        z += _crater(np.hypot(yy - sy, xx - sx), rr, 0.15 * 2 * rr * res_m, 0.02 * 2 * rr * res_m)
    return z


def cone_field(rng, n=64, height_m=(80, 300)):
    """Volcanic cones with summit craters (cinder-cone fields)."""
    yy, xx = _grid(n)
    z = fractal(rng, n, 3.3) * 15
    for _ in range(rng.integers(5, 14)):
        cy, cx = rng.uniform(0, n, 2)
        r = np.hypot(yy - cy, xx - cx)
        radius = rng.uniform(2.0, 5.0)
        h = rng.uniform(*height_m)
        cone = h * np.clip(1 - r / radius, 0, 1)
        pit = 0.35 * h * np.clip(1 - r / (0.35 * radius), 0, 1)
        z += cone - pit
    return z


GENERATORS = {
    "crater": crater_field,
    "yardang": yardang_field,
    "dune": dune_field,
    "massif": massif,
    "hills": hills,
    "plain": plain,
    "cone_field": cone_field,
}
