"""`status.manage_root` — новое право «Статусы руководству Службы» — выдаётся
`DUTY_OFFICER` (Plane №1223, решение заказчика 12.09.2026, RAW/README §23
`[РАСХ-РШ-07]`).

Дежурный до этого статусы не правил вовсе (`[РАСХ-05]`); теперь правит
только сотрудникам, прикреплённым к корню организации напрямую. Не
`status.manage` с областью «корень»: область гранта — поддерево, и корень
накрыл бы всю Службу. Ручки статусов принимают код как второй и добавляют к
области ровно корень.

Миграцией, а не только сидом: сид на уже засеянной базе сам себя не
применит. В отличие от 0110, право НОВОЕ — строку `Permission` миграция
заводит сама, иначе на стенде грант было бы не к чему привязать.
"""
from django.db import migrations

PERMISSION = "status.manage_root"
NAME = "Статусы руководству Службы"
ROLE = "DUTY_OFFICER"


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
    dependencies = [("operations", "0125_notification_kind_summary_sent")]

    operations = [migrations.RunPython(_grant, _revoke)]
