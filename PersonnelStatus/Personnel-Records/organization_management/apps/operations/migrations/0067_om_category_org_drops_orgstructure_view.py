"""Роль-добавка «ОМ по всей организации» больше не несёт `orgstructure.view`.

Plane №372. Роль выдаётся ВТОРЫМ грантом с областью «вся организация», а по
области права `orgstructure.view` считается «Обзор». Пока право входило в
состав роли, третий грант («Обзор на уровне департамента») перебивался вторым,
и начальник управления второго департамента видел в «Обзоре» всю службу — 442
штатные единицы вместо 197 своих (замер по стенду 31.08.2026).

Почему миграцией, а не одной правкой сида: `seed_operations` умеет ДОБАВЛЯТЬ
права роли (`update_or_create`) и намеренно не снимает лишних — иначе он
затирал бы то, что администратор собрал руками на экране «Роли». Значит на
всякой уже засеянной базе (стенд, боевая) право осталось бы жить, а правка
сида чинила бы только новые.

Обратный ход ВОЗВРАЩАЕТ право: откат миграции должен возвращать прежнее
поведение целиком, иначе откатанная база отличалась бы от той, что миграцию
не накатывала.
"""
from django.db import migrations

ROLE = "OM_CATEGORY_ORG"
PERMISSION = "orgstructure.view"


def _drop(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id=ROLE, permission_code_id=PERMISSION
    ).delete()


def _restore(apps, schema_editor):
    Role = apps.get_model("operations", "Role")
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    # Роли или права может не быть вовсе (база, не видевшая сида): тогда
    # возвращать нечего, и это не ошибка.
    if not Role.objects.filter(code=ROLE).exists():
        return
    if not Permission.objects.filter(code=PERMISSION).exists():
        return
    RolePermission.objects.get_or_create(
        role_code_id=ROLE, permission_code_id=PERMISSION
    )


class Migration(migrations.Migration):
    dependencies = [("operations", "0066_placement_sections_dictionary")]

    operations = [migrations.RunPython(_drop, _restore)]
