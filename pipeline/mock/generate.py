"""Generate the MOCK data set in public/data/mock/ from pipeline/mock/sites.toml.

Usage:  python -m pipeline.mock.generate [--out DIR]

Every file written has "mock": true and a note on how it was generated. Output is deterministic
(fixed seed, fixed generated_at) and is validated against the contract before the command exits.
This is NOT the model and NOT the real pipeline: it exists so the UI can be built and tested
against the contract until the real output is ready.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tomllib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..contract import COMPARABLE_FEATURES, EARTH_FEATURES, REPO_ROOT, SCHEMA_VERSION
from ..contract.colormaps import sample
from ..contract.geo import haversine_km
from ..contract.ranking import Candidate, distance, rank_candidates
from ..contract.schemas import schema_errors
from ..validate_contract import validate_dir
from ..validation import build_report

HERE = Path(__file__).resolve().parent
SPEC = HERE / "sites.toml"
KNOWN = REPO_ROOT / "pipeline" / "config" / "known_analogs.toml"
SOURCES = REPO_ROOT / "pipeline" / "config" / "sources.json"
DEFAULT_OUT = REPO_ROOT / "public" / "data" / "mock"
GENERATOR = "pipeline/mock/generate.py"

# Valid ranges per feature (contract), used to clip perturbed grid values.
RANGES: dict[str, tuple[float, float]] = {
    "elevation_m": (-500.0, 9000.0),
    "slope_deg": (0.0, 60.0),
    "roughness": (0.0, 500.0),
    "temp_range_k": (0.0, 400.0),
    "mineral_index": (0.0, 1.0),
    "ice_indicator": (0.0, 1.0),
    "ndvi": (-0.2, 0.95),
}
PLANET_ELEVATION_RANGE = (-12000.0, 30000.0)
DECIMALS = {"elevation_m": 0, "slope_deg": 1, "roughness": 0, "temp_range_k": 0, "mineral_index": 2, "ice_indicator": 2, "ndvi": 2}

# Which planned real dataset each mock feature stands in for (ids from src/config/sources.ts).
STAND_IN = {
    "earth": {"elevation_m": "earth_copernicus_dem", "slope_deg": "earth_copernicus_dem", "roughness": "earth_copernicus_dem",
              "temp_range_k": "earth_modis_lst", "mineral_index": "earth_sentinel2", "ice_indicator": "earth_jrc_water", "ndvi": "earth_modis_ndvi"},
    "moon": {"elevation_m": "moon_lola_dem", "slope_deg": "moon_lola_dem", "roughness": "moon_lola_dem",
             "temp_range_k": "moon_diviner", "mineral_index": "moon_m3", "ice_indicator": "moon_lpns"},
    "mars": {"elevation_m": "mars_mola_dem", "slope_deg": "mars_mola_dem", "roughness": "mars_mola_dem",
             "temp_range_k": "mars_themis", "mineral_index": "mars_crism", "ice_indicator": "mars_ice"},
}


def mock_id(dataset_id: str) -> str:
    return f"mock_{dataset_id}"


@dataclass(frozen=True)
class Header:
    generated_at: str
    note: str

    def __call__(self, extra_note: str = "") -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "mock": True,
            "note": f"{self.note} {extra_note}".strip(),
            "generated_at": self.generated_at,
            "generator": GENERATOR,
        }


def _features(values: list[float], names: tuple[str, ...]) -> dict[str, float | None]:
    if len(values) != len(names):
        raise ValueError(f"expected {len(names)} feature values, got {len(values)}: {values}")
    return {n: round(float(v), DECIMALS[n]) for n, v in zip(names, values)}


def _round(name: str, v: float) -> float:
    r = round(v, DECIMALS[name])
    return float(r)


# ----------------------------------------------------------------------- grids

class Waves:
    """Smooth deterministic perturbation fields, one per feature (seeded)."""

    def __init__(self, seed: int) -> None:
        rng = np.random.default_rng(seed)
        self.params = {n: rng.uniform(0, 2 * math.pi, size=4) for n in EARTH_FEATURES}
        self.freq = {n: rng.uniform(4.0, 9.0, size=2) for n in EARTH_FEATURES}

    def __call__(self, name: str, lat: float, lon: float) -> float:
        p, f = self.params[name], self.freq[name]
        la, lo = math.radians(lat), math.radians(lon)
        return 0.6 * math.sin(f[0] * la + p[0]) * math.cos(f[1] * lo + p[1]) + 0.4 * math.sin(f[1] * lo + f[0] * la + p[2])


def _cell_center(row: int, col: int, step: float) -> tuple[float, float]:
    return -90 + (row + 0.5) * step, -180 + (col + 0.5) * step


def _cells_near(lat: float, lon: float, radius_km: float, step: float, body: str) -> list[tuple[int, int]]:
    nrows, ncols = round(180 / step), round(360 / step)
    out = []
    for row in range(nrows):
        clat, _ = _cell_center(row, 0, step)
        # quick reject on latitude band
        if haversine_km(lat, lon, clat, lon, body) > radius_km:
            continue
        for col in range(ncols):
            clat, clon = _cell_center(row, col, step)
            if haversine_km(lat, lon, clat, clon, body) <= radius_km:
                out.append((row, col))
    return out


def build_grid(
    body: str,
    sites: list[tuple[float, float, dict[str, float | None]]],
    columns: tuple[str, ...],
    step: float,
    radius_km: float,
    scales: dict[str, float],
    waves: Waves,
    extra_cells: dict[tuple[int, int], dict[str, float | None]] | None = None,
) -> dict[tuple[int, int], dict[str, float | None]]:
    """Features around each site: site value at the centre, smoothly perturbed with distance."""
    grid: dict[tuple[int, int], dict[str, float | None]] = dict(extra_cells or {})
    amp = {**scales, "ndvi": 0.12}
    for lat, lon, feats in sites:
        for row, col in _cells_near(lat, lon, radius_km, step, body):
            clat, clon = _cell_center(row, col, step)
            frac = min(1.0, haversine_km(lat, lon, clat, clon, body) / radius_km)
            prev = grid.get((row, col))
            prev_frac = prev.get("_frac") if prev is not None else None
            if prev_frac is not None and prev_frac <= frac:  # keep the closest site's values
                continue
            cell: dict[str, float | None] = {"_frac": frac}
            for n in columns:
                v = feats.get(n)
                if v is None:
                    cell[n] = None
                    continue
                lo, hi = PLANET_ELEVATION_RANGE if (n == "elevation_m" and body != "earth") else RANGES[n]
                pert = frac * 1.2 * amp[n] * waves(n, clat, clon)
                cell[n] = _round(n, min(hi, max(lo, float(v) + pert)))
            grid[(row, col)] = cell
    return grid


def grid_doc(header: Header, body: str, grid: dict[tuple[int, int], dict[str, float | None]], columns: tuple[str, ...], step: float, extra_note: str) -> dict[str, Any]:
    cells = [[row, col, *[grid[(row, col)].get(n) for n in columns]] for row, col in sorted(grid)]
    return {
        **header(extra_note),
        "body": body,
        "step_deg": step,
        "columns": list(columns),
        "cells": cells,
        "provenance": {n: mock_id(STAND_IN[body][n]) for n in columns},
    }


def raster(grid: dict[tuple[int, int], dict[str, float | None]], step: float, value_fn: Any, ramp: str) -> Image.Image:
    nrows, ncols = round(180 / step), round(360 / step)
    img = np.zeros((nrows, ncols, 4), dtype=np.uint8)
    for (row, col), cell in grid.items():
        v = value_fn(cell)
        if v is None:
            continue
        img[nrows - 1 - row, col] = sample(ramp, v)  # row 0 of the image = north
    return Image.fromarray(img)  # (H, W, 4) uint8 -> RGBA


def save_png(img: Image.Image, path: Path) -> None:
    img.save(path, format="PNG", optimize=True)


# ---------------------------------------------------------------------- main

def generate(out: Path) -> list[str]:
    spec = tomllib.loads(SPEC.read_text(encoding="utf-8"))
    known_spec = tomllib.loads(KNOWN.read_text(encoding="utf-8"))
    if not SOURCES.is_file():
        raise SystemExit(f"{SOURCES} not found. Run `npm run export:sources` first (it is generated from src/config/sources.ts).")
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))

    s = spec["settings"]
    gen_at: datetime = s["generated_at"]
    generated_at = gen_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    config_sha = hashlib.sha256(SPEC.read_bytes() + KNOWN.read_bytes() + SOURCES.read_bytes()).hexdigest()
    header = Header(
        generated_at,
        "MOCK DATA — not measurements. Generated by pipeline/mock/generate.py from hand-chosen, "
        "physically plausible values in pipeline/mock/sites.toml (seed %d)." % s["seed"],
    )
    scales: dict[str, float] = dict(s["feature_scales"])
    weights: dict[str, float] = dict(s["default_weights"])
    threshold: float = s["ndvi_threshold"]
    waves = Waves(s["seed"])
    out.mkdir(parents=True, exist_ok=True)
    written: list[str] = []

    def write_json(name: str, doc: dict[str, Any]) -> None:
        (out / name).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        written.append(name)

    # --- known analogs (reference list; flagged mock because it belongs to the mock set)
    known_doc = {
        **header("Analog list copied from pipeline/config/known_analogs.toml; coordinates unverified."),
        "analogs": [
            {k: a[k] for k in ("id", "name", "lat", "lon", "analog_for", "coords_verified", "note")}
            for a in known_spec["analog"]
        ],
    }
    write_json("known_analogs.json", known_doc)

    # --- targets
    targets = []
    for t in spec["target"]:
        feats = _features(t["f"], COMPARABLE_FEATURES)
        targets.append({
            "id": t["id"], "name": t["name"], "body": t["body"], "lat": t["lat"], "lon": t["lon"],
            "radius_km": t["radius_km"], "description": t["description"], "coords_verified": False,
            "features": feats,
            "provenance": {n: mock_id(STAND_IN[t["body"]][n]) for n in COMPARABLE_FEATURES},
        })
    targets_doc = {**header("Fingerprints are mock values, not means of real rasters."), "targets": targets}
    write_json("targets.json", targets_doc)

    # --- candidates
    candidates = []
    for c in spec["candidate"]:
        candidates.append({
            "id": c["id"], "name": c["name"], "lat": c["lat"], "lon": c["lon"], "region": c["region"],
            "country": c["country"] or None, "known_analog_id": c["known"] or None, "coords_verified": False,
            "features": _features(c["f"], EARTH_FEATURES),
            "provenance": {n: mock_id(STAND_IN["earth"][n]) for n in EARTH_FEATURES},
        })
    pool = [c["id"] for c in candidates]
    cands_doc = {
        **header("Every candidate is in every target's pool (real output keeps the top 200-300)."),
        "feature_scales": scales, "default_weights": weights, "ndvi_threshold": threshold,
        "candidates": candidates, "per_target": {t["id"]: pool for t in targets},
    }
    write_json("earth_candidates.json", cands_doc)

    # --- analogs_<target>.geojson
    by_id = {c["id"]: c for c in candidates}
    manifest_analogs = {}
    for t in targets:
        ranked = rank_candidates(t["features"], [Candidate(c["id"], c["features"]) for c in candidates], weights, scales, threshold)
        geo_features: list[dict[str, Any]] = []
        for r in ranked:
            c = by_id[r.id]
            geo_features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
                "properties": {
                    "candidate_id": c["id"], "name": c["name"], "rank": r.rank,
                    "score": round(r.score, 6), "distance": round(r.distance, 6),
                    "known_analog_id": c["known_analog_id"], "excluded_by_vegetation": r.excluded_by_vegetation,
                },
            })
        name = f"analogs_{t['id']}.geojson"
        write_json(name, {**header("Ranked with the contract ranking at default weights."), "type": "FeatureCollection",
                          "target_id": t["id"], "weights": weights, "features": geo_features})
        manifest_analogs[t["id"]] = name

    # --- grids
    estep, pstep = s["earth_grid_step_deg"], s["planet_grid_step_deg"]
    earth_grid = build_grid("earth", [(c["lat"], c["lon"], c["features"]) for c in candidates], EARTH_FEATURES, estep, s["earth_grid_radius_km"], scales, waves)
    planet_grids: dict[str, dict[tuple[int, int], dict[str, float | None]]] = {}
    for body in ("moon", "mars"):
        # Mock polar ice indicator caps (illustrative only), then target neighbourhoods on top.
        caps: dict[tuple[int, int], dict[str, float | None]] = {}
        cap_lat = 80.0 if body == "moon" else 76.0
        nrows, ncols = round(180 / pstep), round(360 / pstep)
        for row in range(nrows):
            clat, _ = _cell_center(row, 0, pstep)
            if abs(clat) < cap_lat:
                continue
            for col in range(ncols):
                _, clon = _cell_center(row, col, pstep)
                ice = (abs(clat) - cap_lat) / (90 - cap_lat) * 0.7 + 0.15 * (1 + waves("ice_indicator", clat, clon)) / 2
                cap_cell: dict[str, float | None] = {n: None for n in COMPARABLE_FEATURES}
                cap_cell["ice_indicator"] = _round("ice_indicator", min(1.0, max(0.0, ice)))
                cap_cell["_frac"] = 3.0
                caps[(row, col)] = cap_cell
        sites = [(t["lat"], t["lon"], t["features"]) for t in targets if t["body"] == body]
        planet_grids[body] = build_grid(body, sites, COMPARABLE_FEATURES, pstep, s["planet_grid_radius_km"], scales, waves, caps)

    grid_note = "Mock cells exist only near candidates/targets (and mock polar ice caps on Moon/Mars); everything else is 'no data'."
    write_json("grid_earth.json", grid_doc(header, "earth", earth_grid, EARTH_FEATURES, estep, grid_note))
    for body, g in planet_grids.items():
        write_json(f"grid_{body}.json", grid_doc(header, body, g, COMPARABLE_FEATURES, pstep, grid_note))

    # --- overlays
    world = {"west": -180, "south": -90, "east": 180, "north": 90}
    overlays: list[dict[str, Any]] = []

    def add_overlay(oid: str, kind: str, body: str, target_id: str | None, img: Image.Image, vmin: float, vmax: float, units: str, label: str, colormap: str, prov: list[str]) -> None:
        fname = f"{oid}.png"
        save_png(img, out / fname)
        written.append(fname)
        overlays.append({"id": oid, "kind": kind, "body": body, "target_id": target_id, "file": fname, "bounds": world,
                         "width": img.width, "height": img.height, "value_min": vmin, "value_max": vmax,
                         "units": units, "label": label, "colormap": colormap, "provenance_ids": prov})

    earth_prov = sorted({mock_id(v) for v in STAND_IN["earth"].values()})
    for t in targets:
        def sim(cell: dict[str, float | None], t: dict[str, Any] = t) -> float | None:
            ndvi = cell.get("ndvi")
            if ndvi is not None and ndvi > threshold:
                return None
            d, _ = distance(t["features"], cell, weights, scales)
            return None if math.isinf(d) else math.exp(-d)
        add_overlay(f"similarity_{t['id']}", "similarity", "earth", t["id"], raster(earth_grid, estep, sim, "similarity"),
                    0, 1, "score exp(-d)", f"Similarity to {t['name']} (mock)", "similarity", earth_prov)

    def veg(cell: dict[str, float | None]) -> float | None:
        v = cell.get("ndvi")
        return 1.0 if v is not None and v > threshold else None

    add_overlay("vegetation_earth", "vegetation", "earth", None, raster(earth_grid, estep, veg, "vegetation_exclusion"),
                0, 1, "excluded (NDVI > threshold)", "Vegetation exclusion lens (mock)", "vegetation_exclusion", [mock_id("earth_modis_ndvi")])
    for body, g, step in (("earth", earth_grid, estep), ("moon", planet_grids["moon"], pstep), ("mars", planet_grids["mars"], pstep)):
        add_overlay(f"water_ice_{body}", "water_ice", body, None, raster(g, step, lambda c: c.get("ice_indicator"), "water_ice"),
                    0, 1, "indicator 0-1", f"Water / ice indicator — {body} (mock)", "water_ice", [mock_id(STAND_IN[body]["ice_indicator"])])

    # --- provenance
    datasets: list[dict[str, Any]] = []
    for ref in sources["datasets"]:
        datasets.append({
            "id": mock_id(ref["id"]), "body": ref["body"],
            "source": "pipeline/mock/generate.py (mock stand-in)",
            "product": f"MOCK stand-in for {ref['product']} — no real data used",
            "resolution": f"{estep if ref['body'] == 'earth' else pstep} deg mock grid",
            "date": generated_at[:10],
            "processing_steps": ["hand-chosen site values (pipeline/mock/sites.toml)", "smooth deterministic perturbation with distance", "rounded to contract precision"],
            "url": None, "verified": False, "mock": True,
        })
    for tile in sources["tiles"]:
        datasets.append({
            "id": tile["id"], "body": tile["body"], "source": tile["provider"], "product": tile["product"],
            "resolution": tile["resolution"], "date": tile["verification"]["checkedOn"] or "unknown",
            "processing_steps": ["display imagery only — not used in any computation"],
            "url": tile["capabilitiesUrl"], "verified": tile["verification"]["status"] == "verified", "mock": False,
        })

    # --- validation report
    report = build_report(targets_doc, cands_doc, known_doc, generated_at=generated_at, generator=GENERATOR)
    write_json("validation_report.json", report)

    outputs = sorted(written + ["provenance.json", "manifest.json"])
    write_json("provenance.json", {
        **header("Dataset records with mock=true are stand-ins; imagery records (mock=false) are the real display tiles."),
        "datasets": datasets,
        "runs": [{"run_id": f"mock-{config_sha[:12]}", "mode": "mock", "started_at": generated_at,
                  "config_sha256": config_sha, "seed": s["seed"], "outputs": outputs}],
    })

    manifest = {
        **header("Entry point of the mock data set."),
        "files": {"targets": "targets.json", "earth_candidates": "earth_candidates.json", "provenance": "provenance.json",
                  "known_analogs": "known_analogs.json", "validation_report": "validation_report.json"},
        "analogs": manifest_analogs,
        "grids": {"earth": "grid_earth.json", "moon": "grid_moon.json", "mars": "grid_mars.json"},
        "overlays": overlays,
    }
    errs = schema_errors("manifest", manifest)
    if errs:
        raise SystemExit("manifest does not match schema:\n" + "\n".join(errs))
    write_json("manifest.json", manifest)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)
    out = Path(args.out).resolve()
    written = generate(out)
    errors = validate_dir(out)
    if errors:
        print("Generated mock set is INVALID:\n  " + "\n  ".join(errors))
        return 1
    print(f"Wrote {len(written)} mock files to {out} — contract OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
