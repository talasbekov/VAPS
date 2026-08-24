"""Бэкфилл: у каждого существующего ОМ появляется его объект посещения.

До этой миграции объект мероприятия жил единственным полем ОМ
(`security_object`/`object_name`/`passport_binding`), и раскрытие строки
реестра было бы пустым у всех заведённых ранее мероприятий. Строка переносится
как есть — включая снимок имени и привязку паспорта: это ТОТ ЖЕ факт, просто
переехавший в таблицу, где их может быть несколько.

Поля ОМ при этом НЕ стираются: карточка, реестр ГВО и расчёт постов читают их
до конца переезда (задачи «этапы по объекту»), а снятие дубля — отдельное
решение, которое должно идти после них.

Обратная миграция удаляет только строки, созданные этим бэкфиллом — то есть
все, что есть на момент отката: до 0034 таблицы не существовало вовсе.
"""
from django.db import migrations


def backfill(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    rows = []
    for event in OpsSecurityEvent.objects.all().iterator():
        # Имя обязательно (CHECK на непустоту): у строк без снимка имени берём
        # подпись объекта из реестра, а если и ссылки нет — называем причину,
        # а не оставляем пустую строку.
        name = (event.object_name or "").strip()
        if name == "":
            name = (
                event.security_object.name
                if event.security_object_id is not None
                else "Объект не указан"
            )
        rows.append(
            VisitObject(
                event_id=event.pk,
                security_object_id=event.security_object_id,
                object_name=name,
                passport_binding=event.passport_binding,
                protected_person_id=event.protected_person_id,
                protected_person_name=event.protected_person_name or "",
                position=0,
            )
        )
    VisitObject.objects.bulk_create(rows, batch_size=500)


def drop(apps, schema_editor):
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    VisitObject.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0034_opssecurityeventvisitobject"),
    ]

    operations = [
        migrations.RunPython(backfill, drop),
    ]
