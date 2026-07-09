"""Сервис amendment-flow (Story 5.4a): ``amend_day``.

Механизм пересдачи сданного дня НОВОЙ версией v2+ (``event=AMENDED``): новый
самосогласованный срез (билдер 5.3a) + ``version = max(version)+1`` + гашение
прежней ``is_current`` ДО вставки новой (immediate partial-unique) + причина/
санкция/ссылка на ретро-правку. Прежняя версия СОХРАНЯЕТСЯ (snapshot не правится —
ARCH-DATA-021 «не правится — вытесняется»); расход воспроизводится из снапшота
действующей версии.

Зеркало ``submit_day`` (5.3b): ``@transaction.atomic`` + вложенный savepoint
вокруг flip+INSERT; ``actor`` — keyword-only строка; время — только через
``Clock``. ОТЛИЧИЯ от первичной сдачи: ``event`` всегда ``AMENDED`` (не diff);
окно НЕ применяется (amendment — это и есть про прошлые/сданные даты); требует
существующую сдачу (иначе ``NO_SUBMISSION_TO_AMEND``).

Вне скоупа 5.4a (НЕ здесь): энфорс «ретро-правка требует amendment» + тело хука
3.9 + инверсный seam statuses↔submissions (это 5.4b — его хук
``enforce_amendment_on_retro_edit`` ВЫЗЫВАЕТ amend_day на каждый накрытый день);
права/скоуп (5.8); эскалация «санкция выше после ухода расхода наверх»
(forward-seam: расход-релиз — E6). Аудит ``DAILY_SUBMISSION_AMENDED`` (5.9)
эмитится ЗДЕСЬ — один канал на оба вызывающих (HTTP 5.8b и хук 5.4b).
"""

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services.day_submission_service import (
    _submission_audit_value,
)
from apps.operations.submissions.services.snapshot import build_division_snapshot


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")


def _require_text(value, field):
    """Непустой (после strip) обязательный атрибут amendment → иначе 400.

    Сервис отбивает пустые раньше DB-CheckConstraint
    (``chk_daily_submission_amended_requires_reason_sanction``); констрейнт —
    backstop против тихого пустого прямого ``create()``.
    """
    if not value or not value.strip():
        raise DomainError(
            "VALIDATION_ERROR", 400, message=f"{field} обязателен для amendment."
        )


