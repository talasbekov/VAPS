"""Сервис сдачи дня (Story 5.3b): ``submit_day``.

Первый писатель рядов DailySubmission: окно-422 + дубль-409 + diff-event
(CONFIRMED_NO_CHANGES/CHANGED против вчерашнего снапшота) + late + атомарное
создание v1 поверх среза 5.3a (``build_division_snapshot``). Зеркало
``status_service``: ``@transaction.atomic`` + вложенный savepoint вокруг
racy-INSERT; ``actor`` — keyword-only строка; время — только через ``Clock``.
Аудит НЕ пишет (эмиссия ``DAILY_SUBMISSION_SUBMITTED`` — 5.9); права/скоуп НЕ
гейтит (5.8). ``business_date`` — ЯВНЫЙ параметр (ARCH-DATA-022, не из часов).
"""

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import (
    DailySubmissionSelector,
    SubmissionControlSettingsSelector,
)
from apps.operations.submissions.services.snapshot import build_division_snapshot


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")


def _default_window():
    """Окно по умолчанию: today + tomorrow («за день вперёд» основной + коррекция)."""
    today = Clock.today_local()
    return [today, today + timedelta(days=1)]


def _is_late():
    """late = сдача после контрольного часа (local time-of-day > control_hour).

    День-независимо (контрольный час — дедлайн самого акта сдачи); граница строгая
    («после 17:00»). Решение №3.
    """
    control_hour = SubmissionControlSettingsSelector.control_hour()
    local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
    return local_now.time() > control_hour


def _diff_key(snapshot):
    """Нормализованное derive-релевантное содержимое снапшота для diff-event.

    Сравнивает denominator (roster employee_ids) + интервалы-факты; исключает
    денорм-лейблы (full_name/rank), status_id и schema_version — rename или
    delete+recreate идентичного факта НЕ должны читаться как CHANGED.
    """
    roster = frozenset(row["employee_id"] for row in snapshot.get("roster", []))
    facts = frozenset(
        (
            row["employee_id"],
            row["status_type_code"],
            row["date_start"],
            row["date_end"],
            row["source"],
        )
        for row in snapshot.get("rows", [])
    )
    return roster, facts


def _compute_event(snapshot, previous):
    """CONFIRMED_NO_CHANGES если срез совпал с вчерашним снапшотом, иначе CHANGED.
    Первая сдача (нет предыдущей) → CHANGED."""
    if previous is None:
        return DailySubmission.Event.CHANGED
    if _diff_key(snapshot) == _diff_key(previous.snapshot):
        return DailySubmission.Event.CONFIRMED_NO_CHANGES
    return DailySubmission.Event.CHANGED


@transaction.atomic
def submit_day(*, division_id, business_date, actor, window_dates=None):
    """Сдать день: атомарный срез + diff-event + late + создание DailySubmission v1.

    Args:
        division_id: UUID подразделения (flat, ARCH-003).
        business_date: дата сдачи (ЯВНЫЙ параметр, не из часов).
        actor: внешний account-id оператора (строка) → submitted_by.
        window_dates: допустимые даты сдачи; None → default {today, tomorrow}.

    Raises DomainError: 400 (actor пуст), 422 BUSINESS_DATE_OUT_OF_WINDOW,
        409 DAY_ALREADY_SUBMITTED. Аудит не пишет (5.9), права не гейтит (5.8).
    """
    _require_actor(actor)

    # Existence gate (404 BEFORE the snapshot build): a valid-but-phantom UUID
    # would otherwise yield an empty roster/rows and a SILENT сдача for a division
    # that does not exist. 5.3a deferred EC-4 → closed here; the service guards the
    # invariant regardless of the 5.8 API layer. Scope/403 stays 5.8.
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )

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
            message="Подразделение уже сдало этот день (пересдача — amendment 5.4).",
        )

    # Snapshot read + row create commit together (@transaction.atomic) — a failure
    # rolls back both. NB: under Postgres default READ COMMITTED this is NOT
    # cross-statement snapshot isolation; the builder's separate SELECTs can each
    # see a newer committed state. Structural consistency (rows ⊆ roster) holds by
    # construction (facts scoped to the roster set); a benign sub-second skew
    # between the roster read and the facts read is accepted (AC-6). Bump the
    # submit transaction to REPEATABLE READ if a strict point-in-time snapshot is
    # ever required.
    snapshot = build_division_snapshot(division_id, business_date)
    previous = DailySubmissionSelector.previous_for(division_id, business_date)
    event = _compute_event(snapshot, previous)
    late = _is_late()

    # Nested savepoint: a concurrent сдача trips unique_daily_submission_current;
    # the savepoint rolls back cleanly and the IntegrityError surfaces as 409 via
    # CONSTRAINT_ERROR_MAP without poisoning the caller's transaction.
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
    return submission
