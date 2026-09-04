"""Оба «Привлечён на мероприятие» сливаются в «Участие в ОМ» (Plane №486).

Заказчик 04.09.2026: «Убери статусы Привлечен на мероприятия (обе)». Из трёх
предложенных исходов он выбрал ПЕРЕВОД строк: 157 живых записей меняют код на
`IN_EVENT`, оба старых типа гасятся в справочнике. Отвергнуты «погасить типы,
строки не трогать» (в таблице статусов ещё долго соседствовали бы две подписи
об одном и том же) и «удалить и типы, и строки» (история привлечения людей
исчезла бы безвозвратно, а версий у базы стенда нет).

ЧТО СОХРАНЯЕТСЯ. Различие «наряд / боевая группа» жило В КОДЕ СТАТУСА и
потому исчезло бы вместе с ним. Оно переносится в `participations[].kind_code`
(`PHYSICAL_SQUAD` / `SCREENING_GROUP`) — туда, где для строк цепочки оно и так
лежит с Ш-3 (`0062_status_participation.py`). Строкам, у которых участия нет
вовсе, вид дописывается ЗДЕСЬ по их прежнему коду: другого источника у них не
будет никогда, а расход печатает эту разбивку («На ОМ (гр./нар.)»).

ТИПЫ ГАСЯТСЯ, А НЕ УДАЛЯЮТСЯ. `is_active=False` снимает их с выдачи, но
оставляет читаемыми: на строку статуса нет внешнего ключа, а есть код, и
удалённый тип превратил бы старые выгрузки и снимки расхода в записи с
неизвестным кодом. Тот же довод, что и у скрытия городов из справочника.

ОБРАТИМОСТЬ ЧАСТИЧНАЯ, и это названо честно: `backwards` возвращает типы в
выдачу и разводит строки обратно по видам участия. Строки, у которых вида не
было и на момент прямого хода, вернутся нарядом — восстановить «неизвестно»
после того, как мы его дописали, уже нечем.
"""
from django.db import migrations

TARGET = "IN_EVENT"
SQUAD = "EVENT_ASSIGNMENT"
GROUP = "EVENT_ASSIGNMENT_GROUP"

KIND_BY_LEGACY_CODE = {SQUAD: "PHYSICAL_SQUAD", GROUP: "SCREENING_GROUP"}
LEGACY_CODE_BY_KIND = {"PHYSICAL_SQUAD": SQUAD, "SCREENING_GROUP": GROUP}


def forwards(apps, schema_editor):
    StatusType = apps.get_model("operations", "StatusType")
    Status = apps.get_model("operations", "OpsEmployeeStatus")
    Participation = apps.get_model("operations", "OpsStatusParticipation")

    # Цели может не быть на голом стенде — тогда сливать некуда, и молча
    # затирать код значило бы завести строки с кодом вне справочника.
    if not StatusType.objects.filter(code=TARGET).exists():
        return

    for legacy, kind in KIND_BY_LEGACY_CODE.items():
        for status in Status.objects.filter(status_type_code=legacy).iterator():
            rows = list(status.participations.all())
            # Вид ДОПИСЫВАЕТСЯ только там, где его нет: у строк цепочки он уже
            # правильный, и переписывать его прежним кодом значило бы затереть
            # факт догадкой.
            for row in rows:
                if not row.kind_code:
                    row.kind_code = kind
                    row.save(update_fields=["kind_code"])
            if not rows:
                # Участия нет вовсе — исторический факт из-под бэкфилла Ш-3.
                # Другого источника вида у него не будет никогда, а расход
                # печатает разбивку «На ОМ (гр./нар.)».
                #
                # `event_id = 0` — «мероприятие неизвестно»: ссылка плоская,
                # внешнего ключа нет, а ограничение уникальности берёт пару
                # (статус, мероприятие), и у одного статуса такая строка
                # ровно одна.
                Participation.objects.create(
                    status=status, event_id=0, kind_code=kind, role_code=""
                )
            status.status_type_code = TARGET
            status.save(update_fields=["status_type_code"])

    StatusType.objects.filter(code__in=(SQUAD, GROUP)).update(is_active=False)


def backwards(apps, schema_editor):
    StatusType = apps.get_model("operations", "StatusType")
    Status = apps.get_model("operations", "OpsEmployeeStatus")

    StatusType.objects.filter(code__in=(SQUAD, GROUP)).update(is_active=True)
    known = set(
        StatusType.objects.filter(code__in=(SQUAD, GROUP)).values_list(
            "code", flat=True
        )
    )
    for status in Status.objects.filter(status_type_code=TARGET).iterator():
        kinds = [
            row.kind_code
            for row in status.participations.all()
            if row.kind_code in LEGACY_CODE_BY_KIND
        ]
        # Вида нет — строка и до слияния была «Участием в ОМ» (их на момент
        # №486 не было ни одной, но обратный ход обязан пережить и такие).
        if not kinds:
            continue
        legacy = LEGACY_CODE_BY_KIND[kinds[0]]
        if legacy not in known:
            continue
        status.status_type_code = legacy
        status.save(update_fields=["status_type_code"])


class Migration(migrations.Migration):
    dependencies = [("operations", "0090_refresh_visit_need_snapshots")]
    operations = [migrations.RunPython(forwards, backwards)]
