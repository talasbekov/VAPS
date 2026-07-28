"""Story 7.7 — «без двойного ввода» gateway (mirrors ``apps.core.watermark``).

The core-owned access point for ``ParallelRunModeSwitch``/
``ParallelRunPilotDivision``, so other contexts (``apps.operations``,
``apps.parallel_run``) never import ``apps.core.models`` directly
(ARCH-003/004). No row in ``ParallelRunModeSwitch`` = disabled — the
default state on a fresh DB, critical for zero regression of existing
manual-input write paths that predate this story.

Mutators (``enable``/``disable``/``add_pilot_division``/
``remove_pilot_division``) require ``actor`` and audit via
``apps.audit.services.record`` (ревью-фикс: a switch that gates a
production write path is exactly the kind of state change this codebase's
audit convention exists for — who flipped it and when must be traceable,
not just visible as a bare timestamp on the row).
"""

import uuid

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.models import ParallelRunModeSwitch, ParallelRunPilotDivision

_KEY = "default"
# AuditLog.entity_id is a UUIDField; the switch is a singleton config row
# with an integer pk (no natural UUID) — a fixed, deterministic namespace-id
# gives it a stable audit identity across enable/disable events.
_SWITCH_ENTITY_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "vaps.parallel_run_mode_switch")


def is_enabled():
    switch = ParallelRunModeSwitch.objects.filter(key=_KEY).first()
    return switch is not None and switch.enabled


def get_deadline():
    switch = ParallelRunModeSwitch.objects.filter(key=_KEY).first()
    return switch.deadline if switch is not None else None


def is_cutover_complete():
    """Story 7.10/AC-3: третье состояние, отличное от голого ``enabled``
    — оператор может выключить пилот по другой причине, не только через
    настоящий cutover."""
    switch = ParallelRunModeSwitch.objects.filter(key=_KEY).first()
    return switch is not None and switch.cutover_completed_at is not None


@transaction.atomic
def enable(*, actor, deadline):
    """Story 7.8/AC-1: «дедлайн до старта» — записывается В МОМЕНТ включения,
    не постфактум отдельной командой.

    Ревью-фикс (Story 7.10, Blind Hunter): очищает ``cutover_completed_at``
    — без этого прямой повторный ``enable()`` после ``mark_cutover_complete()``
    (не через ``rollback_cutover()``) оставлял бы ``enabled=True`` И
    ``cutover_completed_at`` не-``None`` одновременно — ровно то
    противоречивое состояние, от которого третье cutover-состояние должно
    быть застраховано (см. докстринг поля в ``apps/core/models.py``)."""
    if deadline is None:
        raise ValueError("deadline обязателен при включении режима (Story 7.8/AC-1)")
    now = timezone.now()
    switch, _created = ParallelRunModeSwitch.objects.update_or_create(
        key=_KEY,
        defaults={
            "enabled": True,
            "enabled_at": now,
            "deadline": deadline,
            "cutover_completed_at": None,
        },
    )
    record(
        actor=actor,
        action="PARALLEL_RUN_MODE_ENABLED",
        entity_type="parallel_run_mode",
        entity_id=_SWITCH_ENTITY_ID,
    )
    return switch


@transaction.atomic
def disable(*, actor):
    """AC-2: явный выключатель, срабатывающий при cutover (Story 7.10)."""
    now = timezone.now()
    switch, _created = ParallelRunModeSwitch.objects.update_or_create(
        key=_KEY, defaults={"enabled": False, "disabled_at": now}
    )
    record(
        actor=actor,
        action="PARALLEL_RUN_MODE_DISABLED",
        entity_type="parallel_run_mode",
        entity_id=_SWITCH_ENTITY_ID,
    )
    return switch


@transaction.atomic
def mark_cutover_complete(*, actor):
    """Story 7.10/AC-3: официальный канал расхода = VAPS. Exit-criterion
    gating (AC-1) happens at the caller — ``apps.parallel_run.cutover`` —
    same boundary as ``enable()``/``disable()`` not owning the pilot-mode
    business rules that trigger them."""
    now = timezone.now()
    switch, _created = ParallelRunModeSwitch.objects.update_or_create(
        key=_KEY,
        defaults={"enabled": False, "disabled_at": now, "cutover_completed_at": now},
    )
    record(
        actor=actor,
        action="PARALLEL_RUN_CUTOVER_COMPLETED",
        entity_type="parallel_run_mode",
        entity_id=_SWITCH_ENTITY_ID,
    )
    return switch


@transaction.atomic
def rollback_cutover(*, actor, deadline):
    """Откат на донора: re-enable + очистка ``cutover_completed_at`` —
    новый ``deadline`` обязателен (тот же контракт, что ``enable()``,
    Story 7.8: следующая попытка получает свой собственный дедлайн).

    Ревью-фикс (Edge Case Hunter): отказывает, если cutover НИКОГДА не был
    завершён — иначе это "откат" события, которого не было, с ложной
    audit-записью ``PARALLEL_RUN_CUTOVER_ROLLED_BACK`` (footgun: оператор,
    хотевший просто продлить дедлайн, случайно пишет в audit trail
    несуществующий откат)."""
    if deadline is None:
        raise ValueError("deadline обязателен при откате (см. enable(), Story 7.8)")
    if not is_cutover_complete():
        raise ValueError(
            "откат невозможен: cutover ещё не был завершён "
            "(rollback_cutover — только для реального отката, не для "
            "продления дедлайна активного parallel-run — используйте enable())"
        )
    now = timezone.now()
    switch, _created = ParallelRunModeSwitch.objects.update_or_create(
        key=_KEY,
        defaults={
            "enabled": True,
            "enabled_at": now,
            "deadline": deadline,
            "cutover_completed_at": None,
        },
    )
    record(
        actor=actor,
        action="PARALLEL_RUN_CUTOVER_ROLLED_BACK",
        entity_type="parallel_run_mode",
        entity_id=_SWITCH_ENTITY_ID,
    )
    return switch


def is_pilot_division(division_id):
    return ParallelRunPilotDivision.objects.filter(division_id=division_id).exists()


@transaction.atomic
def add_pilot_division(division_id, *, actor):
    """Ревью-фикс: валидирует, что подразделение реально существует —
    иначе typo'd UUID молча создаёт "исключение", которое никогда ни с чем
    не совпадёт (ложное чувство защиты у оператора). Через селектор
    (ARCH-003), не прямой импорт ``Division``."""
    from apps.core.selectors import CoreDivisionTreeSelector

    if not CoreDivisionTreeSelector.exists(division_id):
        raise ValueError(f"division {division_id} does not exist")
    _obj, created = ParallelRunPilotDivision.objects.get_or_create(
        division_id=division_id
    )
    if created:
        record(
            actor=actor,
            action="PARALLEL_RUN_PILOT_DIVISION_ADDED",
            entity_type="parallel_run_mode",
            entity_id=division_id,
        )


@transaction.atomic
def remove_pilot_division(division_id, *, actor):
    deleted, _ = ParallelRunPilotDivision.objects.filter(
        division_id=division_id
    ).delete()
    if deleted:
        record(
            actor=actor,
            action="PARALLEL_RUN_PILOT_DIVISION_REMOVED",
            entity_type="parallel_run_mode",
            entity_id=division_id,
        )


def pilot_division_count():
    return ParallelRunPilotDivision.objects.count()
