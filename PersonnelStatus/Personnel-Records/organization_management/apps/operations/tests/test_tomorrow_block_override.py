"""Законный обход блокировки завтрашнего дня: запись, ограничения и врезка.

Три половины. Первая — ответственность: обход обязан нести кто и почему, и
непустоту держит БАЗА, а не гард сервиса (сервисы раздела ходят через
.create(), которая full_clean не зовёт). Вторая — состояние: повтор на дату
это 409, а не 400, и берётся он из уникальности, а не из предпроверки.
Третья — сквозняк: записанный обход обязан менять вывод блокировки, иначе
строка была бы украшением.
"""
from datetime import date, timedelta

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.block_override import (
    override_tomorrow_block,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.operations.tomorrow_block import tomorrow_block

pytestmark = pytest.mark.django_db

ACTOR = "7"
DAY = date(2026, 8, 6)
REASON = "решение руководителя: расход нужен сегодня"


def set_required(division_ids):
    row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    row.required_division_ids = list(division_ids)
    row.save(update_fields=["required_division_ids"])


def a_laggard():
    """Обязанное подразделение, которое ничего не сдавало."""
    division = Division.objects.create(name="Отстающее")
    set_required([division.id])
    return division


# ── Ответственность ──────────────────────────────────────────────────────


def test_override_records_who_when_and_why():
    override = override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)

    assert override.business_date == DAY
    assert override.overridden_by == ACTOR
    assert override.reason == REASON
    assert override.created_at is not None


def test_actor_and_reason_are_stored_stripped():
    override = override_tomorrow_block(
        business_date=DAY, actor=f"  {ACTOR}  ", reason=f"  {REASON}  "
    )

    assert override.overridden_by == ACTOR
    assert override.reason == REASON


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_override_without_a_reason_is_rejected(reason):
    with pytest.raises(DomainError) as exc:
        override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=reason)

    assert exc.value.http_status == 400
    assert OpsTomorrowBlockOverride.objects.count() == 0


@pytest.mark.parametrize("actor", ["", "   ", None])
def test_override_without_an_actor_is_rejected(actor):
    with pytest.raises(DomainError) as exc:
        override_tomorrow_block(business_date=DAY, actor=actor, reason=REASON)

    assert exc.value.http_status == 400
    assert OpsTomorrowBlockOverride.objects.count() == 0


def test_a_moment_in_time_is_not_a_business_date():
    """datetime — тоже date по наследованию, и колонка усекла бы его молча.

    Обход, отправленный «на 6 августа 14:30», стал бы обходом на весь день —
    решением шире принятого, о котором никто не просил.
    """
    with pytest.raises(DomainError) as exc:
        override_tomorrow_block(
            business_date=clock.Clock.now(), actor=ACTOR, reason=REASON
        )

    assert exc.value.http_status == 400
    assert OpsTomorrowBlockOverride.objects.count() == 0


@pytest.mark.parametrize("blank", ["", "   "])
def test_the_database_rejects_a_blank_reason_bypassing_the_service(blank):
    # Гард сервиса — не последняя линия: .create() не зовёт full_clean, и
    # инвариант, живущий только в коде, обходит любой перенос данных.
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsTomorrowBlockOverride.objects.create(
            business_date=DAY, overridden_by=ACTOR, reason=blank
        )


@pytest.mark.parametrize("blank", ["", "   "])
def test_the_database_rejects_a_blank_actor_bypassing_the_service(blank):
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsTomorrowBlockOverride.objects.create(
            business_date=DAY, overridden_by=blank, reason=REASON
        )


# ── Состояние ────────────────────────────────────────────────────────────


def test_a_second_override_for_the_same_date_is_a_conflict():
    override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)

    with pytest.raises(DomainError) as exc:
        override_tomorrow_block(business_date=DAY, actor="9", reason="ещё раз")

    assert exc.value.code == "TOMORROW_BLOCK_ALREADY_OVERRIDDEN"
    assert exc.value.http_status == 409
    assert exc.value.detail == {"business_date": DAY.isoformat()}
    assert OpsTomorrowBlockOverride.objects.count() == 1


