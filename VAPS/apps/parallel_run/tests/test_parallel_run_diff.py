"""Story 6.9 — parallel-run diff catch-up job: registry, catch-up, non-blocking.

Job-orchestration + persistence tests. The donor classifier itself is unit-tested
in ``apps/migration_legacy/tests/test_donor_diff.py`` — NOT re-tested here. VAPS
расход is empty (no employees seeded), so each crafted baseline row diffs against
zeros and lands on a deterministic category — enough to exercise persistence,
green-day counting, catch-up and the non-blocking contract without heavy seeding.
"""

import json
from contextlib import contextmanager
from datetime import date

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.clock import override
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
    Watermark,
)
from apps.core.selectors import local_midnight
from apps.operations.statuses.models import EmployeeStatus
from apps.parallel_run import services as prd_services
from apps.parallel_run.models import ParallelRunDay, ParallelRunDiff
from apps.parallel_run.services import parallel_run_diff as prd
from apps.parallel_run.services import run_parallel_run_diff

pytestmark = pytest.mark.django_db

WM = "parallel_run"


def _row(code, **overrides):
    row = {
        "division_code": code,
        "division_name": f"Подразделение {code}",
        "staff_unit": 0,
        "in_service": 0,
        "vacation": 0,
        "sick_leave": 0,
        "business_trip": 0,
        "training": 0,
        "seconded_in": 0,
        "seconded_out": 0,
        "other_absence": 0,
    }
    row.update(overrides)
    return row


def _baseline(tmp_path, days):
    """days: list of (iso_date, [rows]) -> write JSON, return path str."""
    envelope = {"days": [{"date": d, "rows": rows} for d, rows in days]}
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(envelope, ensure_ascii=False), encoding="utf-8")
    return str(path)


def _seed_watermark(on):
    Watermark.objects.create(key=WM, last_materialized_date=on)


def test_diff_persisted_with_categories(tmp_path):
    # DEP1 donor in_service=1 vs VAPS 0 → data/skipped_employee (blocking).
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", in_service=1)])])
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    assert result.processed_days == [date(2026, 6, 4)]
    assert result.watermark_after == date(2026, 6, 4)
    cell = ParallelRunDiff.objects.get(run_date=date(2026, 6, 4))
    assert cell.division_code == "DEP1"
    assert cell.column_code == "IN_SERVICE"
    assert cell.category == "data/skipped_employee"
    assert cell.donor_value == 1 and cell.vaps_value == 0 and cell.delta == -1
    assert cell.is_blocking is True and cell.pending_signature is False
    day = ParallelRunDay.objects.get(run_date=date(2026, 6, 4))
    assert day.status == "ok" and day.blocking_count == 1 and day.total_diffs == 1


def test_model_category_is_pending_signature_not_blocking(tmp_path):
    # donor seconded_in=1 vs VAPS attached 0 → model/attached_source.
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", seconded_in=1)])])
    _seed_watermark(date(2026, 6, 3))

    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    cell = ParallelRunDiff.objects.get(run_date=date(2026, 6, 4))
    assert cell.category == "model/attached_source"
    assert cell.pending_signature is True
    assert cell.is_blocking is False
    day = ParallelRunDay.objects.get(run_date=date(2026, 6, 4))
    assert day.status == "ok" and day.blocking_count == 0  # green


def test_green_streak_counts_consecutive_clean_days(tmp_path):
    baseline = _baseline(
        tmp_path,
        [
            ("2026-06-04", [_row("DEP1")]),
            ("2026-06-05", [_row("DEP1")]),
            ("2026-06-06", [_row("DEP1")]),
        ],
    )
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert result.processed_days == [
        date(2026, 6, 4),
        date(2026, 6, 5),
        date(2026, 6, 6),
    ]
    assert result.green_streak == 3
    assert ParallelRunDiff.objects.count() == 0  # all-zero rows → no cells


def test_blocking_day_resets_streak(tmp_path):
    baseline = _baseline(
        tmp_path,
        [
            ("2026-06-04", [_row("DEP1")]),
            ("2026-06-05", [_row("DEP1")]),
            ("2026-06-06", [_row("DEP1", in_service=1)]),  # blocking, most recent
        ],
    )
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert result.green_streak == 0


def test_catchup_processes_all_missed_days(tmp_path):
    baseline = _baseline(
        tmp_path,
        [
            ("2026-06-04", [_row("DEP1")]),
            ("2026-06-05", [_row("DEP1")]),
            ("2026-06-06", [_row("DEP1")]),
        ],
    )
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert result.processed_days == [
        date(2026, 6, 4),
        date(2026, 6, 5),
        date(2026, 6, 6),
    ]
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 6)


def test_rerun_is_idempotent(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", in_service=1)])])
    _seed_watermark(date(2026, 6, 3))

    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)
    first = ParallelRunDiff.objects.count()
    # rewind the watermark and run the same day again
    Watermark.objects.filter(key=WM).update(last_materialized_date=date(2026, 6, 3))
    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    assert ParallelRunDiff.objects.count() == first == 1
    assert ParallelRunDay.objects.filter(run_date=date(2026, 6, 4)).count() == 1


