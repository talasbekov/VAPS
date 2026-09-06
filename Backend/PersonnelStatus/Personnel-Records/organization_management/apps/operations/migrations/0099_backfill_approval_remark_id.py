"""Замечанию старой формы даётся ИДЕНТИФИКАТОР — иначе объект заперт (Plane №502).

🔴 ЧТО СЛОМАЛА ПРЕДЫДУЩАЯ ПОЛОВИНА ПРАВКИ (найдено ревью №825). Миграция
`0095_backfill_approval_remark_status` дописала старым замечаниям `status`, и
они начали ЧЕСТНО держать этап — ровно то, чего требовала карточка №502. Но
`id` она не дописала, а закрыть замечание можно только по нему:
`_resolve_remark` (`ops/security_events.py`) ищет `item.get("id") == remark_id`.

Итог хуже исходного дефекта. Было: неотвеченное старое замечание МОЛЧА
пропускало этап. Стало: оно этап держит, экран после №503 честно рисует ему
кнопки «Устранено» и «Не согласен», кнопки шлют `remarkId = undefined`, адрес
собирается как `…/approval/remarks/undefined/resolve/`, сервер отвечает 404
«Замечание не найдено» — и объект не сдвинуть ничем, кроме админского обхода
этапа. На стенде под это попали объекты, которые дополнила `0095`.

ПОЧЕМУ ОТДЕЛЬНАЯ МИГРАЦИЯ, А НЕ ПРАВКА `0095`. `0095` уже накачена — на
стенде и у всех, кто обновлялся. Правка применённой миграции чинит только
свежие базы и молча оставляет сломанными те, ради которых всё и делалось.
Здесь же обе выправляются одним ходом: на свежей базе `0099` идёт следом за
`0095` и дополняет то, чего та не дала, на существующей — чинит уже
записанное.

ИДЕНТИФИКАТОР ВЫВОДИТСЯ, А НЕ ВЫДУМЫВАЕТСЯ. `remark-legacy-<pk объекта>-<индекс
в списке>`: он однозначен в пределах строки (замечания живут списком у объекта
посещения, и `_resolve_remark` ищет именно в нём), устойчив к повторной
накатке и по виду сразу говорит, что запись достроена, а не заведена человеком.
Позиция в списке не меняется: замечания только дописываются в конец.

`createdAt` дописывается ПУСТЫМ (`""`), а не выдуманным: у старой строки момента
нет, а подставить сюда «сейчас» значило бы сообщить, что замечание написано в
день накатки миграции. Клиент печатает его через `formatIsoDateTime` только при
непустом значении.
"""
from django.db import migrations


def _legacy_id(visit_pk, index):
    return f"remark-legacy-{visit_pk}-{index}"


def forwards(apps, schema_editor):
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    touched = 0
    for visit in VisitObject.objects.exclude(approval_remarks=[]).iterator():
        remarks = visit.approval_remarks or []
        rebuilt = []
        changed = False
        for index, item in enumerate(remarks):
            if not isinstance(item, dict):
                rebuilt.append(item)
                continue
            filled = dict(item)
            if not str(filled.get("id") or "").strip():
                filled["id"] = _legacy_id(visit.pk, index)
                changed = True
            if "createdAt" not in filled:
                filled["createdAt"] = ""
                changed = True
            rebuilt.append(filled)
        if changed:
            visit.approval_remarks = rebuilt
            visit.save(update_fields=["approval_remarks"])
            touched += 1
    if touched:
        print(f"  замечаний согласования опознано: объектов посещения — {touched}")


def backwards(apps, schema_editor):
    """Снять ТОЛЬКО выведенные идентификаторы, и только пока по ним не решали.

    Строку, которую человек уже закрыл этим идентификатором, раздевать нельзя:
    ответ ссылается на неё, а без `id` его больше не найти.
    """
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    for visit in VisitObject.objects.exclude(approval_remarks=[]).iterator():
        remarks = visit.approval_remarks or []
        rebuilt = []
        changed = False
        for index, item in enumerate(remarks):
            if not isinstance(item, dict) or item.get("id") != _legacy_id(visit.pk, index):
                rebuilt.append(item)
                continue
            answered = str(item.get("response") or "").strip() or item.get("respondedAt")
            if answered:
                rebuilt.append(item)
                continue
            stripped = {k: v for k, v in item.items() if k != "id"}
            if stripped.get("createdAt") == "":
                stripped.pop("createdAt")
            rebuilt.append(stripped)
            changed = True
        if changed:
            visit.approval_remarks = rebuilt
            visit.save(update_fields=["approval_remarks"])


class Migration(migrations.Migration):

    dependencies = [("operations", "0098_backfill_actor_display_signatures")]

    operations = [migrations.RunPython(forwards, backwards)]
