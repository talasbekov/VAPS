import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0148_assistant_connection"), ("divisions", "0001_initial")]
    operations = [migrations.CreateModel(
        name="OpsDutyTemplate",
        fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("created_by", models.CharField(blank=True, max_length=100, null=True)),
            ("owner_actor", models.CharField(max_length=100)),
            ("owner_division", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="duty_templates", to="divisions.division")),
            ("name", models.CharField(max_length=120)),
            ("name_key", models.CharField(max_length=240)),
            ("kind", models.CharField(max_length=100)),
            ("start_time", models.CharField(max_length=5)),
            ("duration_minutes", models.PositiveIntegerField()),
            ("time_zone", models.CharField(max_length=100)),
            ("location_label", models.CharField(blank=True, default="", max_length=500)),
            ("document_basis", models.CharField(blank=True, default="", max_length=500)),
            ("note", models.TextField(blank=True, default="")),
            ("revision", models.PositiveIntegerField(default=1)),
            ("is_active", models.BooleanField(default=True)),
            ("create_hash", models.CharField(max_length=64)),
            ("updated_by", models.CharField(max_length=100)),
        ],
        options={"db_table": "ops_duty_templates", "verbose_name": "Шаблон дежурства", "verbose_name_plural": "Шаблоны дежурств",
                 "constraints": [
                     models.UniqueConstraint(fields=("owner_actor", "time_zone", "name_key"), condition=models.Q(owner_division__isnull=True, is_active=True), name="uniq_personal_duty_template"),
                     models.UniqueConstraint(fields=("owner_division", "time_zone", "name_key"), condition=models.Q(owner_division__isnull=False, is_active=True), name="uniq_shared_duty_template"),
                     models.CheckConstraint(condition=models.Q(revision__gte=1), name="chk_duty_template_revision"),
                     models.CheckConstraint(condition=models.Q(duration_minutes__gte=1, duration_minutes__lte=527040), name="chk_duty_template_duration"),
                 ]},
    )]

