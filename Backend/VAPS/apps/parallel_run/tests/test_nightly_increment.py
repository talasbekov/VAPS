"""Story 7.7 — ночной инкремент: обёртка над full_import с узким окном.

Требует включённый parallel_run_mode (или --force-pre-cutover) — ревью-фикс:
команда была функционально не связана с переключателем режима."""

import io
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import parallel_run_mode

FIXTURE = (
    Path(__file__).parent.parent.parent
    / "migration_legacy"
    / "tests"
    / "fixtures"
    / "donor_slice.json"
)

pytestmark = pytest.mark.django_db


def run_increment(*extra):
    parallel_run_mode.enable(actor="test-setup")
    out = io.StringIO()
    call_command("nightly_increment", str(FIXTURE), *extra, stdout=out)
    return out.getvalue()


class TestHappyPath:
    def test_imports_within_narrow_window(self):
        out = run_increment("--days", "1", "--until", "2026-06-04")
        assert "window [2026-06-04..2026-06-04]" in out

    def test_second_run_is_idempotent(self):
        run_increment("--days", "1", "--until", "2026-06-04")
        out = run_increment("--days", "1", "--until", "2026-06-04")
        assert "employees: read 6, created 0" in out


class TestModeCoupling:
    def test_disabled_mode_refuses_to_run(self):
        """Ревью-фикс: инкремент отказывается бежать, если режим выключен —
        та же семантика, что epics.md уже фиксирует для cutover (7.10)."""
        assert parallel_run_mode.is_enabled() is False
        with pytest.raises(CommandError, match="без --force-pre-cutover"):
            call_command(
                "nightly_increment",
                str(FIXTURE),
                "--days",
                "1",
                "--until",
                "2026-06-04",
            )

    def test_force_pre_cutover_overrides_disabled_mode(self):
        assert parallel_run_mode.is_enabled() is False
        out_io = io.StringIO()
        call_command(
            "nightly_increment",
            str(FIXTURE),
            "--days",
            "1",
            "--until",
            "2026-06-04",
            "--force-pre-cutover",
            stdout=out_io,
        )
        assert "window [2026-06-04..2026-06-04]" in out_io.getvalue()


class TestReport:
    def test_cannot_read_missing_file(self):
        parallel_run_mode.enable(actor="test-setup")
        with pytest.raises(CommandError):
            call_command("nightly_increment", "/no/such/file.json")

    def test_default_until_is_yesterday(self):
        from datetime import date

        from apps.core.clock import override

        parallel_run_mode.enable(actor="test-setup")
        with override(date(2026, 6, 8)):
            out_io = io.StringIO()
            call_command("nightly_increment", str(FIXTURE), stdout=out_io)
        assert "..2026-06-07]" in out_io.getvalue()
