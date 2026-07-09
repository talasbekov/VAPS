"""Сервис фрактальной сводки (Story 5.11): ``assemble_summary`` /
``summary_freshness`` / ``rebuild_summary``.

Сводка уровня выше — ТА ЖЕ сущность ``DailySubmission`` родительского
подразделения (ARCH-DATA-021 «Фрактальность»: одна модель на все эшелоны),
новая строка поверх own-среза билдера 5.3a с additive-ключом ``sources`` —
иммутабельными пинами действующих сдач ПРЯМЫХ детей
``[{"division_id", "submission_id", "version"}]``. Модель/миграции не меняются
(JSONField покрывает additive-ключ; ``schema_version`` НЕ бампается — roster/
rows на месте, существующие потребители не затронуты).

Три кита дизайна:

1. **Roster сводки строго own-level** (штаб родителя), НЕ union детей — иначе
   ``covering()`` (JSONB containment по roster) втянул бы сводку в
   авто-amendment хука 5.4b при ретро-правке сотрудника РЕБЁНКА, убив
   «пересборка — явным действием» (AC-2 эпика).
2. **Свежесть derived, не хранится** — ``summary_freshness`` сравнивает пины с
   текущими версиями детей на чтении и НИЧЕГО не пишет (property 5.10 пинит
   байт-иммутабельность существующих строк).
3. **Пересборка = amendment сводки** (v+1, event=AMENDED, свежий own-срез И
   свежие пины) — «новый номер „взамен"» на уровне сущности это version-chain;
   документный «взамен исх.№» — forward-seam E6 (6.2/6.5/6.7).

Фрактальный каскад БЕЗ автоматики: leaf пересдал → сводка mid протухла
(derived); mid пересобрался ЯВНО → протухла сводка root; root пересобирается
явно. Протухание идёт по уровням, не транзитивно; ни одна операция не создаёт
версий у других подразделений.

Зеркала: ``assemble_summary`` ↔ ``submit_day`` (порядок валидаций, savepoint,
аудит после), ``rebuild_summary`` ↔ ``amend_day`` (flip-before-insert,
before-payload, ``late=False``). Приватные хелперы импортируются из
``day_submission_service``/``amendment_service`` — in-app прецедент (Д9).
Сервис-слой без API/RBAC (Д8): actor — opaque строка, роуты — будущая стори.
"""

import uuid
from dataclasses import dataclass

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector, HistoricalEmployeeSelector
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services.amendment_service import _require_text
from apps.operations.submissions.services.day_submission_service import (
    _default_window,
    _diff_key,
    _is_late,
    _require_actor,
    _submission_audit_value,
)
from apps.operations.submissions.services.snapshot import build_division_snapshot

FRESH = "FRESH"
STALE = "STALE"


@dataclass(frozen=True)
class SummaryFreshness:
    """Derived-свежесть сводки (читается, никогда не пишется).

    ``status`` — FRESH/STALE. Три оси STALE (Д3): ``superseded`` — запиненная
    версия ребёнка вытеснена новой; ``missing`` — у запиненного ребёнка не
    осталось current-версии (§82.1-класс «ноль текущих»); ``unpinned`` —
    появился required-ребёнок вне пинов. Все оси пусты ⇔ FRESH.
    """

    status: str
    superseded: list
    missing: list
    unpinned: list


def _coerce_division_id(division_id):
    """UUID-коэрция (зеркало build_division_snapshot): ``children_map``/
    ``roster_on`` ключуются uuid.UUID — str прошёл бы мимо ключей и молча дал
    «лист»/пустой ростер; мусорный id падает громко (ValueError)."""
    if not isinstance(division_id, uuid.UUID):
        division_id = uuid.UUID(str(division_id))
    return division_id


def _require_division(division_id):
    """Existence-гейт 404 (зеркало submit_day) — фантомный UUID не должен молча
    собрать пустую сводку."""
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )


