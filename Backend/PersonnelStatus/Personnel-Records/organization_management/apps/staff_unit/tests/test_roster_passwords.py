import json
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.staff_unit.tests.test_roster_xlsx import (
    sample,
    workbook,
)

pytestmark = pytest.mark.django_db
PASSWORD = "Synthetic-only_1187"


@pytest.fixture
def accounts():
    users = get_user_model()
    return [
        users.objects.create_user(username="outside-roster", password="old-one"),
        users.objects.create_superuser(username="reset-admin", password="old-two"),
        users.objects.create_user(
            username="inactive-reset", password=None, is_active=False
        ),
    ]


def run(tmp_path, *, rows=None, password=PASSWORD, **options):
    path = workbook(tmp_path, rows if rows is not None else [sample()])
    secret = tmp_path / "password.txt"
    secret.write_text(password)
    out = StringIO()
    call_command(
        "import_staffing_xlsx",
        str(path),
        account_password_file=str(secret),
        stdout=out,
        **options,
    )
    assert PASSWORD not in out.getvalue()
    return out.getvalue()


def test_all_accounts_reset_preserving_access_and_repeat_hashes(tmp_path, accounts):
    users = get_user_model()
    fields = ["pk", "username", "is_active", "is_staff", "is_superuser"]
    before = list(users.objects.order_by("pk").values_list(*fields))
    report = tmp_path / "applied.json"
    run(tmp_path, apply=True, report=str(report))
    assert list(users.objects.order_by("pk").values_list(*fields)) == before
    assert all(u.check_password(PASSWORD) for u in users.objects.all())
    hashes = list(users.objects.order_by("pk").values_list("password", flat=True))
    assert len(set(hashes)) == len(hashes)
    summary = json.loads(report.read_text())["password_reset"]
    assert summary == {
        "scope": "all",
        "accounts": len(before),
        "updated": len(before),
        "unchanged": 0,
    }
    audit = OpsAuditLog.objects.filter(action="ACCESS_ACCOUNT_PASSWORD_RESET")
    assert audit.count() == len(before)
    assert PASSWORD not in str(list(audit.values())) + report.read_text()
    assert all(h not in report.read_text() for h in hashes)
    second = tmp_path / "repeated.json"
    run(tmp_path, apply=True, report=str(second))
    assert (
        list(users.objects.order_by("pk").values_list("password", flat=True)) == hashes
    )
    assert audit.count() == len(before)
    assert json.loads(second.read_text())["password_reset"]["updated"] == 0


@pytest.mark.parametrize("check_file", [False, True])
def test_preview_never_changes_passwords(tmp_path, accounts, check_file):
    users = get_user_model()
    before = list(users.objects.values_list("pk", "password"))
    run(tmp_path, check_file=check_file)
    assert list(users.objects.values_list("pk", "password")) == before
    assert not Employee.objects.exists()
    assert not OpsAuditLog.objects.filter(
        action="ACCESS_ACCOUNT_PASSWORD_RESET"
    ).exists()


def test_invalid_roster_does_not_reset_passwords(tmp_path, accounts):
    before = list(get_user_model().objects.values_list("pk", "password"))
    with pytest.raises(CommandError):
        run(tmp_path, rows=[sample(iin="short")], apply=True)
    assert list(get_user_model().objects.values_list("pk", "password")) == before


def test_without_password_option_accounts_are_unchanged(tmp_path, accounts):
    before = list(get_user_model().objects.values_list("pk", "password"))
    call_command(
        "import_staffing_xlsx",
        str(workbook(tmp_path, [sample()])),
        apply=True,
        stdout=StringIO(),
    )
    assert list(get_user_model().objects.values_list("pk", "password")) == before


def test_password_save_failure_rolls_back_accounts_and_roster(
    tmp_path, accounts, monkeypatch
):
    users = get_user_model()
    original = users.save
    before = list(users.objects.values_list("pk", "password"))

    def fail_second(user, *args, **kwargs):
        if user.pk == accounts[1].pk:
            raise DatabaseError("synthetic save error")
        return original(user, *args, **kwargs)

    monkeypatch.setattr(users, "save", fail_second)
    with pytest.raises(CommandError, match="Транзакция"):
        run(tmp_path, apply=True)
    assert list(users.objects.values_list("pk", "password")) == before
    assert not Employee.objects.exists()
    assert not OpsAuditLog.objects.filter(
        action="ACCESS_ACCOUNT_PASSWORD_RESET"
    ).exists()


@pytest.mark.parametrize("password", ["", "\n", "multiple\nlines", "x" * 1025])
def test_invalid_password_file_rejected_before_import(tmp_path, accounts, password):
    before = list(get_user_model().objects.values_list("pk", "password"))
    with pytest.raises(CommandError, match="парол"):
        run(tmp_path, password=password, apply=True)
    assert list(get_user_model().objects.values_list("pk", "password")) == before
    assert not Employee.objects.exists()
