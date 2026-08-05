"""Шов принуждения к поправке в путях правки статуса.

Проверяется не то, что поправка умеет строиться (это соседний файл), а то,
что мимо неё нельзя пройти: каждая правка, задевшая сданный день, обязана его
вытеснить, и ни одна не обязана объясняться, если ничего не задела.
"""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.status_service import (
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
    update_status,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import (
    seed_types as _seed_status_types,
)

pytestmark = pytest.mark.django_db

TOMORROW = TODAY + timedelta(days=1)
WHY = "Приказ №12 от 04.08: наряд перенесён."


@pytest.fixture
def seed_types():
    _seed_status_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def employee(division):
    return in_slot(division)


def submit(division, business_date):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            window_dates=[
                TODAY - timedelta(days=2),
                TODAY - timedelta(days=1),
                TODAY,
                TOMORROW,
            ],
        )


def amendments(division, business_date):
    return list(
        OpsDailySubmission.objects.filter(
            division_id=division.id,
            business_date=business_date,
            event=OpsDailySubmission.Event.AMENDED,
        )
    )


def make_status(employee, start, end, code="DUTY"):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
        source=OpsEmployeeStatus.Source.USER,
        created_by=ACTOR,
    )


# ── Создание ─────────────────────────────────────────────────────────────


def test_creating_a_status_over_a_submitted_day_demands_a_reason(
    seed_types, division, employee
):
    submit(division, TODAY)

    with clock.override(MORNING), pytest.raises(DomainError) as exc:
        create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY,
            date_end=TOMORROW,
            actor=ACTOR,
        )

    assert exc.value.code == "AMENDMENT_REASON_REQUIRED"
    assert exc.value.http_status == 422
    assert exc.value.detail["business_dates"] == [TODAY.isoformat()]


def test_the_refused_edit_leaves_neither_a_status_nor_an_amendment(
    seed_types, division, employee
):
    """Отказ и запись — одна транзакция.

    Иначе строка легла бы без поправки, то есть ровно тем расхождением,
    которое шов и запрещает.
    """
    submit(division, TODAY)

    with clock.override(MORNING), pytest.raises(DomainError):
        create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY,
            date_end=TOMORROW,
            actor=ACTOR,
        )

    assert OpsEmployeeStatus.objects.count() == 0
    assert amendments(division, TODAY) == []


def test_a_reasoned_creation_amends_the_day_and_points_back(
    seed_types, division, employee
):
    submit(division, TODAY)

    with clock.override(MORNING):
        status = create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY,
            date_end=TOMORROW,
            actor=ACTOR,
            amendment_reason=WHY,
        )

    (amendment,) = amendments(division, TODAY)
    assert amendment.sanction == WHY
    assert amendment.triggered_by_status_id == status.pk
    assert amendment.is_current is True


def test_a_creation_that_touches_nothing_submitted_needs_no_reason(
    seed_types, division, employee
):
    """Обязательная причина на КАЖДОЙ правке научила бы писать «правка»."""
    submit(division, TODAY)

    with clock.override(MORNING):
        create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TOMORROW,
            date_end=TOMORROW + timedelta(days=1),
            actor=ACTOR,
        )

    assert amendments(division, TODAY) == []


# ── Правка ───────────────────────────────────────────────────────────────


def test_moving_the_dates_amends_both_the_old_and_the_new_day(
    seed_types, division, employee
):
    """Правка снимает статус с одних дней и ставит на другие.

    Заявление неверно у тех и у других, и поправить надо оба дня.
    """
    submit(division, TODAY)
    submit(division, TOMORROW)
    status = make_status(employee, TODAY, TOMORROW)

    with clock.override(MORNING):
        update_status(
            status,
            actor=ACTOR,
            date_start=TOMORROW,
            date_end=TOMORROW + timedelta(days=1),
            amendment_reason=WHY,
        )

    assert len(amendments(division, TODAY)) == 1
    assert len(amendments(division, TOMORROW)) == 1


def test_editing_only_the_comment_amends_nothing(seed_types, division, employee):
    """Комментарий и основание расхода не меняют.

    Вытеснять сданное заявление из-за них было бы поправкой ни о чём — и
    причины такая правка не требует тоже.
    """
    submit(division, TODAY)
    status = make_status(employee, TODAY, TOMORROW)

    with clock.override(MORNING):
        update_status(status, actor=ACTOR, comment="уточнил формулировку")

    assert amendments(division, TODAY) == []


