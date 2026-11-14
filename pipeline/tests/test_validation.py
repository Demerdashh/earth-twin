import json

from pipeline.contract import REPO_ROOT
from pipeline.contract.schemas import schema_errors
from pipeline.validation import build_report, format_table

MOCK = REPO_ROOT / "public" / "data" / "mock"


def _load(name: str) -> dict:  # type: ignore[type-arg]
    return json.loads((MOCK / f"{name}.json").read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_report_ranks_every_known_analog_for_every_target() -> None:
    targets, cands, known = _load("targets"), _load("earth_candidates"), _load("known_analogs")
    report = build_report(targets, cands, known, generated_at="2026-11-14T00:00:00Z")
    assert schema_errors("validation_report", report) == []
    assert set(report["targets"]) == {t["id"] for t in targets["targets"]}
    for block in report["targets"].values():
        assert len(block["entries"]) == len(known["analogs"])
        assert all(e["matched_candidate_id"] for e in block["entries"])


def test_mock_report_is_flagged_and_table_says_so() -> None:
    targets = _load("targets")
    report = build_report(targets, _load("earth_candidates"), _load("known_analogs"))
    assert report["mock"] is True
    assert "MOCK" in format_table(report, targets)
