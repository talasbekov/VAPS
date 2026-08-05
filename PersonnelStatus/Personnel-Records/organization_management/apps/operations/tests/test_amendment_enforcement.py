"""Принуждение к поправке: ретро-правка накрытого сданного дня порождает
поправку.

Половина тестов здесь — про то, что поправка НЕ ставится: обнаружение,
хватающее лишнее, объявляло бы поправленными дни, о которых никто ничего не
менял, и санкция за чужую правку висела бы на их сдаче.
"""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.amendment_enforcement import (
    AUTO_AMENDMENT_REASON,
    affected_days,
    enforce_amendment_on_retro_edit,
)
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import DailySubmissionSelector
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import (
    seed_types as _seed_status_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

YESTERDAY = TODAY - timedelta(days=1)
EDIT_REASON = "Наряд отменён приказом, справка от 04.08."


@pytest.fixture
def seed_types():
    _seed_status_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            window_dates=[YESTERDAY - timedelta(days=1), YESTERDAY, TODAY],
        )


def enforce(employee, intervals, **overrides):
    kwargs = {"actor": ACTOR, "reason": EDIT_REASON}
    kwargs.update(overrides)
    return enforce_amendment_on_retro_edit(employee.id, intervals, **kwargs)


def versions(division, business_date=TODAY):
    return list(
        OpsDailySubmission.objects.filter(
            division_id=division.id, business_date=business_date
        ).order_by("version")
    )


# ── Затронутые дни ───────────────────────────────────────────────────────


def test_the_end_of_the_interval_is_excluded():
    """Полуинтервал [начало, конец) значит в разделе одно и то же везде."""
    assert affected_days([(TODAY, TODAY + timedelta(days=2))]) == {
        TODAY,
        TODAY + timedelta(days=1),
    }


def test_disjoint_intervals_do_not_cover_the_gap_between_them():
    """Габарит (мин. начало … макс. конец) поправил бы промежуток.

    День, о котором никто ничего не менял, вышел бы поправленным с чужой
    санкцией.
    """
    gap_day = TODAY + timedelta(days=3)

    days = affected_days(
        [
            (TODAY, TODAY + timedelta(days=1)),
            (TODAY + timedelta(days=5), TODAY + timedelta(days=6)),
        ]
    )

    assert days == {TODAY, TODAY + timedelta(days=5)}
    assert gap_day not in days


def test_an_empty_or_inverted_interval_covers_nothing():
    assert affected_days([(TODAY, TODAY)]) == set()
    assert affected_days([(TODAY + timedelta(days=3), TODAY)]) == set()


# ── Что поправляется ─────────────────────────────────────────────────────


def test_a_covered_submitted_day_gets_an_amendment(seed_types, division):
    employee = in_slot(division)
    submit(division)

    (amendment,) = enforce(employee, [(TODAY, TODAY + timedelta(days=1))])

    first, second = versions(division)
    assert amendment.pk == second.pk
    assert (second.version, second.event) == (2, OpsDailySubmission.Event.AMENDED)
    assert (second.is_current, first.is_current) == (True, False)


def test_the_edit_reason_becomes_the_sanction(seed_types, division):
    """Служебный текст поправки в объяснение дня не подставляется.

    Он одинаков у всех поправок раздела, и записать его санкцией значило бы
    оставить день без объяснения, ЧТО именно изменили.
    """
    employee = in_slot(division)
    submit(division)

    (amendment,) = enforce(employee, [(TODAY, TODAY + timedelta(days=1))])

    assert amendment.sanction == EDIT_REASON
    assert amendment.reason == AUTO_AMENDMENT_REASON


def test_the_amendment_points_at_the_edited_status(seed_types, division):
    employee = in_slot(division)
    submit(division)

    (amendment,) = enforce(
        employee, [(TODAY, TODAY + timedelta(days=1))], triggered_by_status_id=777
    )

    assert amendment.triggered_by_status_id == 777


def test_every_covered_day_gets_its_own_amendment(seed_types, division):
    """Правка на два дня — две поправки: у каждого дня своё заявление."""
    employee = in_slot(division)
    submit(division, YESTERDAY)
    submit(division, TODAY)

    amendments = enforce(employee, [(YESTERDAY, TODAY + timedelta(days=1))])

    assert [amendment.business_date for amendment in amendments] == [YESTERDAY, TODAY]
    assert len(versions(division, YESTERDAY)) == len(versions(division, TODAY)) == 2


