"""Story 7.5 — post-migration acceptance gate: формулы сходимости +
опциональная сверка численностей с донором (AC-1: любой красный =
миграция не принята)."""

import io
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"
BASELINE = Path(__file__).parent / "fixtures" / "donor_baseline_sample.json"

pytestmark = pytest.mark.django_db


def _import_golden_fixture():
    call_command(
        "import_donor_slice",
        str(FIXTURE),
        "--days",
        "7",
        "--until",
        "2026-06-07",
        stdout=io.StringIO(),
    )


def run_verify(*args):
    out = io.StringIO()
    call_command("verify_migration_convergence", *args, stdout=out)
    return out.getvalue()


class TestFormulaConvergenceOnly:
    def test_clean_run_is_accepted(self):
        _import_golden_fixture()
        out = run_verify("--dates", "2026-06-04")
        assert "МИГРАЦИЯ ПРИНЯТА" in out
        assert "2026-06-04: сходимость OK" in out

    def test_multiple_dates_all_checked(self):
        _import_golden_fixture()
        out = run_verify("--dates", "2026-06-01,2026-06-04,2026-06-07")
        assert "МИГРАЦИЯ ПРИНЯТА" in out
        for d in ("2026-06-01", "2026-06-04", "2026-06-07"):
            assert f"{d}: сходимость OK" in out

    def test_invalid_date_raises(self):
        with pytest.raises(CommandError):
            call_command("verify_migration_convergence", "--dates", "not-a-date")

    def test_empty_dates_raises(self):
        with pytest.raises(CommandError):
            call_command("verify_migration_convergence", "--dates", "")


class TestBaselineReconciliation:
    def test_known_gate_blocking_baseline_rejects_migration(self):
        """golden baseline (donor_baseline_sample.json) — фикстура, УЖЕ
        существовавшая до этой стори (используется test_strength_report_command.py
        и apps/parallel_run как синтетический seed-образец, см. её собственный
        _comment: "SYNTHETIC donor baseline... crafted so each diff cell
        lands on exactly one category"). Не выдумана ЗАРАДИ прохождения
        теста этой стори — но и не "реальные донорские данные": находка
        (DIR1 DETACHED surplus → unclassified/gate-blocking) — реальное
        поведение классификатора на заранее сконструированном входе, не
        подогнанный под тест ассерт. AC-1: любой красный = миграция не
        принята → CommandError."""
        _import_golden_fixture()
        out_io = io.StringIO()
        with pytest.raises(CommandError, match="МИГРАЦИЯ НЕ ПРИНЯТА"):
            call_command(
                "verify_migration_convergence",
                "--dates",
                "2026-06-04",
                "--baseline",
                str(BASELINE),
                stdout=out_io,
            )
        assert "gate-blocking cell(s)" in out_io.getvalue()

    def test_date_not_in_baseline_warns_but_does_not_block(self):
        _import_golden_fixture()
        out = run_verify(
            "--dates", "2026-06-01", "--baseline", str(BASELINE)
        )
        assert "нет в --baseline" in out
        assert "МИГРАЦИЯ ПРИНЯТА (частичная сверка с донором" in out

    def test_missing_baseline_file_raises(self):
        _import_golden_fixture()
        with pytest.raises(CommandError):
            call_command(
                "verify_migration_convergence",
                "--dates",
                "2026-06-04",
                "--baseline",
                "/no/such/file.json",
            )

    def test_baseline_miss_combined_with_real_violation_still_blocks(self):
        """Ревью-фикс: дата, отсутствующая в baseline (только warning), НЕ
        должна маскировать РЕАЛЬНОЕ нарушение формулы сходимости на другую,
        присутствующую в baseline дату в том же прогоне."""
        _import_golden_fixture()
        out_io = io.StringIO()
        with pytest.raises(CommandError, match="МИГРАЦИЯ НЕ ПРИНЯТА"):
            call_command(
                "verify_migration_convergence",
                "--dates",
                "2026-06-01,2026-06-04",  # 06-01 нет в baseline, 06-04 — есть и красная
                "--baseline",
                str(BASELINE),
                stdout=out_io,
            )
        out = out_io.getvalue()
        assert "2026-06-01: нет в --baseline" in out
        assert "2026-06-04" in out and "gate-blocking" in out

    def test_success_message_without_baseline_is_qualified(self):
        _import_golden_fixture()
        out = run_verify("--dates", "2026-06-01")
        assert "МИГРАЦИЯ ПРИНЯТА (только формулы сходимости" in out


class TestRobustness:
    def test_duplicate_dates_are_deduped(self):
        _import_golden_fixture()
        out = run_verify("--dates", "2026-06-04,2026-06-04,2026-06-04")
        # ОДНО вхождение "сходимость OK" на дату, не три.
        assert out.count("2026-06-04: сходимость OK") == 1

    def test_out_of_order_dates_reported_chronologically(self):
        _import_golden_fixture()
        out = run_verify("--dates", "2026-06-07,2026-06-01,2026-06-04")
        first = out.index("2026-06-01")
        second = out.index("2026-06-04")
        third = out.index("2026-06-07")
        assert first < second < third

    def test_compute_failure_on_one_date_isolated_not_fatal_to_batch(
        self, monkeypatch
    ):
        """Ревью-фикс: необработанное исключение из compute()/diff_day()
        (AssertionError/ValueError/ошибка БД) раньше валило ВСЮ команду
        сырым traceback вместо чистого CommandError с AC-1 семантикой —
        теперь изолируется на одну дату, считается красной, остальные даты
        всё равно проверяются."""
        from apps.migration_legacy.management.commands import (
            verify_migration_convergence as cmd_module,
        )

        _import_golden_fixture()
        original_compute = cmd_module.StrengthReportService.compute

        def flaky_compute(business_date, division_id=None):
            if business_date.isoformat() == "2026-06-04":
                raise AssertionError("synthetic invariant break for the test")
            return original_compute(business_date, division_id=division_id)

        monkeypatch.setattr(
            cmd_module.StrengthReportService, "compute", staticmethod(flaky_compute)
        )
        out_io = io.StringIO()
        with pytest.raises(CommandError, match="МИГРАЦИЯ НЕ ПРИНЯТА"):
            call_command(
                "verify_migration_convergence",
                "--dates",
                "2026-06-01,2026-06-04,2026-06-07",
                stdout=out_io,
            )
        out = out_io.getvalue()
        assert "2026-06-04: ОШИБКА при проверке" in out
        # Соседние даты всё равно проверены, а не потеряны из-за краха 06-04.
        assert "2026-06-01: сходимость OK" in out
        assert "2026-06-07: сходимость OK" in out
