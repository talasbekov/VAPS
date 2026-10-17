"""Separate the personnel screen from data reads; add a read-only integration role."""
from django.db import migrations


def add_workspaces_and_integration(apps, schema_editor):
    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    for code, name in (
        ("status.workspace", "Рабочее место статусов сотрудников"),
        ("digital_twin.read", "Чтение обезличенных данных Цифровым двойником"),
    ):
        Permission.objects.using(alias).get_or_create(code=code, defaults={"name": name})
    readers = RolePermission.objects.using(alias).filter(permission_code_id="status.view").exclude(
        role_code_id__in=["DUTY_OFFICER", "INTEGRATION_USER"]
    ).values_list("role_code_id", flat=True)
    for code in list(readers.distinct()):
        RolePermission.objects.using(alias).get_or_create(role_code_id=code, permission_code_id="status.workspace")
    Role.objects.using(alias).get_or_create(
        code="DIGITAL_TWIN_READER", defaults={"name": "Цифровой двойник: чтение объектов и численности"}
    )
    RolePermission.objects.using(alias).get_or_create(
        role_code_id="DIGITAL_TWIN_READER", permission_code_id="digital_twin.read"
    )


class Migration(migrations.Migration):
    dependencies = [("operations", "0143_duty_creation_closure")]
    # Never erase permissions or custom grants configured after this migration.
    operations = [migrations.RunPython(add_workspaces_and_integration, migrations.RunPython.noop)]