def _required_children(division_id, business_date, *, children_map):
    """Required-подмножество прямых детей: непустой own-ростер ПОДДЕРЕВА на дату.

    Зеркало NEUTRAL-семантики 5.5b: ребёнку, в чьём поддереве некому сдавать,
    нечего консолидировать — его отсутствие не блокирует (exempt). Деактивация
    Division здесь не фильтруется (children_map full-scan без is_active):
    пустой exempt-ребёнок выпадает через это же правило, непустой — честно
    required. ОДИН bulk ``roster_on`` на всех потомков всех детей (Ловушка №6:
    НЕ per-node), ``subtree_ids`` переиспользует переданный children_map.
    """
    direct = children_map.get(division_id, [])
    subtree_by_child = {
        child: CoreDivisionTreeSelector.subtree_ids(child, children_map=children_map)
        for child in direct
    }
    all_descendants = set().union(*subtree_by_child.values()) if direct else set()
    roster = HistoricalEmployeeSelector.roster_on(business_date, all_descendants)
    return [
        child
        for child, subtree in subtree_by_child.items()
        if any(roster.get(node) for node in subtree)
    ]


def _build_sources(direct_children, business_date):
    """Пины действующих сдач прямых детей — required И non-required (сдавший
    пустой день пинится: пустой день валиден, 5.3b). ОДИН ``current_for_many``;
    сортировка по division_id — детерминизм, зеркало сортировок билдера.
    JSON-safe типы: uuid → str (зеркало roster), pk/version — int."""
    submitted = DailySubmissionSelector.current_for_many(direct_children, business_date)
    return sorted(
        (
            {
                "division_id": str(child_id),
                "submission_id": row.pk,
                "version": row.version,
            }
            for child_id, row in submitted.items()
        ),
        key=lambda pin: pin["division_id"],
    )


def _require_children_submitted(required, sources):
    """Required-гейт (AC-2): каждый required-ребёнок обязан иметь current-сдачу
    (т.е. пин). Laggards — sorted by str, зеркало ``tomorrow_block``."""
    pinned = {pin["division_id"] for pin in sources}
    laggards = sorted(str(child) for child in required if str(child) not in pinned)
    if laggards:
        raise DomainError(
            "SUMMARY_CHILDREN_NOT_SUBMITTED",
            422,
            detail={"laggards": laggards},
            message="Не все required-дети сдали день — сводку собрать нельзя.",
        )


def _sources_compact(sources):
    """Аудит-компакт пинов (Д7): без submission_id, канон лёгкого payload 5.9."""
    return [
        {"division_id": pin["division_id"], "version": pin["version"]}
        for pin in sources
    ]


def _summary_diff_key(snapshot):
    """Оси ``_diff_key`` (own roster/rows) + пины (division_id, version) —
    ``submission_id`` исключён: вчера и сегодня дети сданы разными строками,
    но одинаковая версия одного ребёнка не делает сводку CHANGED (Д6).
    Кросс-датный шум версий даёт консервативный CHANGED — приемлемо."""
    pins = frozenset(
        (pin["division_id"], pin["version"]) for pin in snapshot.get("sources", [])
    )
    return (*_diff_key(snapshot), pins)


def _compute_summary_event(snapshot, previous):
    """CONFIRMED_NO_CHANGES если own-срез и пины совпали со вчерашней сводкой,
    иначе CHANGED; первая сводка (нет предыдущей) → CHANGED (зеркало 5.3b)."""
    if previous is None:
        return DailySubmission.Event.CHANGED
    if _summary_diff_key(snapshot) == _summary_diff_key(previous.snapshot):
        return DailySubmission.Event.CONFIRMED_NO_CHANGES
    return DailySubmission.Event.CHANGED


