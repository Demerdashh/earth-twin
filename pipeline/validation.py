"""Validation: where does each known analog land in each target's ranking?

Usage:
  python -m pipeline.validation [DATA_DIR] [--write]

Reads targets.json, earth_candidates.json and known_analogs.json from DATA_DIR (default
public/data/mock), ranks every target's pool at the default weights (contract ranking), matches
each known analog to a candidate (same known_analog_id, else nearest within --radius km) and prints
a table. With --write it also writes validation_report.json into DATA_DIR.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .contract import REPO_ROOT, SCHEMA_VERSION
from .contract.geo import haversine_km
from .contract.ranking import Candidate, rank_candidates
from .contract.schemas import schema_errors

DEFAULT_MATCH_RADIUS_KM = 50.0


def _match(analog: dict[str, Any], candidates: list[dict[str, Any]], radius_km: float) -> tuple[dict[str, Any] | None, float | None]:
    best: tuple[dict[str, Any] | None, float | None] = (None, None)
    for c in candidates:
        d = haversine_km(analog["lat"], analog["lon"], c["lat"], c["lon"], "earth")
        if c["known_analog_id"] == analog["id"]:
            return c, d
        if d <= radius_km and (best[1] is None or d < best[1]):
            best = (c, d)
    return best


def build_report(
    targets_doc: dict[str, Any],
    candidates_doc: dict[str, Any],
    known_doc: dict[str, Any],
    *,
    match_radius_km: float = DEFAULT_MATCH_RADIUS_KM,
    generated_at: str | None = None,
    generator: str = "pipeline/validation.py",
) -> dict[str, Any]:
    by_id = {c["id"]: c for c in candidates_doc["candidates"]}
    weights = candidates_doc["default_weights"]
    scales = candidates_doc["feature_scales"]
    threshold = candidates_doc["ndvi_threshold"]

    out: dict[str, Any] = {}
    for target in targets_doc["targets"]:
        pool_ids = candidates_doc["per_target"].get(target["id"], [])
        pool = [by_id[cid] for cid in pool_ids if cid in by_id]
        ranked = rank_candidates(
            target["features"], [Candidate(c["id"], c["features"]) for c in pool], weights, scales, threshold
        )
        rank_of = {r.id: r.rank for r in ranked}
        entries = []
        for analog in known_doc["analogs"]:
            match, dist = _match(analog, pool, match_radius_km)
            entries.append(
                {
                    "known_analog_id": analog["id"],
                    "name": analog["name"],
                    "rank": rank_of.get(match["id"]) if match else None,
                    "matched_candidate_id": match["id"] if match else None,
                    "match_distance_km": round(dist, 1) if dist is not None else None,
                }
            )
        out[target["id"]] = {"pool_size": len(pool), "entries": entries}

    mock = bool(candidates_doc["mock"] or targets_doc["mock"])
    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "mock": mock,
        "generated_at": generated_at or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": generator,
        "match_radius_km": match_radius_km,
        "targets": out,
    }
    if mock:
        report["note"] = (
            "Computed by pipeline/validation.py from MOCK candidate and target values; "
            "ranks illustrate the mechanism only and say nothing about real analog quality."
        )
    return report


def format_table(report: dict[str, Any], targets_doc: dict[str, Any]) -> str:
    names = {t["id"]: f"{t['name']} ({t['body']})" for t in targets_doc["targets"]}
    lines = []
    if report["mock"]:
        lines.append("!! MOCK DATA — ranks below demonstrate the mechanism, not real results !!\n")
    for tid, block in report["targets"].items():
        lines.append(f"## {names.get(tid, tid)} — pool of {block['pool_size']}")
        lines.append(f"{'known analog':<52} {'rank':>5}  matched candidate")
        for e in sorted(block["entries"], key=lambda e: (e["rank"] is None, e["rank"] or 0)):
            rank = "—" if e["rank"] is None else str(e["rank"])
            match = e["matched_candidate_id"] or "(no candidate within radius)"
            lines.append(f"{e['name']:<52} {rank:>5}  {match}")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("data_dir", nargs="?", default=str(REPO_ROOT / "public" / "data" / "mock"))
    parser.add_argument("--write", action="store_true", help="write validation_report.json into DATA_DIR")
    parser.add_argument("--radius", type=float, default=DEFAULT_MATCH_RADIUS_KM, help="match radius in km")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir).resolve()
    docs = {
        name: json.loads((data_dir / f"{name}.json").read_text(encoding="utf-8"))
        for name in ("targets", "earth_candidates", "known_analogs")
    }
    for kind, doc in docs.items():
        errs = schema_errors(kind, doc)
        if errs:
            print(f"{kind}.json does not match the contract:\n  " + "\n  ".join(errs))
            return 1

    report = build_report(docs["targets"], docs["earth_candidates"], docs["known_analogs"], match_radius_km=args.radius)
    print(format_table(report, docs["targets"]))
    if args.write:
        errs = schema_errors("validation_report", report)
        if errs:
            print("internal error: report does not match schema:\n  " + "\n  ".join(errs))
            return 1
        (data_dir / "validation_report.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {data_dir / 'validation_report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
