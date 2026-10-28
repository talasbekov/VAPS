from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("operations", "0150_employee_qualifications"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(
        name="OpsObjectInspection",
        fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("created_by", models.CharField(blank=True, max_length=100, null=True)),
            ("inspected_on", models.DateField()),
            ("items", models.JSONField(default=list)),
            ("revision", models.PositiveIntegerField(default=1)),
            ("completed_at", models.DateTimeField(blank=True, null=True)),
            ("request_key", models.CharField(max_length=80)),
            ("request_hash", models.CharField(max_length=64)),
            ("security_object", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="inspections", to="operations.opssecurityobject")),
            ("reviewer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="object_inspections", to=settings.AUTH_USER_MODEL)),
        ],
        options={"db_table": "ops_object_inspections", "verbose_name": "Обследование объекта", "verbose_name_plural": "Обследования объектов", "ordering": ["-inspected_on", "-pk"],
                 "constraints": [models.UniqueConstraint(fields=("reviewer", "request_key"), name="uq_object_inspection_request"),
                                 models.CheckConstraint(condition=models.Q(revision__gte=1), name="chk_object_inspection_revision")]},
    )]

