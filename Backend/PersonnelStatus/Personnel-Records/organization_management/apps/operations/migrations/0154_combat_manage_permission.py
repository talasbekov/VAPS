from django.db import migrations


def separate_combat_right(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    Permission.objects.get_or_create(code="duty.combat.manage", defaults={"name": "Управление боевыми группами и приём состава штабом"})
    if Role.objects.filter(code="DUTY_OFFICER").exists():
        # Correct the early combat rollout without granting control of legacy
        # duty logs or monthly plans to the dispatch officer.
        RolePermission.objects.filter(role_code_id="DUTY_OFFICER", permission_code_id="duty.manage").delete()
        RolePermission.objects.get_or_create(role_code_id="DUTY_OFFICER", permission_code_id="duty.combat.manage")


class Migration(migrations.Migration):
    dependencies = [("operations", "0153_combat_optional_event_lifecycle")]
    operations = [migrations.RunPython(separate_combat_right, migrations.RunPython.noop)]
