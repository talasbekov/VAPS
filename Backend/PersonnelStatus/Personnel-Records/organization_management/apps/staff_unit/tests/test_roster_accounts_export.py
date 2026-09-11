import json
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from openpyxl import Workbook, load_workbook

from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.tests.test_roster_passwords import (
    PASSWORD,
    run,
)
from organization_management.apps.staff_unit.tests.test_roster_xlsx import (
    sample,
    workbook,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def accounts():
    users = get_user_model()
    return [
        users.objects.create_user(
            username=name, password="old", is_superuser=i == 0, is_active=i != 2
        )
        for i, name in enumerate(["admin-export", "000042", "=1+1"])
    ]


def test_export_contains_exact_logins_and_passwords_as_text_only(tmp_path, accounts):
    target = tmp_path / "accounts.xlsx"
    report = tmp_path / "report.json"
    out = run(tmp_path, apply=True, accounts_export=str(target), report=str(report))
    book = load_workbook(target)
    rows = list(book.active.rows)
    assert [c.value for c in rows[0]] == ["Логин", "Пароль"]
    assert [[c.value for c in row] for row in rows[1:]] == [
        [u.username, PASSWORD] for u in accounts
    ]
    assert all(
        c.data_type == "s" and c.number_format == "@" for row in rows[1:] for c in row
    )
    assert target.stat().st_mode & 0o777 == 0o600
    assert all(u.username not in out + report.read_text() for u in accounts)
    assert PASSWORD not in report.read_text()
    assert json.loads(report.read_text())["accounts_export"]["written"] is True
    assert json.loads(report.read_text())["accounts_export"]["rows"] == len(accounts)
    hashes = list(
        get_user_model().objects.order_by("pk").values_list("password", flat=True)
    )
    original = target.read_bytes()
    run(tmp_path, apply=True, accounts_export=str(tmp_path / "again.xlsx"))
    assert target.read_bytes() == original
    assert (
        list(get_user_model().objects.order_by("pk").values_list("password", flat=True))
        == hashes
    )


@pytest.mark.parametrize("check_file", [False, True])
def test_preview_creates_no_credentials_file(tmp_path, accounts, check_file):
    target = tmp_path / "accounts.xlsx"
    run(tmp_path, check_file=check_file, accounts_export=str(target))
    assert not target.exists()
    assert not Employee.objects.exists()
    assert all(
        get_user_model().objects.get(pk=u.pk).check_password("old") for u in accounts
    )


def test_invalid_import_creates_no_credentials_file(tmp_path, accounts):
    target = tmp_path / "accounts.xlsx"
    with pytest.raises(CommandError):
        run(
            tmp_path,
            rows=[sample(iin="invalid")],
            apply=True,
            accounts_export=str(target),
        )
    assert not target.exists()
    assert not Employee.objects.exists()


def test_existing_export_is_preserved_before_any_database_change(tmp_path, accounts):
    target = tmp_path / "accounts.xlsx"
    target.write_bytes(b"previous export")
    with pytest.raises(CommandError, match="существ"):
        run(tmp_path, apply=True, accounts_export=str(target))
    assert target.read_bytes() == b"previous export"
    assert not Employee.objects.exists()
    assert all(
        get_user_model().objects.get(pk=u.pk).check_password("old") for u in accounts
    )


def test_export_requires_known_password(tmp_path, accounts):
    with pytest.raises(CommandError, match="парол"):
        call_command(
            "import_staffing_xlsx",
            str(workbook(tmp_path, [sample()])),
            apply=True,
            accounts_export=str(tmp_path / "accounts.xlsx"),
            stdout=StringIO(),
        )
    assert not Employee.objects.exists()


def test_export_error_reports_committed_import_without_partial_file(
    tmp_path, accounts, monkeypatch
):
    source = workbook(tmp_path, [sample()])
    secret = tmp_path / "password.txt"
    secret.write_text(PASSWORD)
    target = tmp_path / "accounts.xlsx"
    report = tmp_path / "report.json"

    def fail(*args, **kwargs):
        raise OSError("synthetic disk error")

    monkeypatch.setattr(Workbook, "save", fail)
    with pytest.raises(CommandError, match="Импорт и смена паролей выполнены"):
        call_command(
            "import_staffing_xlsx",
            str(source),
            account_password_file=str(secret),
            accounts_export=str(target),
            report=str(report),
            apply=True,
            stdout=StringIO(),
        )
    assert not target.exists()
    assert not list(tmp_path.glob(".accounts-*"))
    assert Employee.objects.exists()
    assert all(u.check_password(PASSWORD) for u in get_user_model().objects.all())
    result = json.loads(report.read_text())
    assert result["applied"] is True and result["accounts_export"]["written"] is False


def test_database_failure_creates_no_credentials_file(tmp_path, accounts, monkeypatch):
    users = get_user_model()
    original = users.save

    def fail_second(user, *args, **kwargs):
        if user.pk == accounts[1].pk:
            raise DatabaseError("synthetic error")
        return original(user, *args, **kwargs)

    monkeypatch.setattr(users, "save", fail_second)
    target = tmp_path / "accounts.xlsx"
    with pytest.raises(CommandError, match="Транзакция"):
        run(tmp_path, apply=True, accounts_export=str(target))
    assert not target.exists()
    assert not Employee.objects.exists()
    assert all(users.objects.get(pk=u.pk).check_password("old") for u in accounts)


def test_export_and_report_failure_keep_applied_status_in_error(
    tmp_path, accounts, monkeypatch
):
    from organization_management.apps.staff_unit.management.commands import (
        import_staffing_xlsx as command,
    )

    source = workbook(tmp_path, [sample()])
    secret = tmp_path / "password.txt"
    secret.write_text(PASSWORD)

    def fail(*args, **kwargs):
        raise OSError("synthetic full disk")

    monkeypatch.setattr(command, "write_accounts_export", fail)
    monkeypatch.setattr(command.json, "dump", fail)
    with pytest.raises(CommandError) as error:
        call_command(
            "import_staffing_xlsx",
            str(source),
            account_password_file=str(secret),
            accounts_export=str(tmp_path / "accounts.xlsx"),
            report=str(tmp_path / "report.json"),
            apply=True,
            stdout=StringIO(),
        )
    assert "Импорт и смена паролей выполнены" in str(error.value)
    assert "выгрузку" in str(error.value) and "JSON" in str(error.value)
    assert PASSWORD not in str(error.value)
    assert Employee.objects.exists()


def test_report_close_failure_does_not_hide_successful_export(
    tmp_path, accounts, monkeypatch
):
    from organization_management.apps.staff_unit.management.commands import (
        import_staffing_xlsx as command,
    )

    original = command.os.fdopen

    class CloseFailure:
        def __init__(self, stream):
            self.stream = stream

        def __getattr__(self, key):
            return getattr(self.stream, key)

        def close(self):
            self.stream.close()
            raise OSError("synthetic close error")

    monkeypatch.setattr(
        command.os, "fdopen", lambda *a, **k: CloseFailure(original(*a, **k))
    )
    target = tmp_path / "accounts.xlsx"
    with pytest.raises(CommandError) as error:
        run(
            tmp_path,
            apply=True,
            accounts_export=str(target),
            report=str(tmp_path / "report.json"),
        )
    assert "Импорт и смена паролей выполнены" in str(error.value)
    assert "Выгрузка сохранена" in str(error.value)
    assert target.exists() and Employee.objects.exists()
