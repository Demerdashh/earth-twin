"""Terrain features from a metric elevation tile (metres, north up, fixed metres per pixel).

Two families of outputs:

* describe(): physical measurements in real units (slope in degrees, roughness and relief in
  metres). These feed the slope, roughness, relief, and linearity bars on the card.
* relief_image() and shape_vector(): scale-free views of the landform's shape. The vision
  model sees relief_image(); the no-download fallback embedder uses shape_vector().
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

# Relief normalisation for shape views: after rescaling, a tile's standard deviation is
# NORM_REL x tile width, but never amplified from below MIN_REL x tile width, so a flat
# plain stays flat instead of having its noise blown up into fake hills.
NORM_REL = 0.04
MIN_REL = 0.004


def fill_nans(dem: np.ndarray) -> np.ndarray:
    """Replace missing pixels with the nearest valid value (float64 copy)."""
    dem = np.asarray(dem, dtype=np.float64)
    mask = ~np.isfinite(dem)
    if not mask.any():
        return dem
    if mask.all():
        return np.zeros_like(dem)
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    return dem[tuple(idx)]


def valid_fraction(dem: np.ndarray) -> float:
    return float(np.isfinite(dem).mean())


def gradients(dem: np.ndarray, res_m: float):
    """dz/dx (east) and dz/dy (north) in metres per metre. Rows run south, hence the sign flip."""
    g_row, g_col = np.gradient(dem, res_m)
    return g_col, -g_row


def slope_deg(dem: np.ndarray, res_m: float) -> np.ndarray:
    dzdx, dzdy = gradients(dem, res_m)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def hillshade(dem: np.ndarray, res_m: float, azimuth_deg: float = 315.0, altitude_deg: float = 45.0):
    """Lambertian shaded relief in [0, 1]; the sun's azimuth is measured clockwise from north."""
    dzdx, dzdy = gradients(dem, res_m)
    norm = np.sqrt(dzdx ** 2 + dzdy ** 2 + 1.0)
    az, alt = np.radians(azimuth_deg), np.radians(altitude_deg)
    light = (np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt))
    shade = (-dzdx * light[0] - dzdy * light[1] + light[2]) / norm
    return np.clip(shade, 0.0, 1.0)


def terrain_ruggedness(dem: np.ndarray) -> np.ndarray:
    """Mean absolute elevation difference to the 8 neighbours, in metres (a TRI variant)."""
    pad = np.pad(dem, 1, mode="edge")
    h, w = dem.shape
    diffs = [np.abs(pad[1 + dr:1 + dr + h, 1 + dc:1 + dc + w] - dem)
             for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr, dc) != (0, 0)]
    return np.mean(diffs, axis=0)


def detrend(dem: np.ndarray) -> np.ndarray:
    """Remove the best-fit plane so a regional tilt does not count as relief or texture."""
    h, w = dem.shape
    yy, xx = np.mgrid[0:h, 0:w]
    design = np.c_[xx.ravel(), yy.ravel(), np.ones(h * w)]
    coef, *_ = np.linalg.lstsq(design, dem.ravel(), rcond=None)
    return dem - (design @ coef).reshape(h, w)


def anisotropy(dem: np.ndarray) -> float:
    """0 = no preferred direction (craters, cones, rolling hills); 1 = perfectly linear
    texture (yardangs, dune ridges). Coherence of the gradient structure tensor."""
    d = ndimage.gaussian_filter(detrend(dem), 0.7)
    g_row, g_col = np.gradient(d)
    jxx, jyy, jxy = (g_col ** 2).sum(), (g_row ** 2).sum(), (g_col * g_row).sum()
    trace = jxx + jyy
    if trace <= 1e-12:
        return 0.0
    return float(np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / trace)


