import django.db.models.deletion
from django.db import migrations, models
from organization_management.apps.operations.recon_material_storage import ReconMaterialStorage


class Migration(migrations.Migration):
    dependencies = [("operations", "0132_group_evaluation_targets")]
    operations = [
        migrations.CreateModel(
            name="OpsReconMaterial",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("checklist_item_id", models.CharField(blank=True, default="", max_length=100)),
                ("file", models.FileField(max_length=255, storage=ReconMaterialStorage(), upload_to="recon-materials/")),
                ("original_name", models.CharField(max_length=255)),
                ("content_type", models.CharField(max_length=100)),
                ("size", models.PositiveIntegerField()),
                ("sha256", models.CharField(max_length=64)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="recon_materials", to="operations.opssecurityevent")),
                ("visit_object", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="recon_materials", to="operations.opssecurityeventvisitobject")),
            ],
            options={
                "db_table": "ops_recon_materials",
                "verbose_name": "Материал рекогносцировки",
                "verbose_name_plural": "Материалы рекогносцировки",
                "ordering": ["created_at", "pk"],
                "constraints": [models.CheckConstraint(condition=models.Q(size__gte=1), name="chk_recon_material_size")],
            },
        ),
    ]
