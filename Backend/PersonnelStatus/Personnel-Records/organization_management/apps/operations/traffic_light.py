"""Светофор подразделения и свод по дереву (порт apps/operations/submissions/
traffic_light.py из Backend/VAPS).

Отвечает на вопрос «можно ли верить сданному дню прямо сейчас»:

* КРАСНЫЙ — есть кого сдавать, а действующей сдачи за день нет;
* СЕРЫЙ (NEUTRAL) — сдавать некого: в подразделении нет ни одного человека;
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

Свод поднимает худший цвет поддерева наверх (вторая половина модуля). Прав
не проверяет и об HTTP не знает: область видимости накладывает вызывающий,
как и у расхода.

ОТЛИЧИЯ ОТ ИСТОЧНИКА:
- знаменатель живой стороны — тот же селектор слотов, что у снимка и расхода
  (в источнике история принадлежности); две стороны сравнения обязаны
  считать список одинаково, иначе «расхождением» станет сам способ счёта;
- приоритеты типов приходят из справочника (StatusCatalog), а не из
  литеральной карты: у расхода это уже так, и второй источник правды о
  победителе развалил бы согласие светофора с расходом;
- ЦВЕТА NEUTRAL/UNKNOWN ВОЗВРАЩАЕТ ТОЛЬКО СВОД. Точечный светофор на
  сломанном справочнике падает, а не красит UNKNOWN'ом: спросили про один
  узел — ответ «сломано» обязан быть громким, тогда как в дереве одна
  сломанная ветка не должна прятать остальные. Асимметрия осознанная: это
  не разный цвет одного состояния, а разный способ доставки ошибки.
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
    # Только у свода: узел, которому нечего сдавать, и узел, чей справочник
    # сломан. Точечный светофор их не возвращает — см. докстринг модуля.
    NEUTRAL = "NEUTRAL", "Нет данных"
    UNKNOWN = "UNKNOWN", "Неопределён"


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
    лежит отметкой late. Красный означает «есть кого сдавать и не сдали», а
    не «сдали поздно» — иначе один цвет отвечал бы на два разных вопроса.
    """
    from organization_management.apps.operations.selectors import (
        DailySubmissionSelector,
        StatusTypeSelector,
    )

    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None:
        # Красный — «есть кого сдавать и не сдали». Узлу без людей предъявить
        # нечего, и он серый: одно правило со сводом, иначе лист дерева и тот
        # же узел, спрошенный поимённо, окрасились бы по-разному (в источнике
        # они и расходятся).
        empty = not _winners_live(division_id, business_date, catalog)
        return DivisionTrafficLight(
            status=(
                TrafficLightStatus.NEUTRAL.value
                if empty
                else TrafficLightStatus.RED.value
            ),
            late=False,
            drift=None,
        )
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


# ── Свод по дереву ───────────────────────────────────────────────────────

# Худший цвет побеждает; NEUTRAL нейтрален. UNKNOWN выше красного намеренно:
# «не знаю» честнее, чем «всё в порядке», и узел со сломанным справочником не
# должен прятаться за спокойным цветом.
_PRECEDENCE = {
    TrafficLightStatus.NEUTRAL.value: 0,
    TrafficLightStatus.GREEN.value: 1,
    TrafficLightStatus.YELLOW.value: 2,
    TrafficLightStatus.RED.value: 3,
    TrafficLightStatus.UNKNOWN.value: 4,
}


@dataclass(frozen=True)
class CascadeTrafficLight:
    """Сведённый светофор узла: свой цвет плюс худший цвет потомков.

    late — ИЛИ по поддереву: опоздание где угодно внизу поднимается наверх,
    иначе начальник видел бы зелёное дерево над опоздавшим подразделением.
    Поимённое расхождение здесь НЕ несётся: свод отвечает на вопрос «куда
    смотреть», а подробности берут точечным запросом того узла.
    """

    status: str
    late: bool


def _worst(*statuses):
    """Худший цвет по старшинству; пусто — NEUTRAL."""
    return max(
        statuses,
        key=lambda status: _PRECEDENCE[status],
        default=TrafficLightStatus.NEUTRAL.value,
    )


