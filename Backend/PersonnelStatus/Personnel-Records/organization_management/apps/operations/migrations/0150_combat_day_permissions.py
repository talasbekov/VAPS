from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    Division = apps.get_model("divisions", "Division")
    Type = apps.get_model("operations", "OpsCombatDutyType")
    for code, name in [("duty.roster", "Формирование боевых групп своего подразделения"), ("duty.catalog.manage", "Справочники боевого дежурства своего подразделения"), ("duty.combat.manage", "Управление боевыми группами и приём состава штабом")]:
        Permission.objects.get_or_create(code=code, defaults={"name": name})
    for role in Role.objects.filter(code__in=["HEAD_DEPARTMENT_LINE", "HEAD_DIRECTORATE_LINE", "DIRECTORATE_HEAD", "HEAD_OPS_UNIT", "DUTY_PLANNER"]):
        for code in ("duty.view", "duty.roster", "duty.catalog.manage"):
            if Permission.objects.filter(code=code).exists():
                RolePermission.objects.get_or_create(role_code=role, permission_code_id=code)
    if Role.objects.filter(code="DUTY_OFFICER").exists():
        RolePermission.objects.get_or_create(role_code_id="DUTY_OFFICER", permission_code_id="duty.combat.manage")
    for division in Division.objects.filter(is_active=True, division_type__in=["department", "directorate"]):
        for code, name, rest in [("DAY", "Дневное", False), ("NIGHT", "Ночное", False), ("DAILY", "Суточное", True)]:
            Type.objects.get_or_create(division=division, duty_type_code=code, defaults={"safe_label": name, "shift_kind": code, "rest_day_after": rest, "supports_multiple_routes": False})


class Migration(migrations.Migration):
    dependencies = [("operations", "0149_combat_owned_places")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
