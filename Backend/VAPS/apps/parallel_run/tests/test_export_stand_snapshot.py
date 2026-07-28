"""Story 7.0 — минимальный экспорт-CLI: json-снимок на локальный носитель."""

import json

import pytest
from django.core.management import CommandError, call_command

from apps.parallel_run.models import ParallelRunDay, ParallelRunDiff

pytestmark = pytest.mark.django_db


def test_requires_out_dir_or_env(monkeypatch):
    monkeypatch.delenv("VAPS_STAND_EXPORT_DIR", raising=False)
    with pytest.raises(CommandError):
        call_command("export_stand_snapshot")


@pytest.mark.parametrize("bad_days", [0, -1, -30])
def test_rejects_non_positive_days(tmp_path, bad_days):
    with pytest.raises(CommandError):
        call_command("export_stand_snapshot", out_dir=str(tmp_path), days=bad_days)
    assert list(tmp_path.glob("stand-snapshot-*.json")) == []


def test_writes_json_snapshot_with_days_and_diffs(tmp_path):
    ParallelRunDay.objects.create(
        run_date="2026-07-20", status="ok", blocking_count=0, total_diffs=1
    )
    ParallelRunDiff.objects.create(
        run_date="2026-07-20",
        division_code="D1",
        column_code="attached",
        donor_value=5,
        vaps_value=4,
        delta=-1,
        category="unclassified",
        is_blocking=True,
    )

    call_command("export_stand_snapshot", out_dir=str(tmp_path))

    files = list(tmp_path.glob("stand-snapshot-*.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))
    assert len(data["days"]) == 1
    assert data["days"][0]["run_date"] == "2026-07-20"
    assert len(data["diffs"]) == 1
    assert data["diffs"][0]["division_code"] == "D1"
    assert data["diffs"][0]["is_blocking"] is True


def test_respects_days_limit(tmp_path):
    for i in range(5):
        ParallelRunDay.objects.create(
            run_date=f"2026-07-{10 + i:02d}",
            status="ok",
            blocking_count=0,
            total_diffs=0,
        )

    call_command("export_stand_snapshot", out_dir=str(tmp_path), days=2)

    files = list(tmp_path.glob("stand-snapshot-*.json"))
    data = json.loads(files[0].read_text(encoding="utf-8"))
    assert len(data["days"]) == 2
    # newest-first (order_by("-run_date"))
    assert data["days"][0]["run_date"] == "2026-07-14"
