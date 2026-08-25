"""Состав мероприятия — люди, принятые штабом (Plane №73, шаг «СС-5»).

Бэкфилл: у мероприятий, где расстановка уже идёт, состав ЕСТЬ по факту — это
расставленные люди. Пустой состав у идущего ОМ запер бы ему расстановку
(кандидаты берутся из состава, шаг «СС-6»), то есть новая сущность сломала бы
уже заведённое.
"""

from django.db import migrations, models


def _forward(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")

    for event in Event.objects.exclude(placement_assignments=[]).iterator():
        seen = set()
        roster = []
        for assignment in event.placement_assignments or []:
            key = str(assignment.get("employeeId") or "")
            if key == "" or key in seen:
                continue
            seen.add(key)
            roster.append(
                {
                    "employeeId": key,
                    "name": assignment.get("employeeName", ""),
                    "divisionId": None,
                    "divisionName": "",
                    "departmentId": None,
                    "departmentName": "",
                    # Момента приёмки у них не было — состав выведен из
                    # расстановки, и врать про время решения штаба нельзя.
                    "acceptedAt": None,
                }
            )
        if roster:
            event.force_roster = roster
            event.save(update_fields=["force_roster"])


def _backward(apps, schema_editor):
    """Обратная миграция ничего не восстанавливает: поле снимается целиком."""


class Migration(migrations.Migration):

    dependencies = [("operations", "0043_force_allocation")]

    operations = [
        migrations.AddField(
            model_name="opssecurityevent",
            name="force_roster",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(_forward, _backward),
    ]
