"""Светофор ОДНОГО подразделения (порт apps/operations/submissions/
traffic_light.py из Backend/VAPS, часть «свой уровень»).

Отвечает на вопрос «можно ли верить сданному дню прямо сейчас»:

* КРАСНЫЙ — действующей сдачи за день нет вовсе;
* ЖЁЛТЫЙ — сдача есть, но живые данные с ней разошлись (расхождение
  перечислено поимённо);
* ЗЕЛЁНЫЙ — сдача есть и живые данные ей отвечают.

РАСХОЖДЕНИЕ СЧИТАЕТСЯ ПО ПОБЕДИТЕЛЯМ ДНЯ, а не по сырым фактам: сравнивается
resolve_status(снимок) с resolve_status(живое) по каждому человеку.
Переименование, пересоздание идентичного факта или правка, не сдвинувшая
победителя, оставляют светофор зелёным — расход держится СНИМКОМ, и объявлять
расхождением то, что расхода не меняет, значило бы звать дежурного смотреть
на неизменившийся отчёт.

Это ДРУГОЙ вопрос, чем событие сдачи (_diff_key в day_submission_service):
там сравниваются сырые интервалы, чтобы решить «изменено / подтверждено без
изменений» в момент сдачи. Путать их нельзя: сдача говорит о том, что
изменилось со вчера, светофор — о том, что разошлось с сданным.

Свод вверх по дереву — отдельный срез. Прав не проверяет и об HTTP не знает:
область видимости накладывает вызывающий, как и у расхода.

ОТЛИЧИЯ ОТ ИСТОЧНИКА:
- знаменатель живой стороны — тот же селектор слотов, что у снимка и расхода
  (в источнике история принадлежности); две стороны сравнения обязаны
  считать список одинаково, иначе «расхождением» станет сам способ счёта;
- приоритеты типов приходят из справочника (StatusCatalog), а не из
  литеральной карты: у расхода это уже так, и второй источник правды о
  победителе развалил бы согласие светофора с расходом;
- цвета NEUTRAL/UNKNOWN здесь НЕ объявлены. Они нужны своду (узлу, которому
  нечего сдавать, и узлу со сломанным справочником), а цвет, которого никто
  не возвращает, — обещание фильтра, отдающего пустоту. Появятся вместе с
  тем, кто их вернёт.
"""
from dataclasses import dataclass
from datetime import date

from django.db import models

from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    resolve_status,
)


class TrafficLightStatus(models.TextChoices):
    """Цвет светофора. Значение-объект: в модели не хранится.

    TextChoices ради пары значение+подпись — так же, как у события сдачи;
    цвет выводится на чтении и переезжает в API одним словарём.
    """

    GREEN = "GREEN", "Зелёный"
    YELLOW = "YELLOW", "Жёлтый"
    RED = "RED", "Красный"


@dataclass(frozen=True)
class DivisionTrafficLight:
    """Светофор подразделения на дату.

    drift заполняется ТОЛЬКО у жёлтого: {"added": [...], "removed": [...],
    "changed": [{"employee_id", "from", "to"}]} — поимённо и в
    детерминированном порядке, чтобы дежурный видел, кого именно проверять.
    late — отметка опоздания САМОЙ сдачи, а не свойство цвета: опоздавшая
    сдача может быть зелёной, и смешивать эти два вопроса нельзя.
    """

    status: str
    late: bool
    drift: dict | None


def _winners_from_snapshot(snapshot, business_date, catalog):
    """Победители дня по СНИМКУ: {employee_id: код}.

    Знаменатель — roster снимка: каждый, кто в списке, получает победителя, и
    отсутствие фактов у него означает «в строю», а не отсутствие человека.
    Даты снимка приходят строками ISO и разбираются обратно в date: без
    этого сравнение с датой упало бы TypeError, а не соврало бы тихо.
    """
    facts = {}
    for row in snapshot.get("rows", []):
        facts.setdefault(row["employee_id"], []).append(
            {
                "status_type_code": row["status_type_code"],
                "date_start": date.fromisoformat(row["date_start"]),
                "date_end": date.fromisoformat(row["date_end"]),
            }
        )
    return {
        member["employee_id"]: resolve_status(
            facts.get(member["employee_id"], ()), business_date, catalog
        )
        for member in snapshot.get("roster", [])
    }


def _winners_live(division_id, business_date, catalog):
    """Победители дня по ЖИВЫМ данным: {employee_id: код}.

    Два запроса независимо от числа людей (слоты + факты пачкой) и
    группировка в памяти: победитель на каждого по отдельному запросу вернул
    бы ровно ту зависимость числа запросов от размера подразделения, от
    которой умер донор.
    """
    from organization_management.apps.operations.selectors import (
        EmployeeStatusSelector,
        StaffUnitSelector,
    )

    slots, _dismissed = StaffUnitSelector.slots_with_working_occupants([division_id])
    employee_ids = [slot["employee_id"] for slot in slots if slot["employee_id"]]
    rows = EmployeeStatusSelector.overlapping_on(business_date, employee_ids)
    facts = {}
    for row in rows:
        facts.setdefault(row["employee_id"], []).append(row)
    return {
        employee_id: resolve_status(
            facts.get(employee_id, ()), business_date, catalog
        )
        for employee_id in employee_ids
    }


def _diff_winners(snapshot_winners, live_winners):
    """Поимённое расхождение победителей или None, если стороны согласны."""
    snapshot_ids, live_ids = set(snapshot_winners), set(live_winners)
    added = sorted(live_ids - snapshot_ids)
    removed = sorted(snapshot_ids - live_ids)
    changed = sorted(
        (
            {
                "employee_id": employee_id,
                "from": snapshot_winners[employee_id],
                "to": live_winners[employee_id],
            }
            for employee_id in snapshot_ids & live_ids
            if snapshot_winners[employee_id] != live_winners[employee_id]
        ),
        key=lambda item: item["employee_id"],
    )
    if not (added or removed or changed):
        return None
    return {"added": added, "removed": removed, "changed": changed}


def division_traffic_light(division_id, business_date):
    """Светофор подразделения на бизнес-дату.

    Контрольный час здесь не участвует: он уже сработал в момент сдачи и
    лежит отметкой late. Красный означает ровно «сдачи нет», а не «сдали
    поздно» — иначе один цвет отвечал бы на два разных вопроса.
    """
    from organization_management.apps.operations.selectors import (
        DailySubmissionSelector,
        StatusTypeSelector,
    )

    current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None:
        return DivisionTrafficLight(
            status=TrafficLightStatus.RED.value, late=False, drift=None
        )
    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    drift = _diff_winners(
        _winners_from_snapshot(current.snapshot, business_date, catalog),
        _winners_live(division_id, business_date, catalog),
    )
    status = (
        TrafficLightStatus.GREEN.value
        if drift is None
        else TrafficLightStatus.YELLOW.value
    )
    return DivisionTrafficLight(status=status, late=current.late, drift=drift)
