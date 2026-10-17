import django.db.models.deletion
import organization_management.apps.operations.legal_document_storage
from django.db import migrations, models


def grant_legal_management(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    Permission.objects.get_or_create(code="legal.manage", defaults={"name": "Управление нормативными документами ОМ"})
    if Role.objects.filter(code="REFERENCE_ADMIN").exists():
        RolePermission.objects.get_or_create(role_code_id="REFERENCE_ADMIN", permission_code_id="legal.manage")


class Migration(migrations.Migration):
    dependencies = [("operations", "0136_duty_dispatch")]

    operations = [
        migrations.AddField(model_name="opslegaldocument", name="version", field=models.PositiveIntegerField(default=1)),
        migrations.AlterField(model_name="opslegaldocument", name="pages", field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.CreateModel(
            name="OpsLegalDocumentFile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("file", models.FileField(max_length=250, storage=organization_management.apps.operations.legal_document_storage.LegalDocumentStorage(), upload_to="")),
                ("original_name", models.CharField(max_length=255)),
                ("content_type", models.CharField(max_length=100)),
                ("size", models.PositiveIntegerField()),
                ("sha256", models.CharField(max_length=64)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="files", to="operations.opslegaldocument")),
            ],
            options={"ordering": ["-created_at", "-id"], "verbose_name": "Файл нормативного документа", "verbose_name_plural": "Файлы нормативных документов"},
        ),
        migrations.RunPython(grant_legal_management, migrations.RunPython.noop),
    ]
