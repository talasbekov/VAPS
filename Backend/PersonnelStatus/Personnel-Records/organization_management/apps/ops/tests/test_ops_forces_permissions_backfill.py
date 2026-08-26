"""Бэкфилл 0047: права цепочки «Сбор сил на ОМ» (Plane №74).

Проба стережёт ровно то свойство, потеря которого превращает разграничение
ответственности в аварию: роль, которая ВЕЛА цепочку через `event.manage`,
после миграции сохраняет к ней доступ — теперь через четыре новых кода. Роль,
у которой `event.manage` не было, новых прав НЕ получает: иначе миграция
раздала бы цепочку тем, кому её никогда не давали.
"""
import importlib

import pytest

from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)

from django.apps import apps as django_apps

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0047_forces_chain_permissions"
)

pytestmark = pytest.mark.django_db

NEW_CODES = {
    "forces.command",
    "forces.allocate",
    "forces.select",
    "placement.manage",
}


def grant(role_code, permission_code):
    Role.objects.get_or_create(code=role_code, defaults={"name": role_code})
    Permission.objects.get_or_create(
        code=permission_code, defaults={"name": permission_code}
    )
    RolePermission.objects.get_or_create(
        role_code_id=role_code, permission_code_id=permission_code
    )


def codes_of(role_code):
    return set(
        RolePermission.objects.filter(role_code_id=role_code).values_list(
            "permission_code_id", flat=True
        )
    )


def test_backfill_keeps_the_chain_for_roles_that_led_it():
    grant("EVENT_LEAD", "event.manage")
    # Соседняя роль ведёт статусы, но не мероприятия — цепочка ей не давалась.
    grant("STATUS_ONLY", "status.manage")

    MIGRATION.forwards(django_apps, None)

    assert NEW_CODES <= codes_of("EVENT_LEAD"), (
        "роль, которая вела цепочку, потеряла к ней доступ — это авария, "
        "а не разграничение"
    )
    assert not (NEW_CODES & codes_of("STATUS_ONLY")), (
        "цепочка роздана роли, которой её никогда не давали"
    )


def test_backfill_registers_every_new_permission_in_the_catalog():
    MIGRATION.forwards(django_apps, None)

    known = set(Permission.objects.values_list("code", flat=True))
    assert NEW_CODES <= known
    # Подписи человеческие: экран «Права» показывает их человеку как есть.
    for row in Permission.objects.filter(code__in=NEW_CODES):
        assert row.name.strip() != "" and row.name != row.code


def test_backfill_runs_twice_without_duplicating():
    grant("EVENT_LEAD", "event.manage")

    MIGRATION.forwards(django_apps, None)
    MIGRATION.forwards(django_apps, None)

    for code in NEW_CODES:
        assert (
            RolePermission.objects.filter(
                role_code_id="EVENT_LEAD", permission_code_id=code
            ).count()
            == 1
        )


def test_backwards_returns_the_state_to_before():
    grant("EVENT_LEAD", "event.manage")

    MIGRATION.forwards(django_apps, None)
    MIGRATION.backwards(django_apps, None)

    assert not (NEW_CODES & codes_of("EVENT_LEAD"))
    assert not (NEW_CODES & set(Permission.objects.values_list("code", flat=True)))
    # Исходное право не задето: откат снимает СВОЁ, а не чужое.
    assert "event.manage" in codes_of("EVENT_LEAD")