def _own_states(subtree, business_date):
    """{подразделение: (цвет, late)} по СВОЕМУ уровню каждого узла, пачкой.

    Четыре запроса на всё дерево (слоты, факты, сдачи, справочник) вместо
    вызова division_traffic_light в цикле: поимённый обход дал бы число
    запросов, растущее с числом узлов.

    Изоляция сломанного узла: неизвестный справочнику код (ValueError)
    красит UNKNOWN'ом ТОЛЬКО свой узел, остальное дерево считается. Ловится
    ровно ValueError — KeyError/TypeError от разъехавшейся схемы снимка
    остаются громкими, потому что означают не «плохие данные», а сломанный
    формат, и маскировать их цветом значило бы прятать поломку раздела.
    """
    from organization_management.apps.operations.selectors import (
        DailySubmissionSelector,
        EmployeeStatusSelector,
        StaffUnitSelector,
        StatusTypeSelector,
    )

    slots, _dismissed = StaffUnitSelector.slots_with_working_occupants(subtree)
    members = {}
    for slot in slots:
        if slot["employee_id"]:
            members.setdefault(slot["division_id"], []).append(slot["employee_id"])
    all_employees = [eid for ids in members.values() for eid in ids]
    rows = EmployeeStatusSelector.overlapping_on(business_date, all_employees)
    facts = {}
    for row in rows:
        facts.setdefault(row["employee_id"], []).append(row)
    submissions = DailySubmissionSelector.current_for_many(subtree, business_date)
    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())

    own = {}
    for division_id in subtree:
        occupants = members.get(division_id, [])
        submission = submissions.get(division_id)
        if submission is None:
            # Узлу, которому некого сдавать, нечего и предъявить: красный на
            # пустой папке звал бы дежурного к подразделению без людей.
            own[division_id] = (
                TrafficLightStatus.RED.value
                if occupants
                else TrafficLightStatus.NEUTRAL.value,
                False,
            )
            continue
        try:
            live = {
                employee_id: resolve_status(
                    facts.get(employee_id, ()), business_date, catalog
                )
                for employee_id in occupants
            }
            drift = _diff_winners(
                _winners_from_snapshot(submission.snapshot, business_date, catalog),
                live,
            )
            own[division_id] = (
                TrafficLightStatus.GREEN.value
                if drift is None
                else TrafficLightStatus.YELLOW.value,
                submission.late,
            )
        except ValueError:
            own[division_id] = (TrafficLightStatus.UNKNOWN.value, submission.late)
    return own


def traffic_light_tree(root_division_id, business_date):
    """Свод светофора по поддереву → {подразделение: CascadeTrafficLight}.

    Цвет узла — худший из его собственного и цветов всех потомков, late —
    ИЛИ по поддереву. Одна свёртка снизу вверх по адъяценси из общего
    селектора дерева; повторного скана дерева нет (children_map считается
    один раз и передаётся в subtree_ids).
    """
    from organization_management.apps.operations.selectors import DivisionTreeSelector

    children = DivisionTreeSelector.children_map()
    subtree = DivisionTreeSelector.subtree_ids(
        root_division_id, children_map=children
    )
    own = _own_states(subtree, business_date)

    result = {}
    folding = set()

    def fold(node):
        if node in result:
            return result[node]
        # Отметка «в работе» ДО спуска: у Division.parent нет запрета циклов,
        # и сохранённая петля A→B→A увела бы рекурсию в бесконечность. Для
        # честного дерева это множество не срабатывает ни разу — тот же
        # приём, что и в subtree_ids.
        folding.add(node)
        own_status, own_late = own[node]
        child_states = [
            fold(child)
            for child in children.get(node, [])
            if child in subtree and child not in folding
        ]
        status = _worst(own_status, *(state.status for state in child_states))
        late = own_late or any(state.late for state in child_states)
        folding.discard(node)
        result[node] = CascadeTrafficLight(status=status, late=late)
        return result[node]

    for node in subtree:
        fold(node)
    return result
