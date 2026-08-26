"""Бэкфилл: провести заведённые ОМ через «Потребность» и «Запрос сил» (Plane №110).

Заказчик снял с шага «Расстановка» боксы «подготовка расчёта» и «выделение
сил» — форм, которыми человек вёл стадии `DEMAND` и `FORCES`, на клиенте
больше нет. Новые мероприятия проводит через них сервер, на завершении
рекогносцировки.

Уже заведённым это не помогает: они стоят на снятых стадиях, и двигать их
дальше было бы НЕЧЕМ — кнопок «утвердить потребность» и «завершить выделение»
не существует. Здесь они разово доводятся до «Расстановки» тем же правилом.

Потребность собирается из расчёта постов рекогносцировки; уже утверждённые
строки НЕ затираются — у мероприятия, которое человек успел провести руками,
это его решение, и подменять его расчётом значило бы переписать чужую работу.

Запись в журнал переходов делается: стадии были пройдены, и лента обязана это
показать. Вид перехода — `FORWARD`, движение вперёд по порядку стадий.

Обратной операции нет: вернуть ОМ на снятую стадию значит запереть его в
интерфейсе, у которого нет формы этой стадии.
"""
from django.db import migrations

from organization_management.apps.operations.clock import Clock

STAGE_READINESS_PLACEMENT = 60


def forwards(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    Transition = apps.get_model("operations", "OpsSecurityEventTransition")
    # Время раздела берётся у Clock, а не у настенных часов: иначе этот путь
    # начнёт жить в другом дне, чем всё остальное (сторож дисциплины часов).
    now = Clock.now()
    for event in OpsSecurityEvent.objects.filter(
        stage__in=("DEMAND", "FORCES")
    ).iterator():
        if not event.demand_approved:
            rows = [
                {
                    "id": f"demand-{index}",
                    "sector": str(post.get("sector") or "").strip(),
                    "task": str(post.get("task") or post.get("post") or "").strip(),
                    "shift": "",
                    "need": max(int(post.get("need") or 0), 0),
                    "group": "",
                    "requirements": str(post.get("requirements") or "").strip(),
                    "comment": "",
                }
                for index, post in enumerate(
                    event.recon_sector_posts or [], start=1
                )
            ]
            event.demand_rows = rows
            event.demand_approved = True
            event.force_need = sum(int(row["need"]) for row in rows)
            if event.force_need > 0 and not event.force_requests:
                event.force_requests = [
                    {
                        "id": "force-request-1",
                        "group": "",
                        "requestedCount": event.force_need,
                        "allocatedCount": 0,
                        "status": "NOT_SENT",
                        "comment": "",
                    }
                ]
        from_stage = event.stage
        event.stage = "PLACEMENT"
        event.readiness_percent = STAGE_READINESS_PLACEMENT
        event.save(
            update_fields=[
                "demand_rows",
                "demand_approved",
                "force_requests",
                "force_need",
                "stage",
                "readiness_percent",
            ]
        )
        if from_stage != "FORCES":
            Transition.objects.create(
                event=event,
                from_stage=from_stage,
                to_stage="FORCES",
                kind="FORWARD",
                occurred_at=now,
            )
            from_stage = "FORCES"
        Transition.objects.create(
            event=event,
            from_stage=from_stage,
            to_stage="PLACEMENT",
            kind="FORWARD",
            occurred_at=now,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0045_opsauditlog_entity_key_alter_opsauditlog_entity_id"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
