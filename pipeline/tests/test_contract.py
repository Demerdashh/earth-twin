import json
import shutil
from pathlib import Path

import pytest

from pipeline.contract import REPO_ROOT
from pipeline.mock.generate import generate
from pipeline.validate_contract import validate_dir

MOCK_DIR = REPO_ROOT / "public" / "data" / "mock"


@pytest.fixture(scope="module")
def fresh_mock(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("mock")
    generate(out)
    return out


def test_committed_mock_set_is_valid() -> None:
    assert validate_dir(MOCK_DIR) == []


def test_generator_is_deterministic_and_matches_committed_set(fresh_mock: Path) -> None:
    for f in sorted(MOCK_DIR.iterdir()):
        assert (fresh_mock / f.name).read_bytes() == f.read_bytes(), f"{f.name} differs: re-run `npm run mock:generate`"


def test_every_mock_file_is_flagged_with_a_note(fresh_mock: Path) -> None:
    for f in fresh_mock.glob("*.json"):
        doc = json.loads(f.read_text(encoding="utf-8"))
        assert doc["mock"] is True, f.name
        assert len(doc["note"]) > 10, f.name


def test_mock_covers_required_cases(fresh_mock: Path) -> None:
    targets = json.loads((fresh_mock / "targets.json").read_text(encoding="utf-8"))["targets"]
    assert {t["body"] for t in targets} == {"moon", "mars"}
    cands = json.loads((fresh_mock / "earth_candidates.json").read_text(encoding="utf-8"))["candidates"]
    assert 15 <= len(cands) <= 30
    known = {c["known_analog_id"] for c in cands}
    for required in ("atacama", "haughton", "mauna_kea", "iceland_highlands", "sf_volcanic_field", "dry_valleys"):
        assert required in known


def _copy(src: Path, tmp_path: Path) -> Path:
    dst = tmp_path / "data"
    shutil.copytree(src, dst)
    return dst


def test_schema_violation_is_reported_with_path(fresh_mock: Path, tmp_path: Path) -> None:
    d = _copy(fresh_mock, tmp_path)
    doc = json.loads((d / "targets.json").read_text(encoding="utf-8"))
    doc["targets"][0]["features"]["slope_deg"] = 120
    (d / "targets.json").write_text(json.dumps(doc), encoding="utf-8")
    errors = validate_dir(d)
    assert any("targets.json" in e and "slope_deg" in e for e in errors)


def test_mixing_mock_and_real_is_rejected(fresh_mock: Path, tmp_path: Path) -> None:
    d = _copy(fresh_mock, tmp_path)
    doc = json.loads((d / "earth_candidates.json").read_text(encoding="utf-8"))
    doc["mock"] = False
    (d / "earth_candidates.json").write_text(json.dumps(doc), encoding="utf-8")
    assert any("do not mix mock and real" in e for e in validate_dir(d))


def test_mock_without_note_is_rejected(fresh_mock: Path, tmp_path: Path) -> None:
    d = _copy(fresh_mock, tmp_path)
    doc = json.loads((d / "provenance.json").read_text(encoding="utf-8"))
    del doc["note"]
    (d / "provenance.json").write_text(json.dumps(doc), encoding="utf-8")
    assert any("provenance.json" in e and "note" in e for e in validate_dir(d))


def test_broken_png_and_dangling_ids_are_rejected(fresh_mock: Path, tmp_path: Path) -> None:
    d = _copy(fresh_mock, tmp_path)
    (d / "similarity_jezero.png").write_bytes(b"not a png")
    doc = json.loads((d / "earth_candidates.json").read_text(encoding="utf-8"))
    doc["per_target"]["jezero"] = ["does_not_exist"]
    (d / "earth_candidates.json").write_text(json.dumps(doc), encoding="utf-8")
    errors = validate_dir(d)
    assert any("not a valid PNG" in e for e in errors)
    assert any("unknown candidates" in e for e in errors)
