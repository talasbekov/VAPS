"""`status.manage` выдаётся `FORCES_GATHERING_OFFICER` (Plane №991, задача
заказчика — основная проходка ежедневного расхода).

Ответственный за сбор сил до этого мог сдать управлениям чужой собранный
день, но не поставить статус лично: сценарий заказчика требует, чтобы он сам
правил статус личному составу СВОЕГО департамента на время сборов, а ручка
отвечала 403 — права не было вовсе.

Миграцией, а не только правкой сида: сид права только добавляет, и на уже
засеянной базе сам себя не применит. Область гранта (департамент, а не вся
организация) эта миграция не резолвит — ею занимается сама выдача роли
(`RoleAdminService.assign_role` со `scope_division_id`); здесь только право
роли, как и в прежней `0105_head_ops_unit_gvo_manage`.
"""
from django.db import migrations

PERMISSION = "status.manage"
ROLE = "FORCES_GATHERING_OFFICER"


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        # База, не видевшая сида, прав не знает — раскладку заведёт сид.
        return
    if Role.objects.filter(code=ROLE).exists():
        RolePermission.objects.get_or_create(
            role_code_id=ROLE, permission_code_id=PERMISSION
        )


def _revoke(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id=ROLE, permission_code_id=PERMISSION
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0109_owner_actor_id_only_accounts")]

    operations = [migrations.RunPython(_grant, _revoke)]