@transaction.atomic
def assemble_summary(*, division_id, business_date, actor, window_dates=None):
    """Собрать сводку дня родительского подразделения (v1, is_current).

    Снапшот = own-срез билдера 5.3a (roster/rows строго own-level — Ловушка №1)
    + ``sources`` — пины ВСЕХ прямых детей с current-сдачей. Порядок валидаций
    зеркалит ``submit_day``: actor → existence → окно → дубль → лист (Д10) →
    required-гейт. Пины читаются под READ COMMITTED — конкурентный amend
    ребёнка даст сводку, протухшую с рождения: корректно, derived-свежесть
    обнаружит (зеркало оговорки 5.3b).

    Raises DomainError: 400 (actor пуст / подразделение-лист), 404
        ENTITY_NOT_FOUND, 422 BUSINESS_DATE_OUT_OF_WINDOW /
        SUMMARY_CHILDREN_NOT_SUBMITTED (detail.laggards), 409
        DAY_ALREADY_SUBMITTED. Успех пишет DAILY_SUMMARY_ASSEMBLED (Д7).
    """
    _require_actor(actor)
    division_id = _coerce_division_id(division_id)
    _require_division(division_id)

    window = window_dates if window_dates is not None else _default_window()
    if business_date not in window:
        raise DomainError(
            "BUSINESS_DATE_OUT_OF_WINDOW",
            422,
            detail={"allowed": [d.isoformat() for d in window]},
            message="business_date вне окна первичной сдачи.",
        )

    if DailySubmissionSelector.current_for(division_id, business_date) is not None:
        raise DomainError(
            "DAY_ALREADY_SUBMITTED",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="Сводка за этот день уже действует (пересборка — rebuild).",
        )

    children_map = CoreDivisionTreeSelector.children_map()
    if not children_map.get(division_id):
        # Д10: сводка — консолидация ПРЯМЫХ детей; листу консолидировать некого
        # (own-уровень листа сдаёт submit_day).
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="Сводка собирается только для подразделения с детьми.",
        )
    required = _required_children(division_id, business_date, children_map=children_map)
    sources = _build_sources(children_map[division_id], business_date)
    _require_children_submitted(required, sources)

    snapshot = build_division_snapshot(division_id, business_date)
    snapshot["sources"] = sources
    previous = DailySubmissionSelector.previous_for(division_id, business_date)
    event = _compute_summary_event(snapshot, previous)
    late = _is_late()

    # Вложенный savepoint (зеркало submit_day): конкурентная сборка срывает
    # unique_daily_submission_current → IntegrityError наружу чисто, 409 через
    # существующий CONSTRAINT_ERROR_MAP (Ловушка №8 — новых маппингов нет).
    with transaction.atomic():
        submission = DailySubmission.objects.create(
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
    # Аудит ПОСЛЕ savepoint в ambient-транзакции (канон 4.4): гоночный
    # IntegrityError выше пробрасывается до record — фантом невозможен.
    record(
        actor=actor,
        action="DAILY_SUMMARY_ASSEMBLED",
        entity_type="daily_submission",
        entity_id=division_id,
        old_value=None,
        new_value=_submission_audit_value(submission)
        | {"sources": _sources_compact(sources)},
    )
    return submission


def summary_freshness(division_id, business_date):
    """Derived-свежесть сводки (AC-3): чистое чтение, НИЧЕГО не пишет.

    None — нет действующей сводки на (division, date): нет current-строки ИЛИ
    current без ключа ``sources`` (обычная сдача). Иначе пины сравниваются с
    текущим состоянием детей: версия разошлась → ``superseded``; пиненный без
    current → ``missing``; required-ребёнок вне пинов → ``unpinned``. Бюджет —
    4 канала чтения (current_for + children_map + roster_on + current_for_many),
    инвариантно числу детей (NFR-4; roster_on внутри — 2 SELECT'а).
    """
    division_id = _coerce_division_id(division_id)
    current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None or "sources" not in current.snapshot:
        return None
    pins = current.snapshot["sources"]

    children_map = CoreDivisionTreeSelector.children_map()
    required = _required_children(division_id, business_date, children_map=children_map)
    pinned_ids = [uuid.UUID(pin["division_id"]) for pin in pins]
    live = DailySubmissionSelector.current_for_many(
        set(pinned_ids) | set(children_map.get(division_id, [])), business_date
    )

    superseded, missing = [], []
    for pin in pins:  # пины уже отсортированы по division_id — порядок стабилен
        row = live.get(uuid.UUID(pin["division_id"]))
        if row is None:
            missing.append(
                {"division_id": pin["division_id"], "pinned_version": pin["version"]}
            )
        elif row.version != pin["version"]:
            superseded.append(
                {
                    "division_id": pin["division_id"],
                    "pinned_version": pin["version"],
                    "current_version": row.version,
                }
            )
    pinned_set = {pin["division_id"] for pin in pins}
    unpinned = sorted(str(child) for child in required if str(child) not in pinned_set)

    status = STALE if (superseded or missing or unpinned) else FRESH
    return SummaryFreshness(
        status=status, superseded=superseded, missing=missing, unpinned=unpinned
    )


@transaction.atomic
def rebuild_summary(*, division_id, business_date, actor, reason, sanction):
    """Пересобрать сводку «взамен» (AC-4): amendment-flow над той же цепочкой.

    Новая версия v+1 (event=AMENDED) со СВЕЖИМ own-срезом И СВЕЖИМИ пинами
    (required-гейт применяется). Окно НЕ применяется (amendment — про прошлые
    даты); drift-гейта НЕТ — пересборка свежей сводки легальна (явное действие
    с причиной под аудитом, Д4). reason/sanction обязательны и валидируются ДО
    вставки (Ловушка №4: DB-констрейнт AMENDED — лишь backstop); ``late=False``
    (Решение №5). Прежняя версия сохраняется байт-в-байт (flip is_current).

    Raises DomainError: 400 (actor/reason/sanction пусты; head цепочки без
        ``sources`` — Д10: конверсия обычной сдачи в сводку вне скоупа), 404
        ENTITY_NOT_FOUND, 422 NO_SUBMISSION_TO_AMEND /
        SUMMARY_CHILDREN_NOT_SUBMITTED. Успех пишет DAILY_SUMMARY_REBUILT
        (before/after, Д7).
    """
    _require_actor(actor)
    _require_text(reason, "reason")
    _require_text(sanction, "sanction")
    # Persist trimmed (зеркало amend_day): БД не держит пробельную обвязку.
    reason, sanction = reason.strip(), sanction.strip()
    division_id = _coerce_division_id(division_id)
    _require_division(division_id)

    # latest_for(lock=True), не current_for: head цепочки даже в «ноль текущих»
    # + select_for_update сериализует конкурентные пересборки (Ловушка №5).
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
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="Head цепочки — не сводка (нет sources); пересборка неприменима.",
        )

    # before-payload — head КАК БЫЛ до flip (зеркало amend_day:121-127).
    before = _submission_audit_value(latest)
    if latest.event == DailySubmission.Event.AMENDED:
        before |= {
            "reason": latest.reason,
            "sanction": latest.sanction,
            "triggered_by_status_id": latest.triggered_by_status_id,
        }

    children_map = CoreDivisionTreeSelector.children_map()
    required = _required_children(division_id, business_date, children_map=children_map)
    sources = _build_sources(children_map.get(division_id, []), business_date)
    _require_children_submitted(required, sources)

    snapshot = build_division_snapshot(division_id, business_date)
    snapshot["sources"] = sources
    version = latest.version + 1

    # Flip-before-insert (зеркало amend_day:139-158): immediate partial-unique
    # не даёт двум current-строкам жить mid-txn — обратный порядок споткнётся.
    with transaction.atomic():
        DailySubmission.objects.filter(
            division_id=division_id, business_date=business_date, is_current=True
        ).update(is_current=False)
        submission = DailySubmission.objects.create(
            division_id=division_id,
            business_date=business_date,
            version=version,
            is_current=True,
            event=DailySubmission.Event.AMENDED,
            submitted_by=actor,
            submitted_at=Clock.now(),
            late=False,
            snapshot=snapshot,
            reason=reason,
            sanction=sanction,
        )
    record(
        actor=actor,
        action="DAILY_SUMMARY_REBUILT",
        entity_type="daily_submission",
        entity_id=division_id,
        old_value=before,
        new_value=_submission_audit_value(submission)
        | {
            "sources": _sources_compact(sources),
            "reason": reason,
            "sanction": sanction,
        },
        reason=reason,
    )
    return submission
