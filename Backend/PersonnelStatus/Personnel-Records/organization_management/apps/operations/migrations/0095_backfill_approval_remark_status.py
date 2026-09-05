"""Замечания согласования, записанные ДО №386, получают `status` (Plane №502).

🔴 ЧТО СЛУЧИЛОСЬ. Коммит №386 заменил у замечания булево `resolved` на
тройственный `status` (`OPEN` / `ANSWERED` / `RESOLVED`), но миграции с
бэкфиллом не завёл. Строки, записанные раньше, лежат как
`{"text": …, "resolved": false, "resolvedAt": null}` и переехали в объект
посещения дословно (`0068_visit_object_stage_fields` копирует поле в поле).

Читатели сравнивают `item.get("status") == "OPEN"`, а у старых строк ключа нет
вовсе — `None == "OPEN"` ложно. Последствия ровно противоположны замыслу:

- `_approve_visit` и `_approval_ready` НЕ считают такое замечание открытым и
  пропускают завершение этапа мимо неотвеченного замечания;
- экран (`ApprovalStage`) не находит ни подписи, ни оформления: `className`
  оканчивается литералом `undefined`, печатается «пост undefined» и «документ
  vundefined» (Plane №503).

ЧТО ДЕЛАЕТ БЭКФИЛЛ. Дописывает недостающие ключи по прежнему смыслу:
`resolved: true` → `RESOLVED`, иначе `OPEN`. Остальные поля контракта
проставляются пустыми — не выдуманными: автора, срочность и версию документа у
старой строки взять неоткуда, и подставить туда что-либо значило бы придумать
факт. `response: ""` и `respondedAt: None` — это и есть «ответа не было».

ОБРАТНЫЙ ХОД НЕ ВОССТАНАВЛИВАЕТ `resolved`: он и не удалялся — старый ключ
остаётся лежать рядом нетронутым, поэтому откат просто снимает дописанное.
"""
from django.db import migrations

_ADDED = (
    "status",
    "approverId",
    "author",
    "postId",
    "urgent",
    "response",
    "respondedAt",
    "documentVersion",
    "resolvedInDocumentVersion",
)


def _fill(remark):
    """Недостающие ключи одной строки; `None` — трогать нечего."""
    if "status" in remark:
        return None
    filled = dict(remark)
    filled["status"] = "RESOLVED" if remark.get("resolved") else "OPEN"
    filled.setdefault("approverId", None)
    filled.setdefault("author", "")
    filled.setdefault("postId", None)
    filled.setdefault("urgent", False)
    filled.setdefault("response", "")
    filled.setdefault("respondedAt", remark.get("resolvedAt"))
    filled.setdefault("documentVersion", None)
    filled.setdefault("resolvedInDocumentVersion", None)
    return filled


def forwards(apps, schema_editor):
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    touched = 0
    for visit in VisitObject.objects.exclude(approval_remarks=[]).iterator():
        remarks = visit.approval_remarks or []
        rebuilt = [(_fill(item) or item) for item in remarks]
        if rebuilt != remarks:
            visit.approval_remarks = rebuilt
            visit.save(update_fields=["approval_remarks"])
            touched += 1
    print(f"  замечаний согласования дополнено: объектов посещения — {touched}")


def backwards(apps, schema_editor):
    """Снять дописанное; `resolved` не трогался и лежит на месте."""
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    for visit in VisitObject.objects.exclude(approval_remarks=[]).iterator():
        remarks = visit.approval_remarks or []
        # Откатываются ТОЛЬКО строки старой формы — у них остался `resolved`.
        # Строку, заведённую после №386, `resolved` не несёт, и раздевать её
        # значило бы сломать живые данные откатом (та же яма, что в №758).
        rebuilt = [
            {k: v for k, v in item.items() if k not in _ADDED}
            if "resolved" in item
            else item
            for item in remarks
        ]
        if rebuilt != remarks:
            visit.approval_remarks = rebuilt
            visit.save(update_fields=["approval_remarks"])


class Migration(migrations.Migration):

    dependencies = [("operations", "0094_evaluation_withdrawn_at")]

    operations = [migrations.RunPython(forwards, backwards)]