def test_moving_the_dates_over_a_submitted_day_demands_a_reason(
    seed_types, division, employee
):
    submit(division, TODAY)
    status = make_status(employee, TODAY, TOMORROW)

    with clock.override(MORNING), pytest.raises(DomainError) as exc:
        update_status(status, actor=ACTOR, date_end=TOMORROW + timedelta(days=1))

    assert exc.value.code == "AMENDMENT_REASON_REQUIRED"
    status.refresh_from_db()
    assert status.date_end == TOMORROW


# ── Досрочное закрытие ───────────────────────────────────────────────────


def test_early_completion_amends_only_the_released_days(
    seed_types, division, employee
):
    """Дни ДО фактического конца статус как нёс, так и несёт.

    Поправлять их значило бы вытеснять заявление, которое не изменилось.
    """
    past = TODAY - timedelta(days=2)
    submit(division, past)
    submit(division, TODAY)
    status = make_status(employee, past, TOMORROW + timedelta(days=1))

    with clock.override(MORNING):
        complete_status_early(
            status, actor=ACTOR, actual_end=TODAY, amendment_reason=WHY
        )

    assert amendments(division, past) == []
    assert len(amendments(division, TODAY)) == 1


# ── Продление ────────────────────────────────────────────────────────────


def test_extension_amends_only_the_added_days(seed_types, division, employee):
    """Прежние дни статус нёс и раньше — продлением их заявление не тронуто."""
    submit(division, TODAY)
    submit(division, TOMORROW)
    status = make_status(employee, TODAY, TOMORROW)

    with clock.override(MORNING):
        extend_status(
            status,
            actor=ACTOR,
            new_date_end=TOMORROW + timedelta(days=1),
            amendment_reason=WHY,
        )

    assert amendments(division, TODAY) == []
    assert len(amendments(division, TOMORROW)) == 1


# ── Отмена ───────────────────────────────────────────────────────────────


def test_cancelling_a_status_amends_with_its_own_reason(
    seed_types, division, employee
):
    """Отдельного поля причины у отмены нет.

    Второе «почему» на одном вызове означало бы, что у отмены бывают две
    разные правды. «Не начавшийся» при этом не значит «не сданный»: день на
    завтра сдают штатно.
    """
    submit(division, TOMORROW)
    status = make_status(employee, TOMORROW, TOMORROW + timedelta(days=1))

    with clock.override(MORNING):
        cancel_status(status, actor=ACTOR, reason=WHY)

    (amendment,) = amendments(division, TOMORROW)
    assert amendment.sanction == WHY
    assert amendment.triggered_by_status_id == status.pk


# ── Массовая пачка ───────────────────────────────────────────────────────


def bulk(rows, *divisions, amendment_reason=""):
    from organization_management.apps.operations.bulk_status_service import (
        bulk_create_statuses,
    )

    with clock.override(MORNING):
        return bulk_create_statuses(
            rows,
            actor=ACTOR,
            business_date=TODAY,
            allowed_division_ids={division.id for division in divisions},
            amendment_reason=amendment_reason,
        )


def bulk_row(employee, start=TODAY, end=TOMORROW):
    return {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": start,
        "date_end": end,
    }


def test_a_batch_amends_the_day_once_no_matter_how_many_people_it_touched(
    seed_types, division, employee
):
    """Версии 2, 3, 4… на один акт сделали бы историю дня нечитаемой.

    Читатель увидел бы столько поправок, сколько человек попало в пачку, — и
    ни одна из них не была бы отдельным решением.
    """
    others = [in_slot(division) for _ in range(3)]
    submit(division, TODAY)

    bulk(
        [bulk_row(person) for person in [employee, *others]],
        division,
        amendment_reason=WHY,
    )

    (amendment,) = amendments(division, TODAY)
    assert amendment.version == 2
    assert amendment.sanction == WHY
    # Одной строки, вызвавшей поправку, у пачки нет — pk первой был бы враньём.
    assert amendment.triggered_by_status_id is None


def test_a_batch_over_a_submitted_day_demands_a_reason(seed_types, division, employee):
    submit(division, TODAY)

    with pytest.raises(DomainError) as exc:
        bulk([bulk_row(employee)], division)

    assert exc.value.code == "AMENDMENT_REASON_REQUIRED"
    assert OpsEmployeeStatus.objects.count() == 0


