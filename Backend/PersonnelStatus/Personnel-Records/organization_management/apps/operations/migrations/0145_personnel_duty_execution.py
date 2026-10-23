from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0144_workspace_and_digital_twin_access")]

    operations = [
        migrations.AddField(model_name="opsdutyrecordsupplement", name="source_key",
            field=models.CharField(max_length=64, blank=True, default="")),
        migrations.AddField(model_name="opsdutyrecordsupplement", name="source_snapshot",
            field=models.JSONField(default=dict, blank=True)),
        migrations.RemoveConstraint(model_name="opsdutyrecordsupplement", name="uniq_duty_supplement_source"),
        migrations.RemoveConstraint(model_name="opsdutyrecordsupplement", name="chk_duty_supplement_source"),
        migrations.AddConstraint(model_name="opsdutyrecordsupplement",
            constraint=models.UniqueConstraint(fields=["source_type", "source_id", "source_key"], name="uniq_duty_supplement_source")),
        migrations.AddConstraint(model_name="opsdutyrecordsupplement", constraint=models.CheckConstraint(
            condition=models.Q(source_type__in=("DISPATCH", "PLAN", "STATUS")), name="chk_duty_supplement_source")),
        migrations.AddConstraint(model_name="opsdutyrecordsupplement", constraint=models.CheckConstraint(
            condition=(models.Q(source_type="STATUS", source_key__regex=r"^[0-9a-f]{64}$",
                source_snapshot__has_keys=["source_id", "employee_id", "placement", "date_start", "date_end", "planned_start", "planned_end"])
                | (~models.Q(source_type="STATUS") & models.Q(source_key="", source_snapshot={}))), name="chk_duty_supplement_key")),
    ]
