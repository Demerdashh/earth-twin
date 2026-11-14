import math

import pytest

from pipeline.contract.ranking import Candidate, distance, rank_candidates

SCALES = {"elevation_m": 1000.0, "slope_deg": 5.0, "roughness": 25.0, "temp_range_k": 25.0, "mineral_index": 0.2, "ice_indicator": 0.2}
W = {"elevation_m": 0.0, "slope_deg": 1.0, "roughness": 1.0, "temp_range_k": 1.0, "mineral_index": 1.0, "ice_indicator": 0.5}
T = {"elevation_m": 0.0, "slope_deg": 10.0, "roughness": 50.0, "temp_range_k": 80.0, "mineral_index": 0.5, "ice_indicator": 0.1}


def test_identical_features_have_zero_distance() -> None:
    d, parts = distance(T, T, W, SCALES)
    assert d == 0.0
    assert set(parts) == {"slope_deg", "roughness", "temp_range_k", "mineral_index", "ice_indicator"}


def test_distance_uses_absolute_physical_units() -> None:
    c = {**T, "slope_deg": 15.0}  # 5 deg off = exactly one scale unit
    d, parts = distance(T, c, W, SCALES)
    assert d == pytest.approx(math.sqrt(1.0 / 4.5))
    assert parts["slope_deg"] == pytest.approx(1.0)


def test_null_and_zero_weight_features_are_skipped() -> None:
    c = {**T, "temp_range_k": None, "elevation_m": 99999.0}
    d, parts = distance(T, c, W, SCALES)
    assert d == 0.0 and "temp_range_k" not in parts and "elevation_m" not in parts


def test_no_comparable_feature_gives_infinite_distance() -> None:
    d, _ = distance(T, {}, W, SCALES)
    assert math.isinf(d)


def test_vegetation_filter_excludes_and_ranks_last() -> None:
    cands = [Candidate("green", {**T, "ndvi": 0.8}), Candidate("far", {**T, "slope_deg": 30.0, "ndvi": 0.0}), Candidate("near", {**T, "ndvi": 0.1})]
    ranked = rank_candidates(T, cands, W, SCALES, ndvi_threshold=0.3)
    assert [r.id for r in ranked] == ["near", "far", "green"]
    assert [r.rank for r in ranked] == [1, 2, None]
    assert ranked[2].excluded_by_vegetation


def test_weights_change_the_ranking() -> None:
    a = Candidate("a", {**T, "slope_deg": 20.0})        # bad slope, good thermal
    b = Candidate("b", {**T, "temp_range_k": 130.0})    # good slope, bad thermal
    slope_heavy = {**W, "slope_deg": 5.0, "temp_range_k": 0.1}
    thermal_heavy = {**W, "slope_deg": 0.1, "temp_range_k": 5.0}
    assert rank_candidates(T, [a, b], slope_heavy, SCALES, 0.3)[0].id == "b"
    assert rank_candidates(T, [a, b], thermal_heavy, SCALES, 0.3)[0].id == "a"


def test_ties_are_broken_by_id() -> None:
    ranked = rank_candidates(T, [Candidate("z", T), Candidate("a", T)], W, SCALES, 0.3)
    assert [r.id for r in ranked] == ["a", "z"]
