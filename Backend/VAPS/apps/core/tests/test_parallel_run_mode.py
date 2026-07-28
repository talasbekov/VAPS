"""Story 7.7 — gateway ``apps.core.parallel_run_mode`` (mirrors watermark).

Мутаторы требуют ``actor`` (audit) и (``add_pilot_division``) реально
существующее подразделение — ревью-фиксы, см. модуль."""

import datetime
import uuid

import pytest

from apps.core import parallel_run_mode
from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-PRM-GW")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="PRM-GW-A"
    )


def test_default_disabled_no_row():
    assert parallel_run_mode.is_enabled() is False


def test_enable_then_disable():
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))
    assert parallel_run_mode.is_enabled() is True

    parallel_run_mode.disable(actor="bratan")
    assert parallel_run_mode.is_enabled() is False


def test_enable_is_idempotent_single_row():
    from apps.core.models import ParallelRunModeSwitch

    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))
    assert ParallelRunModeSwitch.objects.count() == 1


def test_enable_requires_actor():
    with pytest.raises(ValueError):
        parallel_run_mode.enable(actor="", deadline=datetime.date(2030, 1, 1))


def test_enable_requires_deadline():
    """Story 7.8/AC-1: "дедлайн до старта" — enable() отказывает без него."""
    with pytest.raises(ValueError, match="deadline"):
        parallel_run_mode.enable(actor="bratan", deadline=None)


def test_enable_records_deadline():
    from apps.core.models import ParallelRunModeSwitch

    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 5, 1))

    assert parallel_run_mode.get_deadline() == datetime.date(2030, 5, 1)
    assert ParallelRunModeSwitch.objects.get().deadline == datetime.date(2030, 5, 1)


def test_mark_cutover_complete_disables_and_flags_official_channel():
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))

    parallel_run_mode.mark_cutover_complete(actor="bratan")

    assert parallel_run_mode.is_enabled() is False
    assert parallel_run_mode.is_cutover_complete() is True


def test_plain_disable_does_not_flag_cutover():
    """Story 7.10/AC-3: обычный disable() (не cutover) НЕ должен молча
    выглядеть как "официальный канал = VAPS" — третье состояние отличимо."""
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))

    parallel_run_mode.disable(actor="bratan")

    assert parallel_run_mode.is_enabled() is False
    assert parallel_run_mode.is_cutover_complete() is False


def test_rollback_cutover_reenables_and_clears_cutover_flag():
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))
    parallel_run_mode.mark_cutover_complete(actor="bratan")

    parallel_run_mode.rollback_cutover(
        actor="bratan", deadline=datetime.date(2031, 1, 1)
    )

    assert parallel_run_mode.is_enabled() is True
    assert parallel_run_mode.is_cutover_complete() is False
    assert parallel_run_mode.get_deadline() == datetime.date(2031, 1, 1)


def test_rollback_cutover_requires_deadline():
    with pytest.raises(ValueError, match="deadline"):
        parallel_run_mode.rollback_cutover(actor="bratan", deadline=None)


def test_rollback_cutover_rejected_when_cutover_never_completed():
    """Ревью-фикс (Edge Case Hunter): "откат" события, которого не было, —
    footgun с ложной audit-записью."""
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))

    with pytest.raises(ValueError, match="cutover ещё не был завершён"):
        parallel_run_mode.rollback_cutover(
            actor="bratan", deadline=datetime.date(2031, 1, 1)
        )


def test_reenable_after_cutover_clears_stale_cutover_flag():
    """Ревью-фикс (Blind Hunter): прямой enable() после mark_cutover_complete()
    (в обход rollback_cutover()) не должен оставлять enabled=True И
    cutover_completed_at не-None одновременно."""
    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2030, 1, 1))
    parallel_run_mode.mark_cutover_complete(actor="bratan")
    assert parallel_run_mode.is_cutover_complete() is True

    parallel_run_mode.enable(actor="bratan", deadline=datetime.date(2032, 1, 1))

    assert parallel_run_mode.is_enabled() is True
    assert parallel_run_mode.is_cutover_complete() is False


def test_pilot_division_add_remove(division):
    assert parallel_run_mode.is_pilot_division(division.id) is False

    parallel_run_mode.add_pilot_division(division.id, actor="bratan")
    assert parallel_run_mode.is_pilot_division(division.id) is True
    assert parallel_run_mode.pilot_division_count() == 1

    parallel_run_mode.remove_pilot_division(division.id, actor="bratan")
    assert parallel_run_mode.is_pilot_division(division.id) is False
    assert parallel_run_mode.pilot_division_count() == 0


def test_add_pilot_division_twice_is_idempotent(division):
    from apps.core.models import ParallelRunPilotDivision

    parallel_run_mode.add_pilot_division(division.id, actor="bratan")
    parallel_run_mode.add_pilot_division(division.id, actor="bratan")
    assert ParallelRunPilotDivision.objects.count() == 1


def test_add_pilot_division_nonexistent_rejected():
    """Ревью-фикс: typo'd/несуществующий UUID больше не создаёт молчаливо
    бесполезное "исключение" (никогда ни с чем не совпадёт)."""
    with pytest.raises(ValueError, match="does not exist"):
        parallel_run_mode.add_pilot_division(uuid.uuid4(), actor="bratan")
