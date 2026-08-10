"""Сводка дня уровня выше (порт assemble_summary из Backend/VAPS
apps/operations/submissions/services/summary_service.py).

Сводка — ТА ЖЕ сущность, что сдача: строка OpsDailySubmission родительского
подразделения. Одна модель на все эшелоны, а не отдельная таблица «сводок»:
иначе у каждого читателя сданного (расход, светофор, поправка) появилось бы
по второй ветке на «а вдруг это сводка», и они разошлись бы на первой же
правке.

Отличает сводку от обычной сдачи ровно один добавленный ключ снимка —
`sources`, ПИНЫ действующих сдач прямых детей
[{division_id, submission_id, version}]. Пин — это не ссылка «посмотреть
сейчас», а заявление «я собрана ИЗ ВОТ ЭТИХ версий»: ребёнок поправит свой
день, и сводка обязана оказаться протухшей, а не тихо начать значить другое.

СНИМОК СВОДКИ — СТРОГО СВОЙ УРОВЕНЬ (штаб родителя), а не объединение
детских: сводка отвечает за свой личный состав, а состав детей уже описан их
собственными сдачами. Слей их в один roster — и один человек оказался бы
сдан дважды, а расход по сводке разошёлся бы с суммой расходов детей.

Что в этом срезе НЕ делается: свежесть (derived-чтение пинов) и пересборка —
следующие срезы; маршрутов и прав тоже нет (право на слое API, как у всех
сервисов раздела).

Отличия от источника:
- id целые, коэрции UUID нет;
- «есть кому сдавать» определяется по ЖИВЫМ штатным слотам, а не по
  историческому списку на дату: у старой структуры истории слотов нет, и
  выводить её здесь значило бы выдумать данные;
- в журнал едет pk строки сводки, а не id подразделения (у источника
  entity_id сводки — подразделение, что расходится с его же событием сдачи;
  здесь ось журнала одна для обеих).
"""
from dataclasses import dataclass

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.day_submission_service import (
    _default_window,
    _diff_key,
    _is_late,
    _require_actor,
    _require_text,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
    StaffUnitSelector,
    SubmissionControlSettingsSelector,
)
from organization_management.apps.operations.snapshot import build_division_snapshot


def _required_children(division_id, *, children_map):
    """Прямые дети, которым ЕСТЬ ЧТО сдавать: в их поддереве есть люди.

    Ребёнку, у которого в поддереве некому сдавать, нечего и консолидировать
    — его молчание не должно держать сводку родителя вечно. Это то же
    правило, по которому светофор нейтрален на пустом списке, и намеренно
    НЕ то, по которому «необходимые управления» блокируют завтра: там
    обязанность назначена поимённо администратором, здесь выводится из
    структуры.

    Занятость считается ОДНИМ запросом на все поддеревья сразу: поимённый
    вопрос на каждого потомка вернул бы число запросов, растущее с деревом.
    """
    direct = children_map.get(division_id, [])
    if not direct:
        return []
    subtree_by_child = {
        child: DivisionTreeSelector.subtree_ids(child, children_map=children_map)
        for child in direct
    }
    all_descendants = set().union(*subtree_by_child.values())
    occupied = StaffUnitSelector.occupied_division_ids(all_descendants)
    return [
        child
        for child, subtree in subtree_by_child.items()
        if subtree & occupied
    ]


def _build_sources(direct_children, business_date):
    """Пины действующих сдач ВСЕХ прямых детей, ОДИН запрос.

    Пинится и тот, кого сводка не обязана ждать: сдавший пустой день сдал
    день, и не записать его значило бы объявить сводку собранной без него.
    Порядок — по подразделению: снимок иммутабелен, и его содержимое не
    должно зависеть от того, в каком порядке база вернула строки.
    """
    submitted = DailySubmissionSelector.current_for_many(
        direct_children, business_date
    )
    return sorted(
        (
            {
                "division_id": child_id,
                "submission_id": row.pk,
                "version": row.version,
            }
            for child_id, row in submitted.items()
        ),
        key=lambda pin: pin["division_id"],
    )