def test_a_rejected_duplicate_leaves_the_caller_transaction_usable():
    """Отказ обязан откатить ТОЛЬКО свою вставку.

    Иначе он отравил бы транзакцию запроса, и маршрут не смог бы даже
    прочитать что-либо, чтобы объяснить отказ, — 500 вместо 409. Точку
    сохранения даёт @transaction.atomic самого сервиса; тест краснеет,
    если её снять.
    """
    override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)

    with transaction.atomic():
        with pytest.raises(DomainError):
            override_tomorrow_block(business_date=DAY, actor="9", reason="ещё")
        assert OpsTomorrowBlockOverride.objects.count() == 1


def test_another_date_can_be_overridden_independently():
    override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)
    override_tomorrow_block(
        business_date=DAY + timedelta(days=1), actor=ACTOR, reason=REASON
    )

    assert OpsTomorrowBlockOverride.objects.count() == 2


# ── Журнал ───────────────────────────────────────────────────────────────


def test_the_override_is_written_to_the_audit_log():
    override = override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)

    entry = OpsAuditLog.objects.get(action=audit_service.TOMORROW_BLOCK_OVERRIDDEN)
    assert entry.entity_type == audit_service.ENTITY_TOMORROW_BLOCK_OVERRIDE
    assert entry.entity_id == override.pk
    assert entry.actor_user_id == ACTOR
    assert entry.old_value is None
    assert entry.new_value == {
        "override_id": override.pk,
        "business_date": DAY.isoformat(),
        "overridden_by": ACTOR,
        "reason": REASON,
    }
    assert entry.reason == REASON


def test_a_rejected_override_writes_nothing_to_the_log():
    with pytest.raises(DomainError):
        override_tomorrow_block(business_date=DAY, actor=ACTOR, reason="  ")

    assert OpsAuditLog.objects.count() == 0


def test_a_rolled_back_override_takes_its_log_entry_with_it():
    """Журнал рассказывает о СЛУЧИВШЕМСЯ.

    Обход, откатившийся вместе с транзакцией вызывающего, оставил бы запись
    о решении, которого нет, — и следующий читатель искал бы несуществующую
    строку.
    """
    with transaction.atomic():
        override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)
        transaction.set_rollback(True)

    assert OpsTomorrowBlockOverride.objects.count() == 0
    assert OpsAuditLog.objects.count() == 0


# ── Врезка в вывод блокировки ────────────────────────────────────────────


def test_an_override_lifts_the_block_but_keeps_laggards_visible():
    division = a_laggard()
    before = tomorrow_block(DAY)

    override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)
    after = tomorrow_block(DAY)

    assert (before.blocked, before.overridden) == (True, False)
    assert after.blocked is False
    assert after.overridden is True
    # Отстающие ОСТАЮТСЯ: иначе обход выглядел бы как «все сдали», и никто
    # не узнал бы, чей долг сняли решением.
    assert after.laggards == [division.id]


def test_an_override_for_another_date_does_not_lift_the_block():
    a_laggard()
    override_tomorrow_block(
        business_date=DAY + timedelta(days=1), actor=ACTOR, reason=REASON
    )

    result = tomorrow_block(DAY)

    assert result.blocked is True
    assert result.overridden is False


def test_an_override_without_laggards_is_not_reported_as_one():
    """Обойти нечего — значит, никто ничего и не обходил.

    Объявить такую дату «обойдённой» значило бы записать на чей-то счёт
    решение, которое ни на что не повлияло.
    """
    set_required([])
    override_tomorrow_block(business_date=DAY, actor=ACTOR, reason=REASON)

    result = tomorrow_block(DAY)

    assert result.blocked is False
    assert result.overridden is False


def test_the_override_is_not_consulted_when_nobody_is_lagging():
    """Лишний запрос платился бы на КАЖДОМ чтении в норме.

    Блокировку спрашивают на каждом формировании расхода, и обычное
    состояние раздела — «все сдали».
    """
    division = Division.objects.create(name="Сдавшее")
    set_required([division.id])
    OpsTomorrowBlockOverride.objects.create(
        business_date=DAY, overridden_by=ACTOR, reason=REASON
    )
    # Подразделение сдало: строку кладём напрямую — здесь проверяется цена
    # чтения, а не сдача.
    from organization_management.apps.operations.tests.test_day_submission_service import (  # noqa: E501
        submitted,
    )

    submitted(division, DAY)

    with CaptureQueriesContext(connection) as queries:
        result = tomorrow_block(DAY)

    assert result.blocked is False
    assert not any("ops_tomorrow_block_overrides" in q["sql"] for q in queries)
