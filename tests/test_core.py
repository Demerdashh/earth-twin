"""Core checks. Run with `python -m pytest tests` or simply `python tests/test_core.py`."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analoglens import synthetic as S  # noqa: E402
from analoglens.cards import build_card  # noqa: E402
from analoglens.geo import GlobalRaster, MetricRaster, haversine_km, local_grid_latlon, polar_stereo_xy  # noqa: E402
from analoglens.scoring import combine, dimension_scores  # noqa: E402
from analoglens.terrain import anisotropy, describe, hillshade  # noqa: E402
from analoglens.validate import roc_auc  # noqa: E402


def test_tiles_are_metric_everywhere_including_the_poles():
    for body, lat0, lon0 in [("earth", 0, 0), ("earth", 70, 30), ("moon", -89.67, 129.78), ("mars", 11, -159)]:
        lat, lon = local_grid_latlon(lat0, lon0, 32, 463.0, body)
        dx = haversine_km(lat[:, :-1], lon[:, :-1], lat[:, 1:], lon[:, 1:], body) * 1000
        dy = haversine_km(lat[:-1], lon[:-1], lat[1:], lon[1:], body) * 1000
        assert np.allclose(dx, 463.0, atol=0.5) and np.allclose(dy, 463.0, atol=0.5), body


def test_global_raster_handles_both_longitude_conventions_and_regions():
    lats = np.arange(89.5, -90, -1.0)
    lons = np.arange(-179.5, 180, 1.0)
    field = lats[:, None] + lons[None, :] / 1000.0
    g = GlobalRaster(field, 90, -180, 1.0)
    assert abs(g.sample(np.array([10.0]), np.array([20.0]))[0] - 10.02) < 1e-6
    g360 = GlobalRaster(np.roll(field, -180, axis=1), 90, 0, 1.0)  # 0..360 grid like MOLA
    assert abs(g360.sample(np.array([10.0]), np.array([-160.0]))[0] - 9.84) < 1e-6
    region = GlobalRaster(field[60:80, 200:230], lat_top=30, lon_left=20, deg_per_px=1.0)
    out = region.sample(np.array([25.0, 25.0]), np.array([30.0, 100.0]))
    assert abs(out[0] - 25.03) < 1e-6 and np.isnan(out[1])


def test_polar_window_centres_the_requested_feature():
    res, half = 60.0, 30000
    xs = np.arange(-half, half, res) + res / 2
    xx, yy = np.meshgrid(xs, xs[::-1])
    cx, cy = polar_stereo_xy(-89.67, 129.78, "moon", "south")
    dem = np.hypot(xx - cx, yy - cy)  # a cone pointing down at the target
    tile = MetricRaster(dem, -half, half, res).window(float(cx), float(cy), 64, 300.0)
    r, c = np.unravel_index(np.nanargmin(tile), tile.shape)
    assert abs(r - 31.5) <= 1 and abs(c - 31.5) <= 1


def test_terrain_features_tell_linear_from_round():
    rng = np.random.default_rng(3)
    assert anisotropy(S.yardang_field(rng)) > 0.4
    assert anisotropy(S.dune_field(rng)) > 0.6
    assert anisotropy(S.crater_field(rng)) < 0.2
    crater = describe(S.crater_field(rng, radius_px=22.7, depth_ratio=0.2), 463.0)
    assert 3000 < crater["relief"] < 5500


def test_hillshade_lights_slopes_facing_the_sun():
    ramp = np.tile(np.arange(32) * 10.0, (32, 1))  # rises to the east, so it faces west
    assert hillshade(ramp, 463.0, azimuth_deg=270).mean() > hillshade(ramp, 463.0, azimuth_deg=90).mean()


DIMS = {
    "terrain_shape": {"label": "Terrain shape", "kind": "embedding"},
    "cold": {"label": "Cold", "feature": "lst_min_c", "unit": "°C", "sigma": 15.0, "earth_relative": True},
    "aridity": {"label": "Dryness", "feature": "ndvi_mean", "unit": "NDVI", "sigma": 0.08},
}


def test_unreachable_targets_are_scored_relative_and_never_shown_as_strong():
    feats = {"lst_min_c": np.array([-40.0, -10.0, 20.0]), "ndvi_mean": np.array([0.05, 0.1, 0.7])}
    scores, meta = dimension_scores(feats, {"lst_min_c": -203, "ndvi_mean": 0.0}, DIMS, np.array([0.9, 0.5, 0.2]))
    assert meta["cold"]["mode"] == "relative" and scores["cold"][0] == 1.0
    total, _ = combine(scores, {"terrain_shape": 0.4, "cold": 0.3, "aridity": 0.3})
    card = build_card(0, "E0", "t", {"profile": {"lst_min_c": -203, "ndvi_mean": 0.0}}, "task",
                      {"weights": {"terrain_shape": 0.4, "cold": 0.3, "aridity": 0.3}}, DIMS, scores, meta, feats,
                      total[0], [{"name": "Gravity", "text": "0.17 g"}])
    cold_bar = next(b for b in card["bars"] if b["dimension"] == "cold")
    assert cold_bar["status"] == "closest on Earth" and "Cold" not in card["strong_for"]
    assert any(b["kind"] == "unreachable" for b in card["breaks"]) and any(b["kind"] == "fixed" for b in card["breaks"])


def test_one_bad_dimension_drags_the_total_down_and_missing_data_is_not_a_match():
    scores = {"a": np.array([0.9, 0.9, 0.9]), "b": np.array([0.9, 0.01, np.nan])}
    total, coverage = combine(scores, {"a": 0.5, "b": 0.5})
    assert total[0] > 0.85 and total[1] < 0.2
    assert coverage[2] == 0.5 and total[2] < total[0]


def test_roc_auc():
    assert roc_auc(np.array([0.9, 0.8, 0.2, 0.1]), np.array([True, True, False, False])) == 1.0
    assert roc_auc(np.array([0.5, 0.5]), np.array([True, False])) == 0.5
    assert roc_auc(np.array([0.1, 0.2]), np.array([False, False])) is None


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} tests passed")