def spectral_slope(dem: np.ndarray) -> float:
    """Slope of the radially averaged power spectrum in log-log space. Natural terrain sits
    roughly between -2 and -4; shallower means more small-scale texture."""
    d = detrend(dem)
    h, w = d.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    power = np.abs(np.fft.fftshift(np.fft.fft2(d * window))) ** 2
    yy, xx = np.indices(power.shape)
    r = np.hypot(yy - h // 2, xx - w // 2).astype(int)
    radial = np.bincount(r.ravel(), power.ravel()) / np.maximum(np.bincount(r.ravel()), 1)
    k = np.arange(len(radial))
    sel = (k >= 2) & (k <= min(h, w) // 2 - 1) & (radial > 0)
    if sel.sum() < 3:
        return 0.0
    return float(np.polyfit(np.log(k[sel]), np.log(radial[sel]), 1)[0])


def describe(dem: np.ndarray, res_m: float) -> dict:
    """Physical terrain measurements in real units for one tile."""
    d = fill_nans(dem)
    s = slope_deg(d, res_m)
    tri = terrain_ruggedness(d)
    lo, hi = np.percentile(d, [2, 98])
    curvature = ndimage.laplace(ndimage.gaussian_filter(d, 1.0)) / res_m ** 2
    span = max(float(d.max() - d.min()), 1e-6)
    return {
        "slope_p10": float(np.percentile(s, 10)),
        "slope_p50": float(np.percentile(s, 50)),
        "slope_p90": float(np.percentile(s, 90)),
        "steep_frac": float((s > 15.0).mean()),
        "tri_mean": float(tri.mean()),
        "tri_p90": float(np.percentile(tri, 90)),
        "relief": float(hi - lo),
        "detrended_std": float(detrend(d).std()),
        "hypsometric": float((d.mean() - d.min()) / span),
        "curv_std": float(curvature.std()),
        "anisotropy": anisotropy(d),
        "spectral_slope": spectral_slope(d),
        "valid_frac": valid_fraction(dem),
    }


def normalise_relief(dem: np.ndarray, res_m: float) -> np.ndarray:
    """Detrend and rescale so landform shape survives but absolute height does not."""
    d = detrend(fill_nans(dem))
    width_m = dem.shape[1] * res_m
    std = max(float(d.std()), MIN_REL * width_m)
    return d / std * (NORM_REL * width_m)


def relief_image(dem: np.ndarray, res_m: float) -> np.ndarray:
    """uint8 image (H, W, 3) for the vision model.

    R = shaded relief under a fixed north-west sun, G = normalised elevation,
    B = slope. Rotation invariance comes from embedding several rotations of the
    tile (see embed.py), not from the image itself.
    """
    d = normalise_relief(dem, res_m)
    width_m = dem.shape[1] * res_m
    shade = hillshade(d, res_m)
    elev = np.clip(0.5 + d / (5.0 * NORM_REL * width_m), 0.0, 1.0)
    slope = np.clip(slope_deg(d, res_m) / 45.0, 0.0, 1.0)
    return (np.stack([shade, elev, slope], axis=-1) * 255).round().astype(np.uint8)


def _radial_autocorrelation(z: np.ndarray, n_lags: int = 12) -> np.ndarray:
    """Translation- and rotation-invariant summary of spacing (crater size, dune wavelength)."""
    h, w = z.shape
    f = np.fft.fft2(z - z.mean(), s=(2 * h, 2 * w))
    ac = np.real(np.fft.ifft2(f * np.conj(f)))
    ac = np.fft.fftshift(ac)
    cy, cx = h, w
    yy, xx = np.indices(ac.shape)
    r = np.hypot(yy - cy, xx - cx).astype(int)
    radial = np.bincount(r.ravel(), ac.ravel()) / np.maximum(np.bincount(r.ravel()), 1)
    radial = radial / (radial[0] + 1e-12)
    lags = np.unique(np.round(np.geomspace(1, min(h, w) // 2, n_lags)).astype(int))
    out = radial[lags]
    return np.pad(out, (0, n_lags - len(out)), constant_values=out[-1] if len(out) else 0.0)


def shape_vector(dem: np.ndarray, res_m: float) -> np.ndarray:
    """Scale-free, rotation-invariant shape descriptor (about 45 numbers) for the fallback
    embedder. Standardise across the corpus before comparing (the index does this)."""
    d = normalise_relief(dem, res_m)
    width_m = dem.shape[1] * res_m
    z = d / (NORM_REL * width_m)  # roughly unit standard deviation for hilly tiles
    s = slope_deg(d, res_m)
    slope_hist = np.histogram(s, bins=12, range=(0, 60))[0] / s.size
    elev_hist = np.histogram(np.clip(z, -3, 3), bins=8, range=(-3, 3))[0] / z.size
    log_energy = np.array([np.abs(ndimage.gaussian_laplace(z, sigma)).mean() * sigma ** 2
                           for sigma in (1, 2, 4, 8)])
    log_energy = log_energy / (log_energy.sum() + 1e-12)
    centred = z - z.mean()
    skew = float((centred ** 3).mean() / (centred.std() ** 3 + 1e-12))
    kurt = float((centred ** 4).mean() / (centred.std() ** 4 + 1e-12))
    lap = ndimage.laplace(ndimage.gaussian_filter(z, 1.0))
    convex_frac = float((lap < 0).mean())
    extras = np.array([anisotropy(d), spectral_slope(d) / 4.0, skew, np.log(kurt + 1e-6),
                       convex_frac, float(z.std())])
    return np.concatenate([slope_hist, elev_hist, log_energy, _radial_autocorrelation(z), extras]).astype(np.float32)
