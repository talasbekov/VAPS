"""Начальники управления заказчика сдают день (Plane №1202, 12.09.2026).

Профили `HEAD_DIRECTORATE_LINE` и `HEAD_OPS_UNIT` — «Начальник управления» из
матрицы заказчика (№348). По канону расхода (RAW/README §19–20) именно он
ставит статусы своему управлению и сдаёт день, но право сдачи
(`daily_report.mark_update`) и правки сданного (`daily_report.correct`) держала
только техническая `DIRECTORATE_HEAD`, и персона заказчика на «Сдать день»
получала 403. Заодно роли переименованы так, как их называет заказчик в
учётках: «Начальник управления (не второй департамент)», «Начальник
департамента (не второй)», «Штаб второго департамента».

Миграцией, а не только сидом: сид права только добавляет и на уже засеянной
базе (в том числе в закрытой сети) сам себя не применит — та же причина, что
у 0110. Область гранта эта миграция не трогает: её задаёт выдача роли.
"""
from django.db import migrations

PERMISSIONS = ("daily_report.mark_update", "daily_report.correct")
ROLES = ("HEAD_DIRECTORATE_LINE", "HEAD_OPS_UNIT")
RENAMES = {
    "HEAD_DIRECTORATE_LINE": (
        "Начальник управления (линейный департамент)",
        "Начальник управления (не второй департамент)",
    ),
    "HEAD_DEPARTMENT_LINE": (
        "Начальник департамента (линейный)",
        "Начальник департамента (не второй)",
    ),
    "OPS_STAFF": ("Штаб сбора сил", "Штаб второго департамента"),
}


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    for code, (_, new_name) in RENAMES.items():
        Role.objects.filter(code=code).update(name=new_name)
    known = set(
        Permission.objects.filter(code__in=PERMISSIONS).values_list("code", flat=True)
    )
    if not known:
        # База, не видевшая сида, прав не знает — раскладку заведёт сид.
        return
    for role in ROLES:
        if not Role.objects.filter(code=role).exists():
            continue
        for permission in PERMISSIONS:
            if permission in known:
                RolePermission.objects.get_or_create(
                    role_code_id=role, permission_code_id=permission
                )


def _revoke(apps, schema_editor):
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id__in=ROLES, permission_code_id__in=PERMISSIONS
    ).delete()
    for code, (old_name, _) in RENAMES.items():
        Role.objects.filter(code=code).update(name=old_name)


class Migration(migrations.Migration):
    dependencies = [("operations", "0122_merge_20260910_1238")]

    operations = [migrations.RunPython(_grant, _revoke)]
