"""Validate a contract data directory (mock or real) against schemas/ plus cross-file rules.

Usage:  python -m pipeline.validate_contract [DATA_DIR]      (default: public/data/mock)
Exit code 0 when valid, 1 when any error is found. Mirrors src/data/validate.ts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .contract import REPO_ROOT
from .contract.schemas import png_size, schema_errors


def _load(path: Path, errors: list[str]) -> Any | None:
    if not path.is_file():
        errors.append(f"{path.name}: file listed in manifest is missing")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{path.name}: invalid JSON ({exc})")
        return None


def _check(kind: str, name: str, doc: Any, errors: list[str]) -> bool:
    errs = schema_errors(kind, doc)
    errors.extend(f"{name}: {e}" for e in errs)
    return not errs


def validate_dir(data_dir: Path) -> list[str]:
    errors: list[str] = []
    manifest = _load(data_dir / "manifest.json", errors)
    if manifest is None or not _check("manifest", "manifest.json", manifest, errors):
        return errors

    mock = manifest["mock"]
    docs: dict[str, Any] = {}
    for kind, fname in manifest["files"].items():
        doc = _load(data_dir / fname, errors)
        if doc is not None and _check(kind, fname, doc, errors):
            docs[kind] = doc
            if doc["mock"] != mock:
                errors.append(f"{fname}: mock={doc['mock']} but manifest mock={mock} (do not mix mock and real files)")

    for target_id, fname in manifest["analogs"].items():
        doc = _load(data_dir / fname, errors)
        if doc is not None and _check("analogs", fname, doc, errors):
            if doc["target_id"] != target_id:
                errors.append(f"{fname}: target_id '{doc['target_id']}' does not match manifest key '{target_id}'")
            docs[f"analogs:{target_id}"] = doc

    for body, fname in manifest["grids"].items():
        doc = _load(data_dir / fname, errors)
        if doc is not None and _check("grid", fname, doc, errors):
            if doc["body"] != body:
                errors.append(f"{fname}: body '{doc['body']}' does not match manifest key '{body}'")
            width = 2 + len(doc["columns"])
            bad = [i for i, c in enumerate(doc["cells"]) if len(c) != width]
            if bad:
                errors.append(f"{fname}: {len(bad)} cell(s) do not have 2 + {len(doc['columns'])} values (first at index {bad[0]})")

    for ov in manifest["overlays"]:
        path = data_dir / ov["file"]
        if not path.is_file():
            errors.append(f"{ov['file']}: overlay listed in manifest is missing")
            continue
        try:
            w, h = png_size(path)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if (w, h) != (ov["width"], ov["height"]):
            errors.append(f"{ov['file']}: PNG is {w}x{h} but manifest says {ov['width']}x{ov['height']}")

    errors.extend(_cross_file(manifest, docs))
    return errors


def _cross_file(manifest: dict[str, Any], docs: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    targets = {t["id"]: t for t in docs.get("targets", {}).get("targets", [])}
    cands = docs.get("earth_candidates")
    prov_ids = {d["id"] for d in docs.get("provenance", {}).get("datasets", [])}
    known_ids = {a["id"] for a in docs.get("known_analogs", {}).get("analogs", [])}

    if cands:
        cand_ids = {c["id"] for c in cands["candidates"]}
        if len(cand_ids) != len(cands["candidates"]):
            errors.append("earth_candidates.json: duplicate candidate ids")
        for tid, pool in cands["per_target"].items():
            if targets and tid not in targets:
                errors.append(f"earth_candidates.json: per_target key '{tid}' is not a target in targets.json")
            missing = [cid for cid in pool if cid not in cand_ids]
            if missing:
                errors.append(f"earth_candidates.json: per_target['{tid}'] references unknown candidates {missing[:5]}")
        for c in cands["candidates"]:
            if c["known_analog_id"] and known_ids and c["known_analog_id"] not in known_ids:
                errors.append(f"earth_candidates.json: {c['id']} known_analog_id '{c['known_analog_id']}' not in known_analogs.json")
            for feat, pid in c["provenance"].items():
                if prov_ids and pid not in prov_ids:
                    errors.append(f"earth_candidates.json: {c['id']}.{feat} provenance '{pid}' not in provenance.json")
        missing_targets = [t for t in targets if t not in cands["per_target"]]
        if missing_targets:
            errors.append(f"earth_candidates.json: per_target has no pool for targets {missing_targets}")

    for t in targets.values():
        for feat, pid in t["provenance"].items():
            if prov_ids and pid not in prov_ids:
                errors.append(f"targets.json: {t['id']}.{feat} provenance '{pid}' not in provenance.json")
    for tid in manifest["analogs"]:
        if targets and tid not in targets:
            errors.append(f"manifest.json: analogs key '{tid}' is not a target in targets.json")
    for ov in manifest["overlays"]:
        if ov["target_id"] and targets and ov["target_id"] not in targets:
            errors.append(f"manifest.json: overlay '{ov['id']}' target_id '{ov['target_id']}' unknown")
        for pid in ov["provenance_ids"]:
            if prov_ids and pid not in prov_ids:
                errors.append(f"manifest.json: overlay '{ov['id']}' provenance '{pid}' not in provenance.json")
    return errors


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    data_dir = Path(args[0]) if args else REPO_ROOT / "public" / "data" / "mock"
    if not data_dir.is_absolute():
        data_dir = (Path.cwd() / data_dir).resolve()
    errors = validate_dir(data_dir)
    if errors:
        print(f"CONTRACT INVALID: {data_dir} ({len(errors)} error(s))")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"CONTRACT OK: {data_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