def test_a_batch_that_touches_nothing_submitted_needs_no_reason(
    seed_types, division, employee
):
    submit(division, TODAY)

    bulk(
        [bulk_row(employee, start=TOMORROW, end=TOMORROW + timedelta(days=1))],
        division,
    )

    assert amendments(division, TODAY) == []


def test_the_batch_uses_its_rows_own_periods_not_their_span(
    seed_types, division, employee
):
    """Общий габарит накрыл бы дни, которых не касалась ни одна строка.

    Промежуточный день здесь СДАН и содержит тех же людей — единственное,
    что его защищает, это периоды самих строк.
    """
    other = in_slot(division)
    past = TODAY - timedelta(days=2)
    gap = TODAY - timedelta(days=1)
    for business_date in (past, gap, TODAY):
        submit(division, business_date)

    bulk(
        [
            bulk_row(employee, start=past, end=past + timedelta(days=1)),
            bulk_row(other, start=TODAY, end=TOMORROW),
        ],
        division,
        amendment_reason=WHY,
    )

    assert len(amendments(division, past)) == 1
    assert len(amendments(division, TODAY)) == 1
    assert amendments(division, gap) == []


def test_a_batch_spanning_two_divisions_amends_both_their_days(
    seed_types, division, employee
):
    """Периметр обнаружения — ВСЕ сотрудники пачки, а не первый из них.

    Пачка охватывает два подразделения, и сдача второго обнаруживается
    только через его собственного человека.
    """
    elsewhere = Division.objects.create(name="Управление 2")
    stranger = in_slot(elsewhere)
    submit(division, TODAY)
    submit(elsewhere, TODAY)

    bulk(
        [bulk_row(employee), bulk_row(stranger)],
        division,
        elsewhere,
        amendment_reason=WHY,
    )

    assert len(amendments(division, TODAY)) == 1
    assert len(amendments(elsewhere, TODAY)) == 1


def test_a_batch_leaves_alone_a_day_that_reported_other_people(
    seed_types, division, employee
):
    """Сдача, в знаменателе которой никого из пачки нет, ею не тронута."""
    elsewhere = Division.objects.create(name="Управление 2")
    in_slot(elsewhere)
    submit(division, TODAY)
    submit(elsewhere, TODAY)

    bulk([bulk_row(employee)], division, amendment_reason=WHY)

    assert len(amendments(division, TODAY)) == 1
    assert amendments(elsewhere, TODAY) == []


# ── Увольнение: причина выводится из события ─────────────────────────────


def dismiss(employee, dismissal_date=TODAY):
    from organization_management.apps.operations.dismissal import (
        close_statuses_on_dismissal,
    )

    with clock.override(MORNING):
        return close_statuses_on_dismissal(
            employee.id, dismissal_date=dismissal_date, actor="system:dismissal"
        )


def test_dismissal_amends_without_asking_anyone_for_a_reason(
    seed_types, division, employee
):
    """Спрашивать причину у системного пути было бы некого.

    Событие известно целиком — увольнение с датой, — и санкция выводится из
    него; пропустить поправку значило бы оставить сданный день заявлять
    человека, которого в нём уже нет.
    """
    submit(division, TOMORROW)
    make_status(employee, TOMORROW, TOMORROW + timedelta(days=2))

    dismiss(employee)

    (amendment,) = amendments(division, TOMORROW)
    assert amendment.sanction == f"Увольнение сотрудника {TODAY:%d.%m.%Y}."
    assert amendment.triggered_by_status_id is None


def test_dismissal_amends_only_the_severed_tail(seed_types, division, employee):
    """Дни до даты увольнения статус нёс и несёт."""
    past = TODAY - timedelta(days=2)
    submit(division, past)
    submit(division, TOMORROW)
    make_status(employee, past, TOMORROW + timedelta(days=2))

    dismiss(employee)

    assert amendments(division, past) == []
    assert len(amendments(division, TOMORROW)) == 1


def test_a_dismissal_that_severs_nothing_submitted_amends_nothing(
    seed_types, division, employee
):
    submit(division, TODAY)
    make_status(employee, TOMORROW, TOMORROW + timedelta(days=2))

    dismiss(employee)

    assert amendments(division, TODAY) == []
