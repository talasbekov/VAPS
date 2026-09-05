"""Напоминание начальникам о неподтвердивших за час до заступления
(Plane №427, `[ОЗН-06]`).

Обычный движок под management-команду (как `lagging_check`): запускается и
проверяется без планировщика. Окно — [сейчас; сейчас + 1 ч] по местным часам:
заступление = деловая дата мероприятия + время начала (нет времени — 08:00,
начало рабочего дня раздела). Идемпотентно тем же ключом «одно на день»
модели уведомлений; повторный прогон в то же окно строк не создаёт.
"""
import datetime as dt

from django.utils import timezone

from organization_management.apps.operations import notify_service
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.acknowledgement_notify import (
    _division_of,
    supervisors_by_division,
)

#: Свой вид уведомления (не EVENT_ACKNOWLEDGEMENT): ключ «одно на день»
#: иначе глотал бы напоминание — руководитель уже получил уведомление о
#: заступлении на этот день при открытии этапа. Заведён миграцией 0083.
KIND = "ACKNOWLEDGEMENT_DUE_SOON"

#: Заступление без названного часа — начало рабочего дня раздела.
DEFAULT_START = dt.time(8, 0)
WINDOW = dt.timedelta(hours=1)


def _start_of(event):
    return timezone.make_aware(
        dt.datetime.combine(event.business_date, event.event_time or DEFAULT_START)
    )


def acknowledgement_deadline(event):
    """Срок подтверждения (`[ОЗН-02]`, Plane №447) — за час до начала: тот же
    порог, по которому уходит напоминание руководителям (`WINDOW`)."""
    if event.business_date is None:
        return None
    return _start_of(event) - WINDOW


def _unconfirmed(event):
    return [
        a
        for a in (event.placement_assignments or [])
        if a.get("acknowledgedAt") is None
    ]


def remind_supervisors_before_start(now=None):
    """Пройти ОМ на «Ознакомлении», заступление которых в ближайший час, и
    уведомить руководителей каждого неподтвердившего. Возвращает отчёт."""
    now = now or timezone.localtime()
    window_end = now + WINDOW
    report = {"events": 0, "unconfirmed": 0, "supervisors": 0, "eventCodes": []}
    candidates = OpsSecurityEvent.objects.filter(
        stage="ACKNOWLEDGEMENT",
        business_date__in={now.date(), window_end.date()},
    )
    for event in candidates:
        start = _start_of(event)
        if not (now <= start <= window_end):
            continue
        rows = _unconfirmed(event)
        if not rows:
            continue
        employee_ids = [str(a.get("employeeId")) for a in rows if a.get("employeeId") is not None]
        divisions = _division_of(employee_ids)
        supervisors_of = supervisors_by_division(set(divisions.values()))

        # 🔴 КАЖДОМУ — ТОЛЬКО ЕГО ЛЮДИ (Plane №665). Полезная нагрузка здесь
        # СПИСОЧНАЯ, и одна на всех означала, что начальник управления А
        # получает фамилии и идентификаторы личного состава управления Б.
        # Комментарии этого модуля и модели обещали «список СВОИХ» — код
        # обещание не выполнял. Список собирается по разрезу «подразделение →
        # его начальники»: строка неподтвердившего попадает ровно тем, кто за
        # его подразделение отвечает.
        rows_of_supervisor = {}
        for assignment in rows:
            employee_id = str(assignment.get("employeeId"))
            division_id = divisions.get(employee_id)
            if division_id is None:
                # Человек без штатного слота: чьим подчинённым его считать,
                # неизвестно, и раздать его «на всякий случай» значило бы
                # вернуть ту же утечку. Он остаётся в отчёте числом
                # неподтвердивших, но ни в чей список не попадает.
                continue
            for user_id in supervisors_of.get(division_id, set()):
                rows_of_supervisor.setdefault(user_id, []).append(assignment)

        base = {
            "eventId": str(event.pk),
            "eventCode": event.code,
            "eventTitle": event.title,
            "businessDate": event.business_date.isoformat(),
            "objectName": event.object_name,
            "asSupervisor": True,
            "oneHourBefore": True,
        }
        notified = 0
        for user_id, own_rows in rows_of_supervisor.items():
            payload = {
                **base,
                "unconfirmed": [
                    {
                        "employeeId": str(a.get("employeeId")),
                        "employeeName": a.get("employeeName", ""),
                    }
                    for a in own_rows
                ],
            }
            # 🔴 КЛЮЧ — МЕРОПРИЯТИЕ, А НЕ ТОЛЬКО ДЕНЬ (Plane №666). Умолчание
            # `notify` — «одно на (получателя, вид, деловую дату)», и два ОМ на
            # одну дату давали начальнику ОДНО напоминание: о втором ему не
            # говорили вовсе, а отчёт всё равно считал его уведомлённым.
            # Своим ключом строки разных мероприятий перестают сталкиваться, а
            # идемпотентность повторного прогона в то же окно сохраняется —
            # ключ у одного и того же ОМ один и тот же.
            if notify_service.notify(
                user_id,
                KIND,
                event.business_date,
                payload,
                dedupe_key=str(event.pk),
            ) is not None:
                notified += 1
        report["events"] += 1
        report["unconfirmed"] += len(rows)
        # Считается ДОШЕДШЕЕ, а не намерение: `notify` глотает свои отказы и
        # возвращает `None` (то же правило, что у рассылки запроса сил, №561).
        report["supervisors"] += notified
        report["eventCodes"].append(event.code)
    return report