def _require_children_submitted(required, sources):
    """Сводка не собирается, пока не сдали все, кому есть что сдавать."""
    pinned = {pin["division_id"] for pin in sources}
    laggards = sorted(child for child in required if child not in pinned)
    if laggards:
        raise DomainError(
            "SUMMARY_CHILDREN_NOT_SUBMITTED",
            422,
            detail={"laggards": laggards},
            message="Не все подчинённые подразделения сдали день.",
        )


def _summary_diff_key(snapshot):
    """Оси события дня + ПИНЫ: сводка изменилась и тогда, когда изменились
    сдачи детей, даже если свой состав тот же.

    В ключ входит (подразделение, версия), но НЕ submission_id: вчера и
    сегодня дети сданы разными строками, и сравнение по id объявляло бы
    изменением каждую сводку — то есть не сравнивало бы вовсе.
    """
    pins = frozenset(
        (pin["division_id"], pin["version"]) for pin in snapshot.get("sources", [])
    )
    return (*_diff_key(snapshot), pins)


def _compute_summary_event(snapshot, previous):
    if previous is None:
        return OpsDailySubmission.Event.CHANGED
    if _summary_diff_key(snapshot) == _summary_diff_key(previous.snapshot):
        return OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
    return OpsDailySubmission.Event.CHANGED


def _sources_compact(sources):
    """Пины для журнала — без submission_id.

    Журнал хранит ЗНАЧЕНИЯ и должен читаться через год: «ребёнок такой-то,
    версия такая-то» переживёт любую чистку строк, а id строки сдачи через
    год не значит ничего.
    """
    return [
        {"division_id": pin["division_id"], "version": pin["version"]}
        for pin in sources
    ]


@transaction.atomic
def assemble_summary(
    *, division_id, business_date, actor, window_dates=None, control_hour=None
):
    """Собрать сводку дня для подразделения с детьми (версия 1, действующая).

    Порядок гардов зеркалит сдачу дня: актор → существование → окно → повтор
    → лист → сдачи детей. Он несущий: например, о том, что дети не сдали, не
    должен узнавать тот, кто назвал несуществующее подразделение.

    Отказы: 400 (пустой актор; подразделение-ЛИСТ — консолидировать некого,
    свой уровень листа сдаётся обычной сдачей), 404 (нет подразделения),
    422 (дата вне окна; SUMMARY_CHILDREN_NOT_SUBMITTED со списком не сдавших),
    409 (день уже сдан — пересборка это отдельное действие).

    Пины читаются в обычной изоляции: ребёнок, поправивший день в этот самый
    момент, оставит сводку протухшей с рождения. Это не гонка, а нормальное
    состояние — свежесть выводится на чтении, и следующий читатель увидит
    расхождение.
    """
    _require_actor(actor)

    # Существование — ДО всего: у призрака собрался бы пустой снимок, и
    # раздел записал бы «сводку» несуществующего подразделения.
    if not DivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )

    window = _default_window() if window_dates is None else list(window_dates)
    if business_date not in window:
        raise DomainError(
            "BUSINESS_DATE_OUT_OF_WINDOW",
            422,
            detail={"allowed": [day.isoformat() for day in window]},
            message="Дата сводки вне окна.",
        )

    # Повтор — по ЛЮБОЙ версии дня, тем же правилом, что и первичная сдача:
    # сводка тоже пишет версию 1 и на дне с историей упёрлась бы в
    # уникальность номера, то есть в 500 вместо внятного отказа.
    if DailySubmissionSelector.exists_for(division_id, business_date):
        raise DomainError(
            "DAY_ALREADY_SUBMITTED",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День этого подразделения уже сдан (пересборка — отдельно).",
        )

    children_map = DivisionTreeSelector.children_map()
    if not children_map.get(division_id):
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"division_id": str(division_id)},
            message="Сводка собирается только для подразделения с детьми.",
        )
    required = _required_children(division_id, children_map=children_map)
    sources = _build_sources(children_map[division_id], business_date)
    _require_children_submitted(required, sources)

    snapshot = build_division_snapshot(division_id, business_date)
    snapshot["sources"] = sources
    previous = DailySubmissionSelector.previous_for(division_id, business_date)
    event = _compute_summary_event(snapshot, previous)
    late = _is_late(
        SubmissionControlSettingsSelector.control_hour()
        if control_hour is None
        else control_hour
    )

    with transaction.atomic():
        summary = OpsDailySubmission.objects.create(
            division_id=division_id,
            business_date=business_date,
            version=1,
            is_current=True,
            event=event,
            submitted_by=actor,
            submitted_at=Clock.now(),
            late=late,
            snapshot=snapshot,
        )
    audit_service.record(
        actor=actor,
        action=audit_service.DAILY_SUMMARY_ASSEMBLED,
        entity_type=audit_service.ENTITY_SUBMISSION,
        entity_id=summary.pk,
        new_value=audit_service.submission_snapshot(summary)
        | {"sources": _sources_compact(sources)},
    )
    return summary


