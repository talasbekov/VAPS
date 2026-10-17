"""`dictionary_value.manage` — «Изменение справочных значений» (UC-REF-001, BR13).

Право самостоятельное: не выводится из `dictionary.manage`, выдаётся ролям
явно. REFERENCE_ADMIN получает его сразу, ADMIN покрыт wildcard `*`.

Миграцией, а не только сидом (прецедент 0126): сид идемпотентен и применился
бы и на засеянной базе, но при обновлении контура автоматически выполняется
только `migrate`, а `bootstrap_contour` — ручной шаг. Строку `Permission`
миграция заводит сама.
"""
from django.db import migrations

PERMISSION = "dictionary_value.manage"
NAME = "Изменение справочных значений"
ROLE = "REFERENCE_ADMIN"


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Role.objects.filter(code=ROLE).exists():
        # База, не видевшая сида, ролей не знает — раскладку заведёт сид.
        return
    Permission.objects.get_or_create(code=PERMISSION, defaults={"name": NAME})
    RolePermission.objects.get_or_create(
        role_code_id=ROLE, permission_code_id=PERMISSION
    )


def _revoke(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(permission_code_id=PERMISSION).delete()
    Permission.objects.filter(code=PERMISSION).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0126_duty_officer_status_manage_root")]

    operations = [migrations.RunPython(_grant, _revoke)]
