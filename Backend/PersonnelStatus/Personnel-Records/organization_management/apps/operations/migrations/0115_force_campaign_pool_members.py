from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("operations", "0114_force_campaign"),
    ]

    operations = [
        migrations.CreateModel(
            name="OpsForceCampaignPoolMember",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=100, null=True)),
                ("employee_key", models.CharField(max_length=40)),
                ("employee_name", models.CharField(blank=True, default="", max_length=255)),
                ("source_event_ids", models.JSONField(default=list)),
                ("campaign", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pool_members", to="operations.opsforcecampaign")),
                ("employee", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="employees.employee")),
            ],
            options={
                "verbose_name": "Сотрудник общего пула мероприятий",
                "verbose_name_plural": "Сотрудники общего пула мероприятий",
                "db_table": "ops_force_campaign_pool_members",
                "ordering": ["created_at", "pk"],
            },
        ),
        migrations.AddConstraint(
            model_name="opsforcecampaignpoolmember",
            constraint=models.UniqueConstraint(fields=("campaign", "employee_key"), name="unique_force_campaign_pool_member"),
        ),
    ]
