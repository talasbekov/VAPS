"""Начальники управления заказчика сдают день: миграция 0123 (Plane №1202).

Профили `HEAD_DIRECTORATE_LINE` и `HEAD_OPS_UNIT` — это «Начальник управления»
из матрицы заказчика (№348), и по канону расхода (RAW/README §19–20) именно
он ставит статусы и сдаёт день. Право сдачи (`daily_report.mark_update`) и
правки сданного (`daily_report.correct`) держала только техническая роль
`DIRECTORATE_HEAD`, и персона заказчика на «Сдать день» получала 403.

Миграцией, а не только сидом: сид на засеянной базе сам себя не применит
(та же причина, что у 0110). Реестр — живой, как в соседних пробах миграций.
"""
from importlib import import_module

import pytest
from django.apps import apps
from django.core.management import call_command

from organization_management.apps.operations.models import RolePermission

migration = import_module(
    "organization_management.apps.operations.migrations.0123_line_heads_submit_day"
)

pytestmark = pytest.mark.django_db

PERMISSIONS = ("daily_report.mark_update", "daily_report.correct")
ROLES = ("HEAD_DIRECTORATE_LINE", "HEAD_OPS_UNIT")


def _has(role_code, permission):
    return RolePermission.objects.filter(
        role_code_id=role_code, permission_code_id=permission
    ).exists()


@pytest.fixture
def seeded_without_the_right():
    call_command("seed_operations", "--reference-only")
    RolePermission.objects.filter(
        role_code_id__in=ROLES, permission_code_id__in=PERMISSIONS
    ).delete()


def test_forward_lets_both_line_head_profiles_submit_the_day(seeded_without_the_right):
    migration._grant(apps, None)

    for role in ROLES:
        for permission in PERMISSIONS:
            assert _has(role, permission), f"{role} без {permission} день не сдаст"
    assert _has("DIRECTORATE_HEAD", "daily_report.mark_update"), "техническая роль не тронута"
    assert not _has("HEAD_DEPARTMENT_LINE", "daily_report.mark_update"), (
        "начальник департамента день не сдаёт — сдают управления"
    )


def test_backward_takes_the_right_back_only_from_the_line_heads(seeded_without_the_right):
    migration._grant(apps, None)
    migration._revoke(apps, None)

    for role in ROLES:
        for permission in PERMISSIONS:
            assert not _has(role, permission)
    assert _has("DIRECTORATE_HEAD", "daily_report.mark_update")


def test_forward_is_a_no_op_without_the_permission_catalogue():
    from organization_management.apps.operations.models import Permission, Role

    Permission.objects.filter(code__in=PERMISSIONS).delete()
    for role in ROLES:
        Role.objects.get_or_create(code=role, defaults={"name": role})

    migration._grant(apps, None)

    assert not RolePermission.objects.filter(permission_code_id__in=PERMISSIONS).exists()


def test_forward_renames_the_roles_as_the_customer_calls_them(seeded_without_the_right):
    from organization_management.apps.operations.models import Role

    migration._grant(apps, None)

    assert Role.objects.get(code="HEAD_DIRECTORATE_LINE").name == "Начальник управления (не второй департамент)"
    assert Role.objects.get(code="HEAD_DEPARTMENT_LINE").name == "Начальник департамента (не второй)"
    assert Role.objects.get(code="OPS_STAFF").name == "Штаб второго департамента"