@transaction.atomic
def amend_day(
    *, division_id, business_date, actor, reason, sanction, triggered_by_status_id=None
):
    """Создать следующую версию (AMENDED) сдачи дня.

    Args:
        division_id: UUID подразделения (flat, ARCH-003).
        business_date: дата сдачи (ЯВНЫЙ параметр; окно НЕ применяется).
        actor: внешний account-id (строка) → submitted_by.
        reason: причина пересдачи (обязательна, непустая).
        sanction: санкция/основание (обязательна, непустая). Правило «выше после
            ухода расхода наверх» — forward-seam (E6); здесь фиксируется как вход.
        triggered_by_status_id: опц. ссылка на EmployeeStatus (int PK) ретро-правки;
            None для ручного amendment. 5.4b передаёт её из хука 3.9.

    Returns the new is_current DailySubmission (event=AMENDED).

    Raises DomainError: 400 (actor/reason/sanction пусты), 404 ENTITY_NOT_FOUND,
        422 NO_SUBMISSION_TO_AMEND (нечего амендить). На гонке версий — НЕ raise
        напрямую: конкурентная amendment срывает unique-констрейнт → `IntegrityError`,
        который DRF-handler (`CONSTRAINT_ERROR_MAP`) маппит в 409 DAY_ALREADY_SUBMITTED.
        ВНЕ HTTP (вызыватель-сервис 5.4b) получит СЫРОЙ `IntegrityError` и обрабатывает
        сам — savepoint гарантирует целостность (flip откатан, прежняя версия цела).
        Права не гейтит (5.8); успешный amendment пишет DAILY_SUBMISSION_AMENDED
        (5.9, before/after), отклонённый и гоночный — ничего.
    """
    _require_actor(actor)
    _require_text(reason, "reason")
    _require_text(sanction, "sanction")
    # Persist trimmed: _require_text validates on .strip(), so store the trimmed
    # value — the DB never holds whitespace-padded reason/sanction, symmetric with
    # the validation and the strengthened `\S` CheckConstraint (code-review п1).
    reason, sanction = reason.strip(), sanction.strip()

    # Existence gate (404 BEFORE the snapshot build), mirror of submit_day: a
    # phantom-but-valid UUID would otherwise build an empty срез silently.
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )

    # Precondition: a day must already be submitted to be amended. latest_for
    # (not current_for) finds the chain head even in the «ноль текущих» edge, and
    # locks it (select_for_update) to serialize concurrent amendments.
    latest = DailySubmissionSelector.latest_for(division_id, business_date, lock=True)
    if latest is None:
        raise DomainError(
            "NO_SUBMISSION_TO_AMEND",
            422,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="Нельзя амендить несданный день (нет ни одной версии).",
        )

    # Audit «before» — the prior head AS IT WAS before the flip (story 5.9): the
    # in-memory `latest` still carries its pre-flip is_current, and .update()
    # below won't touch the instance. A prior head that is itself an amendment
    # (v≥2) carries its own reason/sanction/triggered_by — ride them along so
    # the before/after pair stays symmetric (code-review реш. Bratan).
    before = _submission_audit_value(latest)
    if latest.event == DailySubmission.Event.AMENDED:
        before |= {
            "reason": latest.reason,
            "sanction": latest.sanction,
            "triggered_by_status_id": latest.triggered_by_status_id,
        }

    # Re-snapshot the CORRECTED state (not a copy of v1) — a fresh self-contained
    # срез on the same business_date (ARCH-DATA-021: amendment = new version).
    snapshot = build_division_snapshot(division_id, business_date)
    # Сводка (5.11): auto-amendment (хук 5.4b по own-сотруднику) чинит «две
    # правды» ТОЛЬКО для own-строк — пины ``sources`` переезжают VERBATIM из
    # вытесняемой версии (НЕ пере-пиновка свежих версий детей): консолидация
    # обновляется исключительно явной пересборкой (rebuild_summary). Aliasing
    # безопасен: ``latest`` после транзакции не используется, ``create()``
    # сериализует значение в JSONB.
    if "sources" in latest.snapshot:
        snapshot["sources"] = latest.snapshot["sources"]
    version = latest.version + 1

    # Flip-before-insert: clear the prior is_current BEFORE inserting the new one —
    # the immediate partial-unique (unique_daily_submission_current) forbids two
    # current rows mid-txn, so the reverse order would trip it (5.2 review BH-2).
    # Nested savepoint: a concurrent amendment trips a unique constraint → 409 via
    # CONSTRAINT_ERROR_MAP without poisoning the caller's transaction.
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
            # late — поздность осмысленна для первичной сдачи (после 17:00), не для
            # пересдачи; amendment всегда late=False (Решение №5).
            late=False,
            snapshot=snapshot,
            reason=reason,
            sanction=sanction,
            triggered_by_status_id=triggered_by_status_id,
        )
    # Audit (story 5.9) AFTER the savepoint commits, in the ambient txn (canon
    # 4.4): a version-race IntegrityError above propagates out before reaching
    # here, so a rolled-back amendment leaves no audit row. Both callers (HTTP
    # 5.8b and the 5.4b retro-edit hook) are covered by this single emission.
    record(
        actor=actor,
        action="DAILY_SUBMISSION_AMENDED",
        entity_type="daily_submission",
        entity_id=division_id,
        old_value=before,
        new_value=_submission_audit_value(submission)
        | {
            "reason": reason,
            "sanction": sanction,
            "triggered_by_status_id": triggered_by_status_id,
        },
        reason=reason,
    )
    return submission
