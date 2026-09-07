"""У мероприятия появляется ИДЕНТИФИКАТОР создателя (Plane №947, задача
заказчика 07.09.2026: «сводные данные … должны изменять тот, кто создал,
старший ГВО, которого назначили, начальник управления второго департамента»).

До этого ОМ хранило только подпись `owner_name` — снимок ФИО для экрана и
фильтра реестра (Plane №484). По подписи право не выдаётся: тёзка получил бы
правку чужой сводки, а сама подпись — текст. Идентификатор учётки живёт
рядом, как `chief_employee_id` рядом с `chief_name`.

БЭКФИЛЛ — ИЗ ЖУРНАЛА АУДИТА, а не «пусто у старых строк»: создание каждого ОМ
записано (`SECURITY_EVENT_CREATED`, `entity_id` = pk мероприятия,
`actor_user_id` — идентификатор учётки), и у заведённых до правки
мероприятий создатель известен. Оставить поле пустым значило бы, что правило
«создатель правит сводку» заработает только у новых ОМ, а на стенде
заказчика все проверяемые — старые. Берётся САМАЯ РАННЯЯ запись: повторного
создания не бывает, но журнал не гарантирует единственности.
"""
from django.db import migrations, models

CREATED = "SECURITY_EVENT_CREATED"
ENTITY = "security_event"


def _backfill_from_audit(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    OpsAuditLog = apps.get_model("operations", "OpsAuditLog")
    creators = {}
    rows = (
        OpsAuditLog.objects.filter(action=CREATED, entity_type=ENTITY)
        .exclude(entity_id=None)
        .order_by("created_at", "id")
        .values_list("entity_id", "actor_user_id")
    )
    for entity_id, actor in rows:
        creators.setdefault(entity_id, actor or "")
    for event in OpsSecurityEvent.objects.filter(owner_actor_id="").only("id"):
        actor = creators.get(event.pk, "")
        if actor:
            OpsSecurityEvent.objects.filter(pk=event.pk).update(owner_actor_id=actor)


class Migration(migrations.Migration):
    dependencies = [("operations", "0103_backfill_force_allocation_sent_at")]

    operations = [
        migrations.AddField(
            model_name="opssecurityevent",
            name="owner_actor_id",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.RunPython(_backfill_from_audit, migrations.RunPython.noop),
    ]
