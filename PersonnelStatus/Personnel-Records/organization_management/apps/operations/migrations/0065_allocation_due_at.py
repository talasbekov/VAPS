"""Срок сдачи списка у строки раскладки (Plane №287).

На эталоне заказчика у заявки департаменту есть колонка «Срок» — дата со
временем, за сутки до мероприятия. Такого поля не было ВООБЩЕ: ни как поля, ни
как правила, и «опоздал» с «ещё можно» были неразличимы — штаб не мог ни
напомнить, ни отбить позднюю отправку.

Новое поле не должно быть пустым у уже заведённого, поэтому существующим
строкам проставляется умолчание — начало мероприятия минус сутки, ровно то же,
что считает `allocation_default_due_at` для новых. Это не выдуманный факт, а
то самое правило эталона, применённое к дате, которая у мероприятия уже есть.

Отвергнут вариант «оставить пусто и показывать „срок не задан“»: тогда все
существующие заявки — а это ВСЕ заявки системы — остались бы без срока, и
правило начало бы действовать только для заведённых после миграции. Правило,
которое не касается ничего из существующего, не отличить от отсутствующего.

Обратный перенос поле снимает: без него старый код читал бы строку с ключом,
которого его форма не знает.
"""
import datetime as dt

from django.conf import settings
from django.db import migrations

try:  # pragma: no cover — ветка для окружений без zoneinfo
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


def _local_tz():
    name = getattr(settings, "OPS_LOCAL_TIMEZONE", settings.TIME_ZONE)
    return ZoneInfo(name)


def _default_due_at(event):
    start_time = event.event_time or dt.time(0, 0)
    naive = dt.datetime.combine(event.business_date, start_time)
    return (naive.replace(tzinfo=_local_tz()) - dt.timedelta(days=1)).isoformat()


def _add_due_at(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    touched = []
    for event in Event.objects.exclude(force_allocation=[]).only(
        "id", "force_allocation", "business_date", "event_time"
    ):
        rows = event.force_allocation or []
        changed = False
        for row in rows:
            if not row.get("dueAt"):
                row["dueAt"] = _default_due_at(event)
                changed = True
        if changed:
            event.force_allocation = rows
            touched.append(event)
    Event.objects.bulk_update(touched, ["force_allocation"])


def _drop_due_at(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    touched = []
    for event in Event.objects.exclude(force_allocation=[]).only(
        "id", "force_allocation"
    ):
        rows = event.force_allocation or []
        changed = False
        for row in rows:
            if "dueAt" in row:
                row.pop("dueAt")
                changed = True
            if "submittedLate" in row:
                row.pop("submittedLate")
                changed = True
        if changed:
            event.force_allocation = rows
            touched.append(event)
    Event.objects.bulk_update(touched, ["force_allocation"])


class Migration(migrations.Migration):

    dependencies = [("operations", "0064_directorate_quota")]

    operations = [migrations.RunPython(_add_due_at, _drop_due_at)]