def test_missing_baseline_day_records_no_baseline(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-01", [_row("DEP1")])])  # not 06-04
    _seed_watermark(date(2026, 6, 3))

    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    day = ParallelRunDay.objects.get(run_date=date(2026, 6, 4))
    assert day.status == "no_baseline"
    assert not ParallelRunDiff.objects.filter(run_date=date(2026, 6, 4)).exists()
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 4)


def test_per_day_crash_is_isolated_and_non_blocking(tmp_path, monkeypatch):
    baseline = _baseline(
        tmp_path,
        [
            ("2026-06-04", [_row("DEP1")]),
            ("2026-06-05", [_row("DEP1")]),
            ("2026-06-06", [_row("DEP1")]),
        ],
    )
    _seed_watermark(date(2026, 6, 3))

    original = prd.StrengthReportService.compute

    def flaky(business_date, division_id=None):
        if business_date == date(2026, 6, 5):
            raise RuntimeError("boom")
        return original(business_date, division_id=division_id)

    monkeypatch.setattr(prd.StrengthReportService, "compute", flaky)

    # Must NOT raise (non-blocking) and must process all three days.
    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert result.processed_days == [
        date(2026, 6, 4),
        date(2026, 6, 5),
        date(2026, 6, 6),
    ]
    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 5)).status == "error"
    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 4)).status == "ok"
    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 6)).status == "ok"
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 6)


def test_first_run_bootstraps_without_backfill(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", in_service=1)])])
    # NO watermark seeded → fresh deploy.
    with override(date(2026, 6, 10)):
        result = run_parallel_run_diff(baseline_path=baseline)

    assert result.processed_days == []
    assert result.watermark_after == date(2026, 6, 9)  # today-1, no backfill
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 9)
    assert ParallelRunDay.objects.count() == 0


def test_command_future_today_is_a_footgun_error():
    with override(date(2026, 6, 10)):
        with pytest.raises(CommandError):
            call_command("parallel_run_diff", "--today", "2026-06-11")


def test_command_exit_zero_on_blocking(tmp_path, capsys):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", in_service=1)])])
    _seed_watermark(date(2026, 6, 3))

    # No exception raised (exit 0) despite a blocking «ticket».
    call_command("parallel_run_diff", "--today", "2026-06-04", "--baseline", baseline)
    out = capsys.readouterr().out
    assert "parallel-run diff" in out
    assert "UNCLASSIFIED" in out


def test_services_reexport():
    assert prd_services.run_parallel_run_diff is run_parallel_run_diff


# --- Review 2026-07-13 additions -------------------------------------------


def test_unclassified_category_is_blocking(tmp_path):
    # donor staff_unit=1 vs VAPS staff_total 0 → REAL unclassified (Task 5d).
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1", staff_unit=1)])])
    _seed_watermark(date(2026, 6, 3))

    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    cell = ParallelRunDiff.objects.get(run_date=date(2026, 6, 4))
    assert cell.category == "unclassified"
    assert cell.is_blocking is True and cell.pending_signature is False
    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 4)).blocking_count == 1


def test_e5_seeded_vaps_matches_baseline_green(tmp_path):
    """E5: непустой VAPS (Division+slots+Employee+статус) против согласованного
    донор-дня → интеграция compute→diff_day даёт ноль расхождений (зелёный)."""
    org = Organization.objects.create(name="Орг ПР", code="ORG-PRD")
    division_type, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    division = Division.objects.create(
        organization=org, type_code=division_type, name="Отдел ПР", code="PRD-A"
    )
    employees = [
        Employee.objects.create(
            iin=f"77{n:010d}",
            full_name=f"Боец {n}",
            rank_code="",
            position_code="",
            division=division,
            employment_status="WORKING",
        )
        for n in range(3)
    ]
    DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=3,
        valid_from=local_midnight(date(2026, 6, 1)),
    )
    EmployeeStatus.objects.create(
        employee_id=employees[0].id,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
        source="USER",
    )
    # Донор-день, согласованный с посевом: 3 по штату, 2 в строю, 1 на больничном.
    baseline = _baseline(
        tmp_path,
        [("2026-06-04", [_row("PRD-A", staff_unit=3, in_service=2, sick_leave=1)])],
    )
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    day = ParallelRunDay.objects.get(run_date=date(2026, 6, 4))
    assert day.status == "ok"
    assert day.total_diffs == 0 and day.blocking_count == 0
    assert result.green_streak == 1


def test_no_baseline_day_is_transparent_for_streak(tmp_path):
    # ok-green / no_baseline / ok-green → серия 2 (D2: прозрачный день).
    baseline = _baseline(
        tmp_path,
        [("2026-06-04", [_row("DEP1")]), ("2026-06-06", [_row("DEP1")])],
    )
    _seed_watermark(date(2026, 6, 3))

    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 5)).status == (
        "no_baseline"
    )
    assert result.green_streak == 2


