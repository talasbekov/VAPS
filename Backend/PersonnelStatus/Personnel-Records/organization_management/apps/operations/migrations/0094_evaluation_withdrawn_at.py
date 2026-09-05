"""Отзыв оценки — своё поле, а не слово в ссылке на преемника (Plane №646).

Снятие оценки на этапе «Проведение» (повторный клик по цифре) писалось в
`superseded_by_code` строкой `'withdrawn'`. Кодом оценки она не является:
`_build_chain` разрешал её через `by_code` и получал `None`, а реестр
объявлял такую запись «исправленной» — без преемника и без строки
`OpsEvaluationCorrection`.

Бэкфилл переносит УЖЕ НАКОПЛЕННЫЕ строки: время отзыва берётся из
`updated_at` (когда строку последний раз трогали — а трогал её ровно отзыв),
`superseded_by_code` очищается. Без бэкфилла ограничение ниже не встало бы на
живой базе, а старые строки так и остались бы «исправленными».
"""
from django.db import migrations, models


def withdrawn_to_its_own_field(apps, schema_editor):
    model = apps.get_model("operations", "OpsEventEvaluation")
    rows = model.objects.filter(superseded_by_code="withdrawn")
    moved = 0
    for row in rows.iterator():
        row.withdrawn_at = row.updated_at
        row.superseded_by_code = None
        row.save(update_fields=["withdrawn_at", "superseded_by_code"])
        moved += 1
    print(f"  отозванные оценки переведены в своё поле: {moved}")


def its_own_field_to_withdrawn(apps, schema_editor):
    """Откат возвращает прежний приём — вместе с его дефектом.

    Названо вслух: после отката реестр снова объявит эти записи
    «исправленными». Иначе откат потерял бы сам факт отзыва, а это хуже.
    """
    model = apps.get_model("operations", "OpsEventEvaluation")
    model.objects.filter(withdrawn_at__isnull=False).update(
        superseded_by_code="withdrawn"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0093_notification_dedupe_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="opseventevaluation",
            name="withdrawn_at",
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(
            withdrawn_to_its_own_field, its_own_field_to_withdrawn
        ),
        migrations.AddConstraint(
            model_name="opseventevaluation",
            constraint=models.CheckConstraint(
                condition=~models.Q(superseded_by_code="withdrawn"),
                name="chk_ops_evaluation_superseded_is_a_code",
            ),
        ),
    ]
