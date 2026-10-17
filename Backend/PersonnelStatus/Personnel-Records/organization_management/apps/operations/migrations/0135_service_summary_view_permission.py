"""Replace the workspace's literal role gate without widening existing access."""
from django.db import migrations


def grant_existing_duty_role(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    Permission.objects.get_or_create(code="service_summary.view", defaults={"name": "Просмотр свода по Службе"})
    if Role.objects.filter(code="DUTY_OFFICER").exists():
        RolePermission.objects.get_or_create(role_code_id="DUTY_OFFICER", permission_code_id="service_summary.view")


class Migration(migrations.Migration):
    dependencies = [("operations", "0134_duty_status_variants")]
    # Retain subsequently configured custom grants on rollback.
    operations = [migrations.RunPython(grant_existing_duty_role, migrations.RunPython.noop)]
