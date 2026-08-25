"""Раскладка потребности по департаментам (Plane №73, шаг «СС-1»).

Бэкфилл — ЧЕСТНЫЙ, а не «лишь бы не пусто»: заявки департаментам у прежних
мероприятий никто не делал, взять их неоткуда. Переносится ровно то, что
однозначно сопоставляется: строка `force_requests`, чья «группа» совпадает с
именем действующего департамента. Всё остальное остаётся пустым — и экран
скажет об этом словами, вместо того чтобы показать выдуманную раскладку.
"""

from django.db import migrations, models


def _forward(apps, schema_editor):
    Division = apps.get_model("divisions", "Division")
    Event = apps.get_model("operations", "OpsSecurityEvent")

    departments = {
        str(name).strip().lower(): (pk, name)
        for pk, name in Division.objects.filter(
            division_type="department", is_active=True
        ).values_list("pk", "name")
    }
    if not departments:
        return

    for event in Event.objects.exclude(force_requests=[]).iterator():
        rows = []
        for index, request in enumerate(event.force_requests or []):
            match = departments.get(str(request.get("group", "")).strip().lower())
            if match is None:
                continue
            pk, name = match
            rows.append(
                {
                    "id": f"force-allocation-{pk}-backfill-{index}",
                    "departmentId": str(pk),
                    "departmentName": name,
                    "need": int(request.get("requestedCount") or 0),
                    "status": "DRAFT",
                    "comment": str(request.get("comment") or ""),
                    "notifiedAt": None,
                    "submittedAt": None,
                    "decidedAt": None,
                    "decisionComment": "",
                    "directorates": [],
                    "members": [],
                }
            )
        rows = [row for row in rows if row["need"] > 0]
        if rows:
            event.force_allocation = rows
            event.save(update_fields=["force_allocation"])


def _backward(apps, schema_editor):
    """Обратная миграция ничего не восстанавливает: поле снимается целиком."""


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0042_approval_snapshot_and_remarks"),
        ("divisions", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="opssecurityevent",
            name="force_allocation",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(_forward, _backward),
    ]
