"""Serve pre-computed AnalogLens results to the frontend. Everything is read from disk, so
the demo works offline.

    ANALOGLENS_OUT=out uvicorn analoglens.api:app --reload --port 8000

Endpoints (the contract in the prep doc):
    GET /targets                          targets with profiles and image paths
    GET /tasks                            task presets, weights, tests, dimension labels
    GET /rank?target=...&task=...&limit=  ranked tiles (best first)
    GET /card/{tile_id}?target=&task=     the fingerprint card for one tile
    GET /validation                       AUC, known-site percentiles, ablation
    GET /img/<file>.png                   relief images referenced by cards
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

OUT = Path(os.environ.get("ANALOGLENS_OUT", "out")).resolve()
_SAFE = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")

app = FastAPI(title="AnalogLens API", version="0.1.0",
              description="Earth analogs for Moon-base and Mars sites, explained dimension by dimension.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def _safe(value: str, what: str) -> str:
    if not _SAFE.match(value):
        raise HTTPException(400, f"invalid {what}")
    return value


def _load(path: Path):
    if not path.is_file():
        raise HTTPException(404, f"not found: {path.relative_to(OUT)}")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/")
def root():
    return {"name": "AnalogLens API", "results_dir": str(OUT), "manifest": _load(OUT / "manifest.json")}


@app.get("/targets")
def targets():
    return _load(OUT / "targets.json")


@app.get("/tasks")
def tasks():
    return _load(OUT / "tasks.json")


@app.get("/rank")
def rank(target: str, task: str, limit: int = Query(50, ge=1, le=500)):
    data = _load(OUT / "rank" / f"{_safe(target, 'target')}__{_safe(task, 'task')}.json")
    data["results"] = data["results"][:limit]
    return data


@app.get("/card/{tile_id}")
def card(tile_id: str, target: str, task: str):
    name = f"{_safe(target, 'target')}__{_safe(task, 'task')}__{_safe(tile_id, 'tile_id')}.json"
    return _load(OUT / "cards" / name)


@app.get("/validation")
def validation():
    return _load(OUT / "validation.json")


app.mount("/img", StaticFiles(directory=OUT / "img", check_dir=False), name="img")
