"""Сериализовать номера редакций служебного отчёта (Plane №1125).

JSON scope приводится к канонической строке и хешируется: unique по JSONField
ненадёжен для NULL scope, а порядок id в массиве не должен создавать новую
серию. Старые коллизии редакций разрешаются детерминированно: первое
вхождение сохраняет номер, следующие получают следующий свободный.
"""
import hashlib

from django.db import migrations, models


def _series_key(artifact):
    scope = artifact.scope_division_ids
    scope_key = "*" if scope is None else ",".join(
        str(division_id) for division_id in sorted(scope)
    )
    mode = "S" if artifact.sensitive else "N"
    raw = (
        f"{artifact.report_type_code}|{artifact.param_from}|{artifact.param_to}|"
        f"{mode}|{scope_key}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _backfill_series_keys(apps, schema_editor):
    Artifact = apps.get_model("operations", "OpsServiceReportArtifact")
    by_series = {}
    for artifact in Artifact.objects.all().order_by(
        "report_type_code", "param_from", "param_to", "sensitive", "id"
    ).iterator():
        series_key = _series_key(artifact)
        by_series.setdefault(series_key, []).append(artifact)

    for series_key, artifacts in by_series.items():
        used = set()
        next_revision = 1
        for artifact in sorted(
            artifacts, key=lambda row: (row.revision, row.generated_at, row.id)
        ):
            revision = artifact.revision
            if revision < 1 or revision in used:
                while next_revision in used:
                    next_revision += 1
                revision = next_revision
            used.add(revision)
            next_revision = max(next_revision, revision + 1)
            Artifact.objects.filter(pk=artifact.pk).update(
                series_key=series_key, revision=revision
            )


class Migration(migrations.Migration):
    dependencies = [("operations", "0120_report_job_idempotency_per_actor")]

    operations = [
        migrations.AddField(
            model_name="opsservicereportartifact",
            name="series_key",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.RunPython(_backfill_series_keys, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="opsservicereportartifact",
            name="series_key",
            field=models.CharField(max_length=64),
        ),
        migrations.AddConstraint(
            model_name="opsservicereportartifact",
            constraint=models.UniqueConstraint(
                fields=("series_key", "revision"),
                name="uq_ops_report_artifact_series_revision",
            ),
        ),
    ]
