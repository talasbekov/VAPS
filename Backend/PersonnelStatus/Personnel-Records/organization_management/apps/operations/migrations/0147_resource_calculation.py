import django.db.models.deletion
from django.db import migrations, models


def seed_metadata(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    alias = schema_editor.connection.alias
    # Empty installations have not run the reference seed yet. Existing
    # event.view metadata is left unchanged on an already configured system.
    for code, name in (("event.view", "Просмотр охранных мероприятий"), ("resource_calculation.view", "Просмотр расчёта сил и средств"), ("resource_calculation.manage", "Ведение расчёта сил и средств")):
        Permission.objects.using(alias).get_or_create(code=code, defaults={"name": name})
    _, created = Role.objects.using(alias).get_or_create(code="RESOURCE_CALCULATION_PLANNER", defaults={"name": "Планировщик расчёта сил и средств"})
    # A custom role may already use this code and have live assignments.
    # Automatic migration must never widen an existing role's grants.
    if not created:
        return
    for code in ("event.view", "resource_calculation.view", "resource_calculation.manage"):
        RolePermission.objects.using(alias).get_or_create(role_code_id="RESOURCE_CALCULATION_PLANNER", permission_code_id=code)


class Migration(migrations.Migration):
    dependencies = [("operations", "0146_om_assistant_tasks"), ("divisions", "0001_initial")]
    operations = [
        migrations.CreateModel(
            name="OpsResourceCalculation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("document", models.JSONField(default=dict)),
                ("snapshot", models.JSONField(default=dict)),
                ("version", models.PositiveIntegerField(default=1)),
                ("updated_by", models.CharField(max_length=100)),
                ("event", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="resource_calculation", to="operations.opssecurityevent")),
                ("owner_division", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="resource_calculations", to="divisions.division")),
            ],
            options={"db_table": "ops_resource_calculations", "verbose_name": "Расчёт сил и средств", "verbose_name_plural": "Расчёты сил и средств", "constraints": [models.CheckConstraint(condition=models.Q(version__gte=1), name="chk_resource_calc_version")]},
        ),
        migrations.RunPython(seed_metadata, migrations.RunPython.noop),
    ]
