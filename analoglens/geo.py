"""Geometry helpers: planetary radii, metric tile grids, and raster sampling.

Every tile in AnalogLens is a square grid with a fixed number of metres per pixel, centred
on a point, on any of the three bodies. That shared metric grid is what lets a vision model
compare a lunar crater rim with an Egyptian depression at the same scale.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

# Mean radii in metres (IAU / standard reference values).
RADIUS_M = {"earth": 6_371_000.0, "moon": 1_737_400.0, "mars": 3_389_500.0}


def haversine_km(lat1, lon1, lat2, lon2, body: str = "earth"):
    """Great-circle distance in km between points given in degrees (arrays broadcast)."""
    r = RADIUS_M[body] / 1000.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlmb = np.radians(np.asarray(lon2, dtype=float) - np.asarray(lon1, dtype=float))
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def local_grid_latlon(lat0: float, lon0: float, size_px: int, res_m: float, body: str = "earth"):
    """Latitude/longitude (degrees) of a size_px x size_px grid centred on (lat0, lon0).

    North is up, columns run east. Uses the inverse azimuthal equidistant projection on a
    sphere, so pixels are res_m apart everywhere, including at the poles (the lunar south
    pole targets need this). Returns (lat, lon) arrays with lon in [-180, 180).
    """
    radius = RADIUS_M[body]
    half = (size_px - 1) / 2.0
    x = (np.arange(size_px) - half) * res_m
    y = (half - np.arange(size_px)) * res_m
    xx, yy = np.meshgrid(x, y)
    rho = np.hypot(xx, yy)
    c = rho / radius
    phi0, lam0 = math.radians(lat0), math.radians(lon0)
    sin_c, cos_c = np.sin(c), np.cos(c)
    safe = np.where(rho == 0, 1.0, rho)
    lat = np.arcsin(np.clip(cos_c * math.sin(phi0) + yy * sin_c * math.cos(phi0) / safe, -1.0, 1.0))
    lon = lam0 + np.arctan2(xx * sin_c, safe * math.cos(phi0) * cos_c - yy * math.sin(phi0) * sin_c)
    lat = np.where(rho == 0, phi0, lat)
    lon = np.where(rho == 0, lam0, lon)
    return np.degrees(lat), (np.degrees(lon) + 180.0) % 360.0 - 180.0


def _bilinear(data: np.ndarray, row: np.ndarray, col: np.ndarray, wrap_cols: bool = False):
    """Bilinear interpolation at fractional (row, col) pixel-centre coordinates. NaN outside."""
    h, w = data.shape
    r0 = np.floor(row).astype(int)
    c0 = np.floor(col).astype(int)
    fr, fc = row - r0, col - c0
    r0c, r1c = np.clip(r0, 0, h - 1), np.clip(r0 + 1, 0, h - 1)
    if wrap_cols:
        c0c, c1c = c0 % w, (c0 + 1) % w
    else:
        c0c, c1c = np.clip(c0, 0, w - 1), np.clip(c0 + 1, 0, w - 1)
    v = (data[r0c, c0c] * (1 - fr) * (1 - fc) + data[r0c, c1c] * (1 - fr) * fc
         + data[r1c, c0c] * fr * (1 - fc) + data[r1c, c1c] * fr * fc)
    outside = (row < -0.5) | (row > h - 0.5)
    if not wrap_cols:
        outside |= (col < -0.5) | (col > w - 0.5)
    return np.where(outside, np.nan, v)


class GlobalRaster:
    """A north-up latitude/longitude grid (equirectangular), e.g. ETOPO, MOLA MEGDR, LOLA LDEM.

    data[0, 0] is the north-west pixel; lat_top and lon_left are the outer edges of that
    pixel; deg_per_px is the pixel size. Longitudes may be 0..360 (MOLA, LOLA) or
    -180..180 (ETOPO): sampling handles both. Grids spanning 360 degrees wrap around.
    """

    def __init__(self, data, lat_top=90.0, lon_left=-180.0, deg_per_px=1.0, nodata=None):
        arr = np.asarray(data, dtype=np.float32)
        if nodata is not None:
            arr = np.where(arr == nodata, np.nan, arr)
        self.data = arr
        self.lat_top, self.lon_left, self.deg_per_px = float(lat_top), float(lon_left), float(deg_per_px)
        self.wraps = abs(arr.shape[1] * self.deg_per_px - 360.0) < 1e-6

    def sample(self, lat, lon):
        lat = np.asarray(lat, dtype=float)
        lon = np.asarray(lon, dtype=float)
        row = (self.lat_top - lat) / self.deg_per_px - 0.5
        col = ((lon - self.lon_left) % 360.0) / self.deg_per_px - 0.5
        return _bilinear(self.data, row, col, wrap_cols=self.wraps)

    def tile(self, lat0, lon0, size_px=64, res_m=463.0, body="earth"):
        """A metric tile (metres of elevation) centred on (lat0, lon0)."""
        lat, lon = local_grid_latlon(lat0, lon0, size_px, res_m, body)
        return self.sample(lat, lon)

    @classmethod
    def from_geotiff(cls, path, band=1, body=None):
        """Load a north-up equirectangular raster with rasterio (GeoTIFF, or a PDS .IMG/.LBL
        that GDAL reads, such as MOLA MEGDR or LOLA LDEM).

        Planetary products are often georeferenced in metres of simple cylindrical projection
        rather than degrees. Pass body="mars" or body="moon" and pixel sizes larger than one
        unit are converted from metres to degrees (valid for a projection centred on the
        equator, which these global products use; check the label if unsure).
        """
        import rasterio  # optional dependency

        with rasterio.open(path) as src:
            t = src.transform
            if t.b != 0 or t.d != 0 or t.e >= 0 or abs(abs(t.a) - abs(t.e)) > 1e-6 * max(abs(t.a), 1):
                raise ValueError(f"{path}: expected a north-up grid with square pixels")
            scale = 1.0
            if abs(t.a) > 1.0:  # georeferenced in metres
                if body is None:
                    raise ValueError(f"{path}: pixel size {t.a} looks like metres; pass body='mars' or 'moon'")
                scale = 1.0 / (RADIUS_M[body] * math.pi / 180.0)
            return cls(src.read(band), lat_top=t.f * scale, lon_left=t.c * scale,
                       deg_per_px=t.a * scale, nodata=src.nodata)


class MetricRaster:
    """A projected raster in metres, e.g. a polar stereographic LOLA south-pole DEM.

    x grows to the right (columns), y grows up (rows run down). x_left and y_top are the
    outer edges of the top-left pixel. window() block-averages before resampling when the
    output pixels are coarser than the source, so fine detail does not alias.
    """

    def __init__(self, data, x_left, y_top, res_m, nodata=None):
        arr = np.asarray(data, dtype=np.float32)
        if nodata is not None:
            arr = np.where(arr == nodata, np.nan, arr)
        self.data, self.x_left, self.y_top, self.res_m = arr, float(x_left), float(y_top), float(res_m)

    @classmethod
    def from_geotiff(cls, path, band=1):
        """Load a projected raster in metres (e.g. a LOLA polar stereographic GeoTIFF)."""
        import rasterio  # optional dependency

        with rasterio.open(path) as src:
            t = src.transform
            if t.b != 0 or t.d != 0 or t.e >= 0:
                raise ValueError(f"{path}: expected a north-up projected grid")
            return cls(src.read(band), x_left=t.c, y_top=t.f, res_m=t.a, nodata=src.nodata)

    def window(self, cx, cy, size_px=64, out_res_m=463.0):
        half_extent = (size_px / 2.0 + 2) * out_res_m
        h, w = self.data.shape
        c_lo = max(int((cx - half_extent - self.x_left) / self.res_m), 0)
        c_hi = min(int((cx + half_extent - self.x_left) / self.res_m) + 1, w)
        r_lo = max(int((self.y_top - (cy + half_extent)) / self.res_m), 0)
        r_hi = min(int((self.y_top - (cy - half_extent)) / self.res_m) + 1, h)
        if c_hi <= c_lo or r_hi <= r_lo:
            return np.full((size_px, size_px), np.nan, dtype=np.float32)
        crop = self.data[r_lo:r_hi, c_lo:c_hi]
        k = int(round(out_res_m / self.res_m))
        if k > 1:  # anti-alias: NaN-aware average over k x k source pixels
            valid = np.isfinite(crop)
            num = ndimage.uniform_filter(np.where(valid, crop, 0.0), size=k, mode="nearest")
            den = ndimage.uniform_filter(valid.astype(np.float32), size=k, mode="nearest")
            crop = np.where(den > 0.5, num / np.maximum(den, 1e-6), np.nan)
        half = (size_px - 1) / 2.0
        xs = cx + (np.arange(size_px) - half) * out_res_m
        ys = cy + (half - np.arange(size_px)) * out_res_m
        xx, yy = np.meshgrid(xs, ys)
        col = (xx - self.x_left) / self.res_m - 0.5 - c_lo
        row = (self.y_top - yy) / self.res_m - 0.5 - r_lo
        return _bilinear(crop, row, col)


def polar_stereo_xy(lat, lon, body="moon", pole="south", lon0=0.0):
    """Spherical polar stereographic coordinates in metres, true scale at the pole (Snyder).

    WARNING: products differ in axis direction and central meridian. Before trusting this
    with a real DEM, sample a known feature (Shackleton's centre is 89.67 S, 129.78 E per
    the USGS Gazetteer) and check that the crater lands in the middle of your tile.
    """
    radius = RADIUS_M[body]
    phi = np.radians(np.asarray(lat, dtype=float))
    lam = np.radians(np.asarray(lon, dtype=float) - lon0)
    if pole == "south":
        k = 2 * radius * np.tan(np.pi / 4 + phi / 2)
        return k * np.sin(lam), k * np.cos(lam)
    k = 2 * radius * np.tan(np.pi / 4 - phi / 2)
    return k * np.sin(lam), -k * np.cos(lam)