def test_days_reported_by_different_divisions_are_each_amended_in_place(
    seed_types, division
):
    """Между двумя днями человека перевели — дни заявлены РАЗНЫМИ управлениями.

    Поиск, сужённый одним подразделением, поправил бы только половину, и
    расход второго остался бы неверным. Ровно поэтому обнаружение не
    спрашивает, где человек числится, а спрашивает, кто о нём заявлял.
    """
    employee = in_slot(division)
    submit(division, YESTERDAY)
    other = Division.objects.create(name="Управление 2")
    StaffUnit.objects.filter(employee=employee).update(division=other)
    submit(other, TODAY)

    amendments = enforce(employee, [(YESTERDAY, TODAY + timedelta(days=1))])

    assert [
        (amendment.business_date, amendment.division_id) for amendment in amendments
    ] == [(YESTERDAY, division.id), (TODAY, other.id)]


def test_the_amendments_come_out_in_calendar_order(seed_types, division):
    """Порядок задаёт СЕЛЕКТОР, а не порядок сдачи.

    Дни сдаются как придётся (задним числом, вразбивку), а поправки за одну
    правку ложатся версиями и попадают в журнал — без своего порядка две
    одинаковые правки дали бы разные ленты.
    """
    employee = in_slot(division)
    day_before = YESTERDAY - timedelta(days=1)
    for business_date in (TODAY, day_before, YESTERDAY):
        submit(division, business_date)

    amendments = enforce(employee, [(day_before, TODAY + timedelta(days=1))])

    assert [amendment.business_date for amendment in amendments] == [
        day_before,
        YESTERDAY,
        TODAY,
    ]


# ── Что НЕ поправляется ──────────────────────────────────────────────────


def test_an_unsubmitted_day_is_not_amended(seed_types, division):
    employee = in_slot(division)

    assert enforce(employee, [(TODAY, TODAY + timedelta(days=1))]) == []
    assert OpsDailySubmission.objects.count() == 0


def test_a_day_outside_the_edited_interval_is_not_amended(seed_types, division):
    employee = in_slot(division)
    submit(division, YESTERDAY)
    submit(division, TODAY)

    enforce(employee, [(TODAY, TODAY + timedelta(days=1))])

    assert len(versions(division, YESTERDAY)) == 1
    assert len(versions(division, TODAY)) == 2


def test_a_day_that_did_not_report_this_person_is_not_amended(seed_types, division):
    """Сдача чужого подразделения — чужое заявление.

    Оно от этой правки не изменилось, и вытеснять его нечем.
    """
    employee = in_slot(division)
    other = Division.objects.create(name="Управление 2")
    in_slot(other)
    submit(division)
    submit(other)

    (amendment,) = enforce(employee, [(TODAY, TODAY + timedelta(days=1))])

    assert amendment.division_id == division.id
    assert len(versions(other)) == 1


def test_a_superseded_day_is_not_amended_again(seed_types, division):
    """У дня без ДЕЙСТВУЮЩЕЙ версии нет и действующего расхода.

    Приводить в соответствие нечего.
    """
    employee = in_slot(division)
    submit(division)
    OpsDailySubmission.objects.filter(division_id=division.id).update(is_current=False)

    assert enforce(employee, [(TODAY, TODAY + timedelta(days=1))]) == []
    assert len(versions(division)) == 1


# ── Обнаружение по снимку, а не по живой принадлежности ──────────────────


def test_detection_follows_the_snapshot_after_a_transfer(seed_types, division):
    """Перевод по штату между сдачей и правкой уводит ЖИВУЮ принадлежность.

    Ищи мы по ней — поправка ушла бы в новое подразделение (которое за этот
    день не отчитывалось), а накрытый день остался бы без неё.
    """
    employee = in_slot(division)
    submit(division)
    elsewhere = Division.objects.create(name="Управление 3")
    StaffUnit.objects.filter(employee=employee).update(division=elsewhere)

    (amendment,) = enforce(employee, [(TODAY, TODAY + timedelta(days=1))])

    assert amendment.division_id == division.id


def test_a_person_absent_from_the_snapshot_roster_covers_nothing(
    seed_types, division
):
    """Сдача, собранная до появления человека в штате, о нём не заявляла."""
    submit(division)
    latecomer = in_slot(division)

    assert enforce(latecomer, [(TODAY, TODAY + timedelta(days=1))]) == []


def test_the_lookup_costs_one_query_regardless_of_the_number_of_days(
    seed_types, division, django_assert_num_queries
):
    """Снимок весит десятки килобайт: разбор в питоне платил бы за правку
    одного статуса чтением всего сданного."""
    employee = in_slot(division)
    submit(division)
    days = {TODAY + timedelta(days=offset) for offset in range(30)}

    with django_assert_num_queries(1):
        DailySubmissionSelector.covering(employee.id, days)


def test_no_affected_days_means_no_query(
    seed_types, division, django_assert_num_queries
):
    employee = in_slot(division)

    with django_assert_num_queries(0):
        assert DailySubmissionSelector.covering(employee.id, set()) == []