def test_empty_rows_day_is_no_baseline(tmp_path):
    # День есть в эталоне, но rows=[] — артефакт заморозки, НЕ «донор=нули» (D3).
    baseline = _baseline(tmp_path, [("2026-06-04", [])])
    _seed_watermark(date(2026, 6, 3))

    run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    day = ParallelRunDay.objects.get(run_date=date(2026, 6, 4))
    assert day.status == "no_baseline"
    assert not ParallelRunDiff.objects.exists()


def test_service_rejects_future_today():
    # Foot-gun-гвард на СЕРВИСНОМ слое (12.6 оборачивает именно сервис).
    with override(date(2026, 6, 10)):
        with pytest.raises(ValueError, match="ahead of real time"):
            run_parallel_run_diff(today=date(2026, 6, 11))


def test_unreadable_baseline_halts_non_blocking(tmp_path):
    _seed_watermark(date(2026, 6, 3))
    missing = str(tmp_path / "missing.json")

    result = run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=missing)

    assert result.halted is True
    assert result.halt_reason == "baseline_unreadable"
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 3)
    # И через команду — никакого исключения (exit 0).
    call_command("parallel_run_diff", "--today", "2026-06-04", "--baseline", missing)


def test_lock_held_skips_silently(tmp_path, monkeypatch):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1")])])
    _seed_watermark(date(2026, 6, 3))

    @contextmanager
    def busy_lock(key, blocking=True):
        yield False

    monkeypatch.setattr(prd, "advisory_lock", busy_lock)

    result = run_parallel_run_diff(today=date(2026, 6, 4), baseline_path=baseline)

    assert result.skipped is True
    assert not ParallelRunDay.objects.exists()
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 3)


def test_halt_clock_behind_watermark(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1")])])
    _seed_watermark(date(2026, 6, 10))

    with override(date(2026, 6, 5)):
        result = run_parallel_run_diff(baseline_path=baseline)

    assert result.halted is True
    assert result.halt_reason == "clock_behind_watermark"
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 10)


def test_manual_today_behind_watermark_distinct_reason(tmp_path):
    # Явный --today ниже watermark — не «часы сломались», причина различима.
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1")])])
    _seed_watermark(date(2026, 6, 10))

    result = run_parallel_run_diff(today=date(2026, 6, 5), baseline_path=baseline)

    assert result.halted is True
    assert result.halt_reason == "today_behind_watermark"


def test_halt_gap_exceeds_sanity(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1")])])
    _seed_watermark(date(2024, 6, 1))

    with override(date(2026, 6, 4)):
        result = run_parallel_run_diff(baseline_path=baseline)

    assert result.halted is True
    assert result.halt_reason == "gap_exceeds_sanity"
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2024, 6, 1)


def test_backlog_truncated_to_batch_cap_with_signal(tmp_path):
    baseline = _baseline(tmp_path, [("2026-06-04", [_row("DEP1")])])
    _seed_watermark(date(2026, 4, 1))  # 64 дня бэклога

    with override(date(2026, 6, 4)):
        result = run_parallel_run_diff(baseline_path=baseline)

    assert len(result.processed_days) == prd.MAX_CATCHUP_DAYS
    assert result.processed_days[0] == date(2026, 4, 2)
    assert result.remaining_backlog == 64 - prd.MAX_CATCHUP_DAYS
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 5, 2)


def test_crash_in_error_recovery_does_not_kill_the_run(tmp_path, monkeypatch):
    baseline = _baseline(
        tmp_path,
        [
            ("2026-06-04", [_row("DEP1")]),
            ("2026-06-05", [_row("DEP1")]),
            ("2026-06-06", [_row("DEP1")]),
        ],
    )
    _seed_watermark(date(2026, 6, 3))

    original = prd.StrengthReportService.compute

    def flaky(business_date, division_id=None):
        if business_date == date(2026, 6, 5):
            raise RuntimeError("boom")
        return original(business_date, division_id=division_id)

    monkeypatch.setattr(prd.StrengthReportService, "compute", flaky)

    def broken_record(day):
        raise RuntimeError("recovery down too")

    monkeypatch.setattr(prd, "_record_error_day", broken_record)

    # Ни исходный краш, ни краш recovery-ветки не роняют прогон (AC-5).
    result = run_parallel_run_diff(today=date(2026, 6, 6), baseline_path=baseline)

    assert result.processed_days == [
        date(2026, 6, 4),
        date(2026, 6, 5),
        date(2026, 6, 6),
    ]
    assert not ParallelRunDay.objects.filter(run_date=date(2026, 6, 5)).exists()
    assert ParallelRunDay.objects.get(run_date=date(2026, 6, 6)).status == "ok"
    assert Watermark.objects.get(key=WM).last_materialized_date == date(2026, 6, 6)
