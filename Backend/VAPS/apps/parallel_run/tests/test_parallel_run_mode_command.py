"""Story 7.7/AC-2 — переключатель режима: management-команда.

``--actor`` обязателен для мутирующих подкоманд (ревью-фикс — audit trail);
``add-pilot`` требует реально существующее подразделение (ревью-фикс —
typo'd UUID больше не создаёт молчаливо бесполезное исключение)."""

import io
import uuid

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.audit.models import AuditLog
from apps.core import parallel_run_mode
from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


def run(*args):
    out = io.StringIO()
    call_command("parallel_run_mode", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-PRM-CMD")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="PRM-CMD-A"
    )


def test_enable_disable_status():
    assert "enabled=False" in run("status")
    run("enable", "--actor", "bratan")
    assert parallel_run_mode.is_enabled() is True
    assert "enabled=True" in run("status")
    run("disable", "--actor", "bratan")
    assert parallel_run_mode.is_enabled() is False


def test_enable_disable_are_audited():
    run("enable", "--actor", "bratan")
    run("disable", "--actor", "bratan")
    actions = list(
        AuditLog.objects.filter(entity_type="parallel_run_mode").values_list(
            "action", "actor_user_id"
        )
    )
    assert ("PARALLEL_RUN_MODE_ENABLED", "bratan") in actions
    assert ("PARALLEL_RUN_MODE_DISABLED", "bratan") in actions


def test_enable_requires_actor():
    with pytest.raises(CommandError):
        call_command("parallel_run_mode", "enable")


def test_add_remove_pilot(division):
    run("add-pilot", str(division.id), "--actor", "bratan")
    assert parallel_run_mode.is_pilot_division(division.id) is True
    assert "pilot_divisions=1" in run("status")
    run("remove-pilot", str(division.id), "--actor", "bratan")
    assert parallel_run_mode.is_pilot_division(division.id) is False


def test_add_pilot_audited(division):
    run("add-pilot", str(division.id), "--actor", "bratan")
    assert AuditLog.objects.filter(
        entity_type="parallel_run_mode",
        action="PARALLEL_RUN_PILOT_DIVISION_ADDED",
        entity_id=division.id,
        actor_user_id="bratan",
    ).exists()


def test_add_pilot_nonexistent_division_rejected():
    with pytest.raises(CommandError):
        run("add-pilot", str(uuid.uuid4()), "--actor", "bratan")


def test_invalid_uuid_raises():
    with pytest.raises(CommandError):
        call_command(
            "parallel_run_mode", "add-pilot", "not-a-uuid", "--actor", "bratan"
        )
