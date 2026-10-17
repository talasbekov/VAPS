"""Кадровые статусы попадают в расход (Plane №1209, 12.09.2026).

Источник `PERSONNEL` у факта раздела и БЭКФИЛЛ: действующие и запланированные
кадровые статусы (кроме «в строю») получают проекцию в `ops_employee_statuses`
той же функцией, что и сигнал, — иначе у уже заведённых людей расход остался
бы прежним, а проекция появлялась бы только у новых строк.

Конфликт с жёстким фактом раздела (GiST `excl_hard_status_overlap`) — пропуск с
подсчётом, а не остановка миграции: это данные стенда/прода, и один такой
случай не должен оставить схему без источника `PERSONNEL`. Итог печатается
числами: сколько создано, пропущено, конфликтов.

Обратная миграция снимает строки `PERSONNEL` целиком: у них единственный
писатель, и восстановить их заново может прямой прогон вперёд.
"""
from collections import Counter

from django.db import migrations, models


def _backfill(apps, schema_editor):
    from organization_management.apps.operations.personnel_mirror import (
        mirror_personnel_status,
    )

    EmployeeStatus = apps.get_model("statuses", "EmployeeStatus")
    OpsEmployeeStatus = apps.get_model("operations", "OpsEmployeeStatus")
    StatusType = apps.get_model("operations", "StatusType")

    counts = Counter()
    rows = (
        EmployeeStatus.objects.filter(state__in=["active", "planned"])
        .exclude(status_type="in_service")
        .order_by("pk")
    )
    for row in rows.iterator():
        counts[
            mirror_personnel_status(
                row, ops_status_model=OpsEmployeeStatus, status_type_model=StatusType
            )
        ] += 1
    print(
        "\n    Проекция кадровых статусов в раздел: "
        + ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))
        + (" (кадровых строк не было)" if not counts else "")
    )


def _unbackfill(apps, schema_editor):
    OpsEmployeeStatus = apps.get_model("operations", "OpsEmployeeStatus")
    OpsEmployeeStatus.objects.filter(source="PERSONNEL").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0123_line_heads_submit_day"),
        ("statuses", "0004_alter_employeestatus_status_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="opsemployeestatus",
            name="source",
            field=models.CharField(
                choices=[
                    ("USER", "User"),
                    ("KU_SYNC", "Ku Sync"),
                    ("OM_AUTO", "Om Auto"),
                    ("PERSONNEL", "Personnel"),
                ],
                default="USER",
                max_length=20,
            ),
        ),
        migrations.RunPython(_backfill, _unbackfill),
    ]
