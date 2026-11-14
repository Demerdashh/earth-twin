"""JSON Schema validation for contract files, using the shared schemas/ directory."""

from __future__ import annotations

import json
import struct
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from . import SCHEMA_DIR

SCHEMA_FILES: dict[str, str] = {
    "manifest": "manifest.schema.json",
    "targets": "targets.schema.json",
    "earth_candidates": "earth_candidates.schema.json",
    "analogs": "analogs.schema.json",
    "provenance": "provenance.schema.json",
    "known_analogs": "known_analogs.schema.json",
    "validation_report": "validation_report.schema.json",
    "grid": "grid.schema.json",
}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@lru_cache(maxsize=1)
def _registry() -> Registry:
    registry: Registry = Registry()
    for path in SCHEMA_DIR.glob("*.schema.json"):
        contents = json.loads(path.read_text(encoding="utf-8"))
        registry = registry.with_resource(contents["$id"], Resource.from_contents(contents))
    return registry


@lru_cache(maxsize=None)
def validator(kind: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / SCHEMA_FILES[kind]).read_text(encoding="utf-8"))
    return Draft202012Validator(
        schema, registry=_registry(), format_checker=Draft202012Validator.FORMAT_CHECKER
    )


def schema_errors(kind: str, document: Any) -> list[str]:
    """Return human-readable errors ('<json path>: <message>'), empty when valid."""
    errs = sorted(validator(kind).iter_errors(document), key=lambda e: list(e.absolute_path))
    return [f"{e.json_path}: {e.message}" for e in errs]


def png_size(path: Path) -> tuple[int, int]:
    """Read (width, height) from a PNG's IHDR chunk; raises ValueError if not a PNG."""
    head = path.read_bytes()[:24]
    if len(head) < 24 or head[:8] != PNG_SIGNATURE or head[12:16] != b"IHDR":
        raise ValueError(f"{path.name}: not a valid PNG file")
    width, height = struct.unpack(">II", head[16:24])
    return int(width), int(height)
