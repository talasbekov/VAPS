from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0113_visit_object_and_security_object_photo_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="OpsForceCampaign",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, default="", max_length=255)),
                ("code", models.CharField(blank=True, max_length=50, unique=True)),
                ("title", models.CharField(max_length=500)),
                ("status", models.CharField(choices=[("DRAFT", "Черновик"), ("GATHERING", "Сбор пула"), ("DISTRIBUTING", "Распределение"), ("HANDED_OVER", "Передано на расстановку"), ("CLOSED", "Закрыто")], default="DRAFT", max_length=20)),
            ],
            options={
                "verbose_name": "Распределение сил по мероприятиям",
                "verbose_name_plural": "Распределения сил по мероприятиям",
                "db_table": "ops_force_campaigns",
                "ordering": ["-created_at", "-pk"],
            },
        ),
        migrations.CreateModel(
            name="OpsForceCampaignEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("campaign", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="campaign_events", to="operations.opsforcecampaign")),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="force_campaign_links", to="operations.opssecurityevent")),
            ],
            options={
                "verbose_name": "Мероприятие распределения сил",
                "verbose_name_plural": "Мероприятия распределения сил",
                "db_table": "ops_force_campaign_events",
            },
        ),
        migrations.AddConstraint(
            model_name="opsforcecampaignevent",
            constraint=models.UniqueConstraint(fields=("campaign", "event"), name="unique_force_campaign_event"),
        ),
        migrations.CreateModel(
            name="OpsForceCampaignAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("employee_key", models.CharField(max_length=40)),
                ("employee_name", models.CharField(blank=True, default="", max_length=255)),
                ("demand_row_id", models.CharField(max_length=160)),
                ("kind_code", models.CharField(max_length=60)),
                ("override_reason", models.TextField(blank=True, default="")),
                ("assigned_by", models.CharField(blank=True, default="", max_length=255)),
                ("campaign", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="assignments", to="operations.opsforcecampaign")),
                ("employee", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="employees.employee")),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="force_campaign_assignments", to="operations.opssecurityevent")),
                ("visit_object", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="force_campaign_assignments", to="operations.opssecurityeventvisitobject")),
            ],
            options={
                "verbose_name": "Назначение сотрудника из общего пула",
                "verbose_name_plural": "Назначения сотрудников из общего пула",
                "db_table": "ops_force_campaign_assignments",
                "ordering": ["created_at", "pk"],
            },
        ),
        migrations.CreateModel(
            name="OpsForceCampaignHandover",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("comment", models.TextField(blank=True, default="")),
                ("handed_by", models.CharField(blank=True, default="", max_length=255)),
                ("campaign", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="handovers", to="operations.opsforcecampaign")),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="force_campaign_handovers", to="operations.opssecurityevent")),
            ],
            options={
                "verbose_name": "Передача общего пула в расстановку",
                "verbose_name_plural": "Передачи общего пула в расстановку",
                "db_table": "ops_force_campaign_handovers",
                "ordering": ["created_at", "pk"],
            },
        ),
        migrations.AddConstraint(
            model_name="opsforcecampaignhandover",
            constraint=models.UniqueConstraint(fields=("campaign", "event"), name="unique_force_campaign_handover"),
        ),
    ]
