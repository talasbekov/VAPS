"""Бэкфилл `sentAt` у строк раскладки сил (Plane №944, `[СБС-12]`).

С этой правки «Отправить запросы» — отдельный шаг штаба, и департамент видит
только отправленные строки (`sentAt`). До неё «сохранил раскладку» и
означало «департамент видит»: каждая существующая строка уже показана
департаменту, по ней могли ответить, разложить по управлениям, выделить
людей. Оставить её без момента — значит спрятать от департамента заявку,
которую он уже исполняет, и запереть её от собственных действий
(`ALLOCATION_NOT_SENT`).

Момент берётся самым ранним из известных фактов строки: оповещение
управлений, отправка списка, иначе — момент наката. Довыделения (`topUpOf`)
отправляются сразу (`top_up`), и им момент ставится тем же правилом.

Обратный ход снимает ключ: откатанная база не знает такого поля.
"""
import datetime as dt

from django.db import migrations

from organization_management.apps.operations.clock import Clock


def _mark_sent(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    # Время раздела — у `Clock`, как и везде (`test_clock_discipline`).
    now = Clock.now().astimezone(dt.timezone.utc).isoformat()
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]).iterator():
        rows = event.force_allocation or []
        changed = False
        updated = []
        for row in rows:
            if row.get("sentAt"):
                updated.append(row)
                continue
            moment = row.get("notifiedAt") or row.get("submittedAt") or now
            updated.append({**row, "sentAt": moment})
            changed = True
        if changed:
            event.force_allocation = updated
            event.save(update_fields=["force_allocation"])


def _unmark(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]).iterator():
        rows = event.force_allocation or []
        if not any("sentAt" in row for row in rows):
            continue
        event.force_allocation = [
            {key: value for key, value in row.items() if key != "sentAt"} for row in rows
        ]
        event.save(update_fields=["force_allocation"])


class Migration(migrations.Migration):
    dependencies = [("operations", "0102_notification_kind_forces_request_sent")]

    operations = [migrations.RunPython(_mark_sent, _unmark)]
