"""Штаб второго департамента — ОТДЕЛЬНЫЙ актор `OPS_STAFF` (Plane №972,
решение заказчика 08.09.2026: «отдельный Штаб с ролью OPS_STAFF»).

`[ШТБ-01]`–`[ШТБ-04]` (`RAW/README.md`, раздел 21): Штаб — один пользователь
или группа с ролью `OPS_STAFF`; `acc_dir_head_d2` и `acc_dept_head_d2` —
руководство второго департамента, но НЕ Штаб, и «Сбор сил на ОМ» для них
закрыт (№939); ответственный за сбор сил (`FORCES_GATHERING_OFFICER`) Штабом
тоже не является и `forces.command` не получает.

Миграция 0101 (№944) выдала `forces.command` профилю `HEAD_OPS_UNIT`,
прочитав раздел 7.1 так, будто штаб — обе руководящие персоны второго
департамента. Заказчик это отменил разделом 21. 0101 НЕ откатывается и не
правится: её обратный ход вернул бы право ответственному за сбор сил, а это
ошибка ещё старше. Поэтому — новая корректирующая миграция.

ПОЧЕМУ МИГРАЦИЕЙ, А НЕ ПРАВКОЙ СИДА: сид умеет только ДОБАВЛЯТЬ права и
намеренно не снимает лишних — на всякой уже засеянной базе право у профиля
жило бы дальше. Обратный ход возвращает раскладку ПОСЛЕ 0101 (право у
профиля), а не до неё (ответственному ничего не возвращается).
"""
from django.db import migrations

PERMISSION = "forces.command"
STAFF = "OPS_STAFF"
PROFILE = "HEAD_OPS_UNIT"
OFFICER = "FORCES_GATHERING_OFFICER"


def _separate_staff(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        # База, не видевшая сида, прав не знает — раскладку заведёт сид.
        return
    if Role.objects.filter(code=STAFF).exists():
        RolePermission.objects.get_or_create(
            role_code_id=STAFF, permission_code_id=PERMISSION
        )
    RolePermission.objects.filter(
        role_code_id__in=(PROFILE, OFFICER), permission_code_id=PERMISSION
    ).delete()


def _back(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        return
    # Раскладка 0101: право у профиля второго департамента. `OPS_STAFF`
    # право сохраняет — оно у роли с сида, а не с этой миграции.
    if Role.objects.filter(code=PROFILE).exists():
        RolePermission.objects.get_or_create(
            role_code_id=PROFILE, permission_code_id=PERMISSION
        )


class Migration(migrations.Migration):
    dependencies = [("operations", "0107_protected_person_profile")]

    operations = [migrations.RunPython(_separate_staff, _back)]