FRESH = "FRESH"
STALE = "STALE"


@dataclass(frozen=True)
class SummaryFreshness:
    """Свежесть сводки — ВЫВОДИТСЯ, а не хранится.

    Хранимый флаг пришлось бы кому-то гасить при каждой поправке любого
    ребёнка: раздел писал бы в чужую строку по чужому поводу, а пропущенное
    гашение оставляло бы сводку «свежей» навсегда. Здесь же протухание — это
    просто РАСХОЖДЕНИЕ пинов с текущим состоянием, и увидит его любой
    читатель, ничего не записав.

    Три оси расхождения, и различать их обязательно — они требуют разного:
    `superseded` — ребёнок поправил свой день (пересобрать), `missing` — у
    запиненного ребёнка не осталось действующей версии (разбираться с
    ребёнком), `unpinned` — появился обязанный ребёнок, которого при сборке
    не было (он должен сдать). Свернув их в один флаг, раздел сказал бы
    «пересоберите» там, где пересборка ничего не изменит.
    """

    status: str
    superseded: list
    missing: list
    unpinned: list


def summary_freshness(division_id, business_date):
    """Свежесть действующей сводки; None — сводки нет.

    None означает именно «сводки нет», а не «свежа»: действующей строки может
    не быть вовсе, а может стоять ОБЫЧНАЯ сдача (без ключа `sources`) — про
    неё вопрос свежести не имеет смысла, и ответить на него FRESH значило бы
    объявить свежей сводку, которой не существует.

    Чистое чтение: не пишет НИЧЕГО. Число запросов не зависит от количества
    детей — состояние всех читается одним current_for_many.
    """
    current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None or "sources" not in current.snapshot:
        return None
    pins = current.snapshot["sources"]

    children_map = DivisionTreeSelector.children_map()
    required = _required_children(division_id, children_map=children_map)
    # Спрашиваются ТОЛЬКО запиненные: их состояние даёт обе оси расхождения
    # с пинами. Появившийся обязанный ребёнок сюда не добавляется намеренно —
    # он виден по третьей оси, которая сравнивает пины со СПИСКОМ обязанных,
    # а не с их сдачами (источник расширял выборку нынешними детьми; проба со
    # снятым расширением осталась зелёной — читателя у них не было).
    live = DailySubmissionSelector.current_for_many(
        {pin["division_id"] for pin in pins}, business_date
    )

    superseded, missing = [], []
    # Пины уже упорядочены снимком — порядок расхождений стабилен без
    # повторной сортировки.
    for pin in pins:
        row = live.get(pin["division_id"])
        if row is None:
            missing.append(
                {
                    "division_id": pin["division_id"],
                    "pinned_version": pin["version"],
                }
            )
        elif row.version != pin["version"]:
            superseded.append(
                {
                    "division_id": pin["division_id"],
                    "pinned_version": pin["version"],
                    "current_version": row.version,
                }
            )
    pinned_ids = {pin["division_id"] for pin in pins}
    unpinned = sorted(child for child in required if child not in pinned_ids)

    return SummaryFreshness(
        status=STALE if (superseded or missing or unpinned) else FRESH,
        superseded=superseded,
        missing=missing,
        unpinned=unpinned,
    )


