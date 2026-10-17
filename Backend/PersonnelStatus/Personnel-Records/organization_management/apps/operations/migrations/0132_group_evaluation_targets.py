"""Store collective evaluation targets and immutable event roster evidence."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0131_geo_dictionary_lifecycle")]

    operations = [
        migrations.AlterField(
            model_name="opseventevaluation", name="participant_code",
            field=models.CharField(max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="opseventevaluation", name="target_group_code",
            field=models.CharField(max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="opseventevaluation", name="group_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AddField(
            model_name="opsevaluationworkitem", name="group_planned_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AddConstraint(
            model_name="opseventevaluation",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(participant_code__isnull=False, target_group_code__isnull=True)
                    | models.Q(participant_code__isnull=True, target_group_code__isnull=False)
                ), name="chk_ops_evaluation_one_target",
            ),
        ),
        migrations.AddConstraint(
            model_name="opseventevaluation",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(target_group_code__isnull=True, group_snapshot__isnull=True)
                    | models.Q(target_group_code__isnull=False, group_snapshot__isnull=False)
                ), name="chk_ops_evaluation_group_evidence",
            ),
        ),
    ]
