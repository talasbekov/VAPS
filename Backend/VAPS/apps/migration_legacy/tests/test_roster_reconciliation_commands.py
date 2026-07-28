"""Story 7.9/AC-1 — CLI: export + sign roster-reconciliation commands."""

import csv
import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.audit.models import AuditLog
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.migration_legacy.models import RosterReconciliationSignature

pytestmark = pytest.mark.django_db

ON_DATE = "2026-06-04"


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-RC")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="RC-A"
    )


def run(*args):
    out = io.StringIO()
    call_command(*args, stdout=out)
    return out.getvalue()


class TestExportCommand:
    def test_exports_csv_with_header_and_rows(self, division, tmp_path):
        Employee.objects.create(
            iin="123456789012",
            full_name="Иванов И.И.",
            rank_code="",
            position_code="",
            division=division,
            employment_status=Employee.EmploymentStatus.WORKING,
            is_active=True,
        )
        out_path = tmp_path / "roster.csv"

        output = run(
            "export_roster_for_reconciliation",
            "--division",
            "RC-A",
            "--date",
            ON_DATE,
            "--out",
            str(out_path),
        )

        assert "выгружено 1 строк" in output
        with open(out_path, newline="", encoding="utf-8") as fh:
            rows = list(csv.reader(fh))
        assert rows[0] == [
            "personnel_number",
            "full_name",
            "rank_name",
            "position_name",
        ]
        assert rows[1][1] == "Иванов И.И."

    def test_unknown_division_raises(self, tmp_path):
        with pytest.raises(CommandError, match="не найдено"):
            call_command(
                "export_roster_for_reconciliation",
                "--division",
                "NOPE",
                "--date",
                ON_DATE,
                "--out",
                str(tmp_path / "x.csv"),
            )

    def test_invalid_date_raises(self, division, tmp_path):
        with pytest.raises(CommandError, match="невалидный --date"):
            call_command(
                "export_roster_for_reconciliation",
                "--division",
                "RC-A",
                "--date",
                "not-a-date",
                "--out",
                str(tmp_path / "x.csv"),
            )

    def test_ambiguous_division_code_across_organizations_rejected(
        self, division, tmp_path
    ):
        """Review fix: Division.code уникален только В ПРЕДЕЛАХ организации
        (unique_org_division_code) — код, совпадающий в двух организациях,
        не должен молча резолвиться в произвольную из них."""
        other_org = Organization.objects.create(name="Орг2", code="ORG-RC2")
        dtp = DivisionType.objects.get(code="department")
        Division.objects.create(
            organization=other_org, type_code=dtp, name="Другой отдел", code="RC-A"
        )

        with pytest.raises(CommandError, match="неоднозначен"):
            call_command(
                "export_roster_for_reconciliation",
                "--division",
                "RC-A",
                "--date",
                ON_DATE,
                "--out",
                str(tmp_path / "x.csv"),
            )


class TestSignCommand:
    def test_records_signature_and_audit(self, division):
        output = run(
            "sign_roster_reconciliation",
            "--division",
            "RC-A",
            "--date",
            ON_DATE,
            "--actor",
            "bratan",
            "--discrepancy-count",
            "2",
        )

        assert "подпись зафиксирована" in output
        assert RosterReconciliationSignature.objects.filter(
            division_id=division.id, business_date=ON_DATE, discrepancy_count=2
        ).exists()
        assert AuditLog.objects.filter(action="ROSTER_RECONCILIATION_SIGNED").exists()

    def test_requires_actor(self, division):
        with pytest.raises(CommandError):
            call_command(
                "sign_roster_reconciliation",
                "--division",
                "RC-A",
                "--date",
                ON_DATE,
                "--discrepancy-count",
                "0",
            )

    def test_unknown_division_raises(self):
        with pytest.raises(CommandError, match="не найдено"):
            call_command(
                "sign_roster_reconciliation",
                "--division",
                "NOPE",
                "--date",
                ON_DATE,
                "--actor",
                "bratan",
                "--discrepancy-count",
                "0",
            )
