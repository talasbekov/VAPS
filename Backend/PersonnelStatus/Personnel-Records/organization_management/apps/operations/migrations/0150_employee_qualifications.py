import uuid
import django.db.models.deletion
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0149_duty_templates"),
        ("employees", "0008_employee_service_profile_verbose_names"),
    ]
    operations = [migrations.CreateModel(
        name="OpsEmployeeQualification",
        fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("skill", models.CharField(choices=[("shooting", "Стрельба"), ("hand_to_hand", "Рукопашный бой"), ("physical_fitness", "Физическая подготовка")], max_length=32)),
            ("score", models.PositiveSmallIntegerField()),
            ("assessed_on", models.DateField()),
            ("valid_until", models.DateField(blank=True, null=True)),
            ("basis", models.CharField(max_length=1000)),
            ("recorded_by", models.CharField(editable=False, max_length=100)),
            ("recorded_by_name", models.CharField(editable=False, max_length=150)),
            ("request_key", models.CharField(editable=False, max_length=80)),
            ("request_hash", models.CharField(editable=False, max_length=64)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("employee", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="qualification_assessments", to="employees.employee")),
        ],
        options={
            "db_table": "ops_employee_qualifications",
            "verbose_name": "Проверка квалификации сотрудника",
            "verbose_name_plural": "Проверки квалификации сотрудников",
            "ordering": ["-assessed_on", "-created_at", "-id"],
            "indexes": [models.Index(fields=["employee", "skill", "-assessed_on"], name="idx_qualification_skill_date")],
            "constraints": [
                models.UniqueConstraint(fields=("employee", "request_key"), name="uniq_qualification_request"),
                models.CheckConstraint(condition=models.Q(score__gte=1, score__lte=5), name="chk_qualification_score"),
                models.CheckConstraint(condition=models.Q(valid_until__isnull=True) | models.Q(valid_until__gte=models.F("assessed_on")), name="chk_qualification_period"),
            ],
        },
    )]