@transaction.atomic
def rebuild_summary(*, division_id, business_date, actor, reason, sanction):
    """Пересобрать сводку «взамен»: НОВАЯ версия поверх прежней.

    Пересборка — это поправка сводки, и устроена она ровно так же: прежняя
    версия остаётся целиком, новая несёт СВЕЖИЙ свой срез и СВЕЖИЕ пины.
    Переписать пины в существующей строке было бы соблазнительно и неверно:
    подпись под сводкой означала бы задним числом другие версии детей.

    ПЕРЕСБОРКА — ВСЕГДА ЯВНОЕ ДЕЙСТВИЕ, и оно не спрашивает, протухла ли
    сводка: свежесть выводится на чтении и к моменту записи уже могла
    измениться, а отказ «она и так свежая» заставил бы вызывающего гадать,
    пересобралось ли. Причина и санкция обязательны — как у всякой поправки.

    Окно дат не применяется (пересобирают как раз прошедшее), late=False
    (поздность — свойство акта сдачи в контрольный час, у пересборки его
    нет), и голова цепочки берётся ПОД БЛОКИРОВКОЙ: две одновременные
    пересборки обязаны выстроиться в очередь.

    Отказы: 400 (пустой актор/причина/санкция; голова цепочки — не сводка),
    404 (нет подразделения), 422 (день не сдан; дети не сдали).
    """
    _require_actor(actor)
    _require_text(reason, "reason")
    _require_text(sanction, "sanction")
    reason, sanction = reason.strip(), sanction.strip()

    if not DivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )

    latest = DailySubmissionSelector.latest_for(division_id, business_date, lock=True)
    if latest is None:
        raise DomainError(
            "NO_SUBMISSION_TO_AMEND",
            422,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="Нельзя пересобрать несданный день (нет ни одной версии).",
        )
    if "sources" not in latest.snapshot:
        # Обычная сдача пересборкой в сводку не превращается: у неё нет и
        # никогда не было заявления о версиях детей, и приписать его задним
        # числом значило бы объявить, что подразделение всё это время
        # отчитывалось за подчинённых.
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"division_id": str(division_id)},
            message="Этот день сдан обычной сдачей, а не сводкой.",
        )

    # Снимок «до» — ДО гашения флага: строка в памяти ещё несёт своё прежнее
    # is_current, иначе журнал рассказывал бы, что вытесненная версия и до
    # пересборки текущей не была.
    before = audit_service.submission_snapshot(latest)

    children_map = DivisionTreeSelector.children_map()
    required = _required_children(division_id, children_map=children_map)
    sources = _build_sources(children_map.get(division_id, []), business_date)
    _require_children_submitted(required, sources)

    snapshot = build_division_snapshot(division_id, business_date)
    snapshot["sources"] = sources

    with transaction.atomic():
        OpsDailySubmission.objects.filter(
            division_id=division_id, business_date=business_date, is_current=True
        ).update(is_current=False)
        summary = OpsDailySubmission.objects.create(
            division_id=division_id,
            business_date=business_date,
            version=latest.version + 1,
            is_current=True,
            event=OpsDailySubmission.Event.AMENDED,
            submitted_by=actor,
            submitted_at=Clock.now(),
            late=False,
            snapshot=snapshot,
            reason=reason,
            sanction=sanction,
        )
    audit_service.record(
        actor=actor,
        action=audit_service.DAILY_SUMMARY_REBUILT,
        entity_type=audit_service.ENTITY_SUBMISSION,
        entity_id=summary.pk,
        old_value=before,
        new_value=audit_service.submission_snapshot(summary)
        | {"sources": _sources_compact(sources)},
        reason=reason,
    )
    return summary
