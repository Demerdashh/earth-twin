"""Run everything for every target and task, and write the JSON the API serves.

Output layout (the frontend reads only this; see README for the API contract):
    out/manifest.json            run settings and counts
    out/targets.json             targets with their profiles and images
    out/tasks.json               task presets, weights, tests, dimension labels
    out/rank/<target>__<task>.json
    out/cards/<target>__<task>__<tile_id>.json
    out/validation.json          AUC, known-site percentiles, ablation per target and task
    out/img/*.png                shaded-relief images for cards
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np

from .cards import build_card
from .index import AnalogIndex
from .render import save_relief_png
from .scoring import dimension_scores, nearest_known, rank
from .terrain import describe
from .validate import ablation, positives_near, roc_auc, site_percentiles

TERRAIN_FEATURES = ("slope_p50", "tri_mean", "relief", "anisotropy")


def write_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=_json_default), encoding="utf-8")


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not JSON serialisable: {type(o)}")


def run_pipeline(earth: dict, targets: dict, tasks: dict, dims_cfg: dict, bodies: dict, known_sites: list,
                 out_dir, embedder, res_m: float, top: int = 50, cards_per_task: int = 10,
                 novelty_km: float = 200.0, validation_radius_km: float = 100.0,
                 positives_by_target: dict | None = None, synthetic: bool = False, log=print) -> dict:
    """earth: {"ids", "lat", "lon", "tiles" (N, S, S), "features" {name: array}}.
    targets: {key: config dict plus "tile" (S, S)}. See README for the config formats."""
    out = Path(out_dir)
    ids, lat, lon = list(earth["ids"]), np.asarray(earth["lat"], float), np.asarray(earth["lon"], float)
    tiles = earth["tiles"]
    features = {k: np.asarray(v, float) for k, v in earth.get("features", {}).items()}

    log(f"Describing {len(ids)} Earth tiles...")
    described = [describe(t, res_m) for t in tiles]
    for name in TERRAIN_FEATURES:
        features.setdefault(name, np.array([d[name] for d in described]))

    log(f"Embedding with {embedder.name}...")
    index = AnalogIndex(standardize=embedder.standardize).build(embedder.embed(tiles, res_m), ids)

    img_dir = out / "img"
    rendered = set()

    def earth_image(i):
        name = f"earth_{ids[i]}.png"
        if name not in rendered:
            save_relief_png(tiles[i], res_m, img_dir / name)
            rendered.add(name)
        return f"/img/{name}"

    targets_out, validation = [], {}
    for tkey, target in targets.items():
        tdesc = describe(target["tile"], res_m)
        profile = dict(target.get("profile", {}))
        for name in TERRAIN_FEATURES:
            profile.setdefault(name, round(tdesc[name], 3))
        target = {**target, "profile": profile}
        shape = index.to_unit(index.cosine_all(embedder.embed([target["tile"]], res_m)[0]))
        scores, meta = dimension_scores(features, profile, dims_cfg, shape_scores=shape)
        target_img = f"/img/target_{tkey}.png"
        save_relief_png(target["tile"], res_m, img_dir / f"target_{tkey}.png")
        limits = bodies.get(target["body"], {}).get("limits", [])

        if positives_by_target and tkey in positives_by_target:
            positive = np.asarray(positives_by_target[tkey], bool)
            relevant_sites = [s for s in known_sites if set(s.get("known_for", [])) & set(target.get("validation_tags", []))]
        else:
            relevant_sites = [s for s in known_sites if set(s.get("known_for", [])) & set(target.get("validation_tags", []))]
            positive = positives_near(lat, lon, relevant_sites, validation_radius_km)

        for task_key in target.get("tasks", list(tasks)):
            task = tasks[task_key]
            weights = {d: w for d, w in task["weights"].items() if d in scores}
            if not weights:
                log(f"  skip {tkey} x {task_key}: no dimension has data")
                continue
            results, total = rank(ids, lat, lon, scores, weights, known_sites, novelty_km, top)
            write_json(out / "rank" / f"{tkey}__{task_key}.json", {
                "target": tkey, "task": task_key, "embedder": embedder.name, "synthetic": synthetic,
                "dimension_modes": {d: meta[d]["mode"] for d in weights},
                "results": results,
            })
            dist_km, which = nearest_known(lat, lon, known_sites)
            for r in results[:cards_per_task]:
                i = ids.index(r["tile_id"])
                near = None
                if which[i] >= 0:
                    near = {"name": known_sites[int(which[i])]["name"], "km": round(float(dist_km[i]), 1),
                            "novel": bool(dist_km[i] > novelty_km)}
                card = build_card(i, ids[i], tkey, target, task_key, {**task, "weights": weights}, dims_cfg,
                                  scores, meta, features, total[i], limits, near,
                                  {"earth": earth_image(i), "target": target_img})
                card["synthetic"] = synthetic
                write_json(out / "cards" / f"{tkey}__{task_key}__{ids[i]}.json", card)

            entry = {"auc": roc_auc(total, positive), "n_positive": int(positive.sum()),
                     "known_sites": site_percentiles(lat, lon, total, relevant_sites, validation_radius_km)}
            if "terrain_shape" in weights and len(weights) > 1:
                entry["ablation"] = ablation(scores, weights, positive, "terrain_shape")
            validation[f"{tkey}__{task_key}"] = entry
            auc = entry["auc"]
            abl = entry.get("ablation", {})
            log(f"  {tkey} x {task_key}: AUC {auc if auc is None else round(auc, 3)}"
                + (f" (without terrain shape {round(abl['auc_without'], 3)})" if abl.get("auc_without") is not None else ""))

        targets_out.append({
            "key": tkey, "label": target.get("label", tkey), "body": target["body"],
            "lat": target.get("lat"), "lon": target.get("lon"), "tasks": target.get("tasks", list(tasks)),
            "profile": profile, "image": target_img, "notes": target.get("notes", ""),
        })

    write_json(out / "targets.json", {"synthetic": synthetic, "targets": targets_out})
    write_json(out / "tasks.json", {"tasks": tasks, "dimensions": {k: {"label": v["label"], "unit": v.get("unit", "")}
                                                                  for k, v in dims_cfg.items()}})
    write_json(out / "validation.json", {"synthetic": synthetic, "embedder": embedder.name, "results": validation})
    manifest = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "synthetic": synthetic, "embedder": embedder.name, "res_m": res_m,
                "tile_px": int(tiles.shape[1]), "earth_tiles": len(ids), "targets": list(targets),
                "novelty_km": novelty_km, "images": len(rendered) + len(targets)}
    write_json(out / "manifest.json", manifest)
    return {"manifest": manifest, "validation": validation}
