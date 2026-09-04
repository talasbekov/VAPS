"""Чек-лист рекогносцировки: одно состояние пункта «Норма / Замечание /
Не проверено» (`[РЕК-04]`, Plane №443). Бэкфилл: `state` выводится из старых
`done`/`result` (чекбокс + select), старые ключи остаются для прежних
читателей. Обратная миграция ничего не трогает — старые ключи и так на месте.
"""
from django.db import migrations


def _state(item):
    state = item.get("state")
    if state in ("NORMAL", "REMARK", "UNCHECKED"):
        return state
    if item.get("result") == "NEEDS_CHANGES":
        return "REMARK"
    if item.get("done") or item.get("result") == "MATCHES":
        return "NORMAL"
    return "UNCHECKED"


def backfill_checklist_state(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    touched = 0
    for event in OpsSecurityEvent.objects.exclude(recon_checklist=[]).iterator():
        changed = False
        rows = []
        for item in event.recon_checklist or []:
            state = _state(item)
            row = {
                **item,
                "state": state,
                "required": bool(item.get("required", True)),
                "done": state != "UNCHECKED",
                "result": {"NORMAL": "MATCHES", "REMARK": "NEEDS_CHANGES"}.get(state),
            }
            changed = changed or row != item
            rows.append(row)
        if changed:
            event.recon_checklist = rows
            event.save(update_fields=["recon_checklist"])
            touched += 1
    print(f"[recon-checklist] мероприятий с пересчитанным чек-листом: {touched}.")


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0087_event_closing_comment"),
    ]

    operations = [
        migrations.RunPython(backfill_checklist_state, migrations.RunPython.noop),
    ]
