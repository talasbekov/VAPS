"""Штаб — отдельный актор `OPS_STAFF`: миграция 0108 (Plane №972, `[ШТБ-01]`–`[ШТБ-04]`).

ЗАЧЕМ ПРОБА, ЕСЛИ РАСКЛАДКУ ЗАДАЁТ СИД. Сид умеет только ДОБАВЛЯТЬ права и
намеренно не снимает лишних (об этом же — 0101). На всякой уже засеянной базе
`forces.command` у `HEAD_OPS_UNIT` живёт, пока его не снимет миграция, — и
именно её РЕШЕНИЕ стережёт проба: кому право снято, кому оставлено и кому НЕ
возвращено. Обратный ход 0108 обязан вернуть раскладку 0101, а не более
старую: 0101 сняла право с ответственного за сбор сил, и откат 0108 не должен
его воскрешать.

Реестр — живой (`django.apps.apps`), а не исторический через `MigrationExecutor`:
прогон схемы назад-вперёд по общей тестовой базе уронил бы чужой прогон (замок
`scripts/pytest-lock.sh` заведён ровно поэтому). Модели `Role`, `Permission`,
`RolePermission` с 0101 не менялись, поэтому живой реестр здесь честен.
"""
from importlib import import_module

import pytest
from django.apps import apps
from django.core.management import call_command

from organization_management.apps.operations.models import RolePermission

migration = import_module(
    "organization_management.apps.operations.migrations.0108_ops_staff_separate_actor"
)

pytestmark = pytest.mark.django_db

PERMISSION = "forces.command"


def _has(role_code: str) -> bool:
    return RolePermission.objects.filter(
        role_code_id=role_code, permission_code_id=PERMISSION
    ).exists()


@pytest.fixture
def base_after_0101():
    """База, засеянная и доведённая миграцией 0101: право у профиля второго
    департамента, у ответственного — снято, у `OPS_STAFF` — как в сиде."""
    call_command("seed_operations")
    RolePermission.objects.get_or_create(
        role_code_id="HEAD_OPS_UNIT", permission_code_id=PERMISSION
    )
    RolePermission.objects.filter(
        role_code_id="FORCES_GATHERING_OFFICER", permission_code_id=PERMISSION
    ).delete()


def test_forward_leaves_the_staff_right_only_to_the_separate_actor(base_after_0101):
    migration._separate_staff(apps, None)

    assert not _has("HEAD_OPS_UNIT"), "начальник второго департамента остался Штабом"
    assert _has("OPS_STAFF"), "Штаб без `forces.command` цепочку не откроет (`[ШТБ-04]`)"
    assert not _has("FORCES_GATHERING_OFFICER"), "ответственному право не возвращено (`[ШТБ-03]`)"


def test_backward_restores_0101_and_does_not_resurrect_the_officer(base_after_0101):
    migration._separate_staff(apps, None)
    migration._back(apps, None)

    assert _has("HEAD_OPS_UNIT")
    assert _has("OPS_STAFF")
    assert not _has("FORCES_GATHERING_OFFICER"), (
        "откат 0108 вернул раскладку ДО 0101, а не после неё"
    )


def test_forward_is_a_no_op_on_a_base_that_never_saw_the_seed():
    """База без прав раскладку получит от сида; миграция ничего не выдумывает."""
    migration._separate_staff(apps, None)

    assert not RolePermission.objects.filter(permission_code_id=PERMISSION).exists()
