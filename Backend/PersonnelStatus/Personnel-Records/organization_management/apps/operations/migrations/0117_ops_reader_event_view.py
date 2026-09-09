"""Restore existing observer's read-only OM registry access (Plane №1087)."""
from django.db import migrations


def grant_event_view(apps, schema_editor):
    # OPS_READER was removed from the seed. Preserve that decision: only
    # repair installations that still carry the walkthrough observer role.
    Role = apps.get_model("operations", "Role")
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Role.objects.filter(code="OPS_READER").exists():
        return
    permission, _ = Permission.objects.get_or_create(
        code="event.view", defaults={"name": "Просмотр охранных мероприятий"}
    )
    RolePermission.objects.get_or_create(
        role_code_id="OPS_READER", permission_code_id=permission.pk
    )


def revoke_event_view(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id="OPS_READER", permission_code_id="event.view"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0116_force_campaign_reserve")]
    operations = [migrations.RunPython(grant_event_view, revoke_event_view)]
