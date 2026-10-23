"""Сборка расхода: каждый человек штата — ровно в одной колонке.

Прежняя реализация роняла сборку на несуществующем Employee.division и
складывала семь типов статуса из тринадцати, объявляя остаток «в строю».
Тесты закрывают оба класса дефектов: полноту разбиения (гвард на будущее)
и поведение на данных.
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.reports.infrastructure.data_aggregator import (
    ABSENCE_COLUMNS,
    REPORT_COLUMN_BY_STATUS,
    STATUS_PRIORITY,
    DataAggregator,
)
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType


class FakeReport:
    """Отчёту от сборщика нужны только область и даты."""

    def __init__(self, division=None, date_to=None):
        self.division = division
        self.division_id = division.id if division else None
        self.date_from = None
        self.date_to = date_to


def test_every_status_type_has_a_report_column():
    # Гвард, которого не было: тип статуса, добавленный без решения о колонке,
    # молча уезжал в «в строю» остатком — так пропадали соревнования,
    # дежурство и отпуск по рапорту.
    assert set(REPORT_COLUMN_BY_STATUS) == {
        value for value, _label in _ST.choices
    }


def test_every_status_type_has_a_priority():
    assert set(STATUS_PRIORITY) == {value for value, _label in _ST.choices}


def test_report_columns_are_declared_targets():
    declared = {column for column, _label in ABSENCE_COLUMNS}
    assert set(REPORT_COLUMN_BY_STATUS.values()) <= declared


def test_seconded_to_outranks_seconded_from():
    # Одобрённое прикомандирование заводит обе строки на один период; у
    # отдающей стороны победить обязана «Откомандирован в».
    assert STATUS_PRIORITY[_ST.SECONDED_TO] < STATUS_PRIORITY[_ST.SECONDED_FROM]


@pytest.fixture
def author(db):
    """EmployeeStatus.save() требует автора — статус без него не сохранить."""
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="agg-author")


@pytest.fixture
def org(db):
    """Отдел с шестью занятыми слотами и одной вакансией."""
    division = Division.objects.create(
        name="Отдел охраны", code="agg-div", division_type=Division.DivisionType.DIVISION
    )
    other = Division.objects.create(
        name="Соседний отдел",
        code="agg-other",
        division_type=Division.DivisionType.DIVISION,
    )
    employees = []
    for index in range(1, 7):
        employee = Employee.objects.create(
            personnel_number=f"agg-{index}",
            last_name=f"Сотрудник{index}",
            first_name="Имя",
        )
        StaffUnit.objects.create(division=division, index=index, employee=employee)
        employees.append(employee)
    StaffUnit.objects.create(division=division, index=99)  # вакансия
    return {"division": division, "other": other, "employees": employees}


def _row(org, ref_date=None):
    ref_date = ref_date or timezone.localdate()
    data = DataAggregator().collect_data(
        FakeReport(division=org["division"], date_to=ref_date)
    )
    return next(r for r in data["rows"] if r["division_id"] == org["division"].id)


def _status(employee, status_type, ref_date, author, **kwargs):
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=status_type,
        start_date=ref_date - timedelta(days=1),
        end_date=ref_date + timedelta(days=1),
        created_by=author,
        **kwargs,
    )


@pytest.mark.django_db
def test_employee_without_status_counts_as_in_service(org):
    row = _row(org)
    assert row["in_service"] == 6
    assert row["headcount"] == 6
    assert row["staff_unit"] == 7  # шесть занятых слотов + вакансия


@pytest.mark.django_db
def test_statuses_land_in_their_own_columns(org, author):
    today = timezone.localdate()
    people = org["employees"]
    _status(people[0], _ST.ON_DUTY, today, author)
    _status(people[1], _ST.AFTER_DUTY, today, author)
    _status(people[2], _ST.COMPETITION, today, author)
    _status(people[3], _ST.CONFERENCE, today, author)
    _status(people[4], _ST.LEAVE_BY_REPORT, today, author)

    row = _row(org)
    # До правки все пятеро оказывались «в строю»: их типов не было в сумме
    # известных, и они добирались остатком.
    assert row["on_duty"] == 1
    assert row["after_duty"] == 1
    assert row["training"] == 2  # соревнования + конференция
    assert row["vacation"] == 1  # отпуск по рапорту — та же колонка
    assert row["in_service"] == 1


@pytest.mark.django_db
def test_columns_always_sum_to_headcount(org, author):
    today = timezone.localdate()
    people = org["employees"]
    _status(people[0], _ST.SICK_LEAVE, today, author)
    _status(people[1], _ST.ON_DUTY, today, author)
    _status(people[2], _ST.BUSINESS_TRIP, today, author)

    row = _row(org)
    assert sum(row[column] for column, _label in ABSENCE_COLUMNS) == row["headcount"]
    assert row["headcount"] == 6


@pytest.mark.django_db
def test_cancelled_status_does_not_count(org, author):
    today = timezone.localdate()
    _status(
        org["employees"][0],
        _ST.VACATION,
        today,
        author,
        state=EmployeeStatus.StatusState.CANCELLED,
    )
    row = _row(org)
    assert row["vacation"] == 0
    assert row["in_service"] == 6


@pytest.mark.django_db
def test_early_termination_ends_the_status(org, author):
    today = timezone.localdate()
    _status(
        org["employees"][0],
        _ST.VACATION,
        today,
        author,
        actual_end_date=today - timedelta(days=1),
    )
    # end_date у досрочно завершённого статуса остаётся прежним — считать надо
    # по фактическому концу.
    row = _row(org)
    assert row["vacation"] == 0
    assert row["in_service"] == 6


@pytest.mark.django_db
def test_seconded_out_employee_leaves_the_in_service_column(org, author):
    today = timezone.localdate()
    _status(
        org["employees"][0],
        _ST.SECONDED_TO,
        today,
        author,
        related_division=org["other"],
    )
    row = _row(org)
    assert row["seconded_out"] == 1
    assert row["in_service"] == 5


@pytest.mark.django_db
def test_overlapping_secondment_pair_counts_the_person_once(org, author):
    # Одобрение прикомандирования пытается завести ДВЕ строки на один период
    # (secondments/api/views.py::approve), хотя модель пересечения запрещает —
    # через save() вторая не проходит. Пара может прийти импортом или из
    # старых данных, и тогда наивная сумма посчитала бы человека дважды.
    today = timezone.localdate()
    employee = org["employees"][0]
    EmployeeStatus.objects.bulk_create(
        [
            EmployeeStatus(
                employee=employee,
                status_type=_ST.SECONDED_TO,
                start_date=today - timedelta(days=1),
                end_date=today + timedelta(days=1),
                related_division=org["other"],
                created_by=author,
                state=EmployeeStatus.StatusState.ACTIVE,
            ),
            EmployeeStatus(
                employee=employee,
                status_type=_ST.SECONDED_FROM,
                start_date=today - timedelta(days=1),
                end_date=today + timedelta(days=1),
                related_division=org["division"],
                created_by=author,
                state=EmployeeStatus.StatusState.ACTIVE,
            ),
        ]
    )

    row = _row(org)
    assert row["seconded_out"] == 1
    assert row["headcount"] == 6  # человек посчитан один раз, а не дважды
    assert row["in_service"] == 5


@pytest.mark.django_db
def test_incoming_secondment_from_outside_the_scope_is_counted(org, author):
    today = timezone.localdate()
    outsider = Employee.objects.create(
        personnel_number="agg-out", last_name="Пришлый", first_name="Имя"
    )
    StaffUnit.objects.create(division=org["other"], index=1, employee=outsider)
    _status(outsider, _ST.SECONDED_TO, today, author, related_division=org["division"])

    row = _row(org)
    # Прежняя версия сужала статусы до сотрудников области отчёта, поэтому
    # прикомандированный извне не попадал в колонку никогда.
    assert row["seconded_in"] == 1
    assert row["headcount"] == 6  # в штат принимающей стороны он не входит
    assert row["present_total"] == 7  # шестеро своих в строю + прикомандированный


@pytest.mark.django_db
def test_after_duty_is_not_counted_as_present(org, author):
    today = timezone.localdate()
    _status(org["employees"][0], _ST.AFTER_DUTY, today, author)
    _status(org["employees"][1], _ST.ON_DUTY, today, author)

    row = _row(org)
    # На дежурстве — в распоряжении, после дежурства — нет.
    assert row["present_total"] == 5


@pytest.mark.django_db
def test_dismissed_employee_drops_out_of_the_roster(org):
    org["employees"][0].employment_status = Employee.EmploymentStatus.FIRED
    org["employees"][0].save(update_fields=["employment_status"])
    row = _row(org)
    assert row["headcount"] == 5


@pytest.mark.django_db
def test_document_prints_every_aggregated_column(org, author):
    # Раньше каждый генератор перечислял колонки своим списком, и колонка,
    # добавленная в сборке данных, до документа не доезжала. Заголовок и
    # ячейка теперь строятся из одного описания — тест это и стережёт.
    from organization_management.apps.reports.infrastructure import report_table

    _status(org["employees"][0], _ST.ON_DUTY, timezone.localdate(), author)
    data = DataAggregator().collect_data(
        FakeReport(division=org["division"], date_to=timezone.localdate())
    )
    headers = report_table.headers(data)
    row = next(r for r in data["rows"] if r["division_id"] == org["division"].id)
    cells = report_table.cells(data, row)

    assert len(headers) == len(cells)
    for _column, label in ABSENCE_COLUMNS:
        assert label in headers
    assert "На дежурстве" in headers
    assert cells[headers.index("На дежурстве")] == 1


@pytest.mark.django_db
@pytest.mark.parametrize("code", ["DUTY_DAILY", "DUTY_COMBAT", "DUTY_OPERATIONAL"])
def test_migration_seeded_duty_variants_reach_report_columns_and_document(org, author, code):
    from organization_management.apps.operations.status_types import StatusType
    from organization_management.apps.reports.infrastructure import report_table

    duty = StatusType.objects.get(code=code)
    assert duty.report_column_code == "ON_DUTY"
    _status(org["employees"][0], code, timezone.localdate(), author)
    data = DataAggregator().collect_data(FakeReport(org["division"], timezone.localdate()))
    row = next(row for row in data["rows"] if row["division_id"] == org["division"].pk)
    assert row["on_duty"] == 1
    assert row["in_service"] == 5
    assert row["headcount"] == 6
    assert report_table.cells(data, row)[report_table.headers(data).index("На дежурстве")] == 1


@pytest.mark.django_db
def test_catalog_column_and_priority_apply_to_canonical_and_legacy_codes(org, author):
    from organization_management.apps.operations.status_types import StatusType

    StatusType.objects.update_or_create(code="COMMAND", defaults={
        "name": "Changed command", "legacy_code": "business_trip", "priority": 1,
        "report_column_code": "TRAINING",
    })
    person = org["employees"][0]
    today = timezone.localdate()
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(employee=person, status_type=code, start_date=today - timedelta(days=1),
                       end_date=today + timedelta(days=1), state=EmployeeStatus.StatusState.ACTIVE)
        for code in ("business_trip", "sick_leave")
    ])
    _status(org["employees"][1], "COMMAND", today, author)
    row = _row(org)
    assert row["training"] == 2
    assert row["sick_leave"] == row["business_trip"] == 0
    assert row["in_service"] == 4


@pytest.mark.django_db
def test_custom_status_new_column_is_counted_and_printed_even_when_type_is_inactive(org, author):
    from organization_management.apps.operations.status_types import StatusType
    from organization_management.apps.reports.infrastructure import report_table

    StatusType.objects.create(code="SPECIAL_WATCH", name="Special watch", priority=25,
                              report_column_code="SPACE_WATCH", is_active=False)
    _status(org["employees"][0], "SPECIAL_WATCH", timezone.localdate(), author)
    data = DataAggregator().collect_data(FakeReport(org["division"], timezone.localdate()))
    row = next(row for row in data["rows"] if row["division_id"] == org["division"].pk)
    headers = report_table.headers(data)
    assert "SPACE_WATCH" in headers
    assert report_table.cells(data, row)[headers.index("SPACE_WATCH")] == 1
    assert sum(row[key] for key, _label in data["columns"]) == row["headcount"] == 6
    assert row["in_service"] == 5


@pytest.mark.django_db
def test_unknown_imported_type_counts_as_other_absence_instead_of_crashing(org, author):
    _status(org["employees"][0], "OLD_MISSING_TYPE", timezone.localdate(), author)
    row = _row(org)
    assert row["other_absence"] == 1
    assert row["in_service"] == 5


@pytest.mark.django_db
def test_same_day_return_wins_but_generic_planned_end_remains_inclusive(org, author):
    today = timezone.localdate()
    _status(org["employees"][0], _ST.SICK_LEAVE, today, author,
            state=EmployeeStatus.StatusState.COMPLETED, actual_end_date=today)
    EmployeeStatus.objects.create(employee=org["employees"][0], status_type=_ST.IN_SERVICE,
                                  start_date=today, created_by=author)
    _status(org["employees"][1], _ST.SICK_LEAVE, today - timedelta(days=1), author)
    row = _row(org)
    assert row["sick_leave"] == 1  # the second person's ordinary end is today
    assert row["in_service"] == 5


@pytest.mark.django_db
def test_historical_return_still_wins_after_a_later_status_completes_the_return(org, author):
    from organization_management.apps.statuses.application.services import StatusApplicationService

    today = timezone.localdate()
    returned = today - timedelta(days=1)
    service = StatusApplicationService()
    absence = service.create_status(employee_id=org["employees"][0].pk,
        status_type=_ST.SICK_LEAVE, start_date=today - timedelta(days=4),
        end_date=today + timedelta(days=5), user=author)
    service.terminate_status_early(absence.pk, returned, "Returned yesterday", author)
    service.create_status(employee_id=org["employees"][0].pk,
        status_type=_ST.VACATION, start_date=today, end_date=today + timedelta(days=2), user=author)

    row = _row(org, returned)
    assert row["in_service"] == row["headcount"] == 6
    assert row["sick_leave"] == row["vacation"] == 0


@pytest.mark.django_db
@pytest.mark.parametrize("planned_days,has_actual_end,expected_in_service", [
    (0, True, 6), (5, True, 6), (None, True, 6), (0, False, 5),
])
def test_historical_return_boundary_uses_actual_end_and_keeps_generic_end_inclusive(
    org, planned_days, has_actual_end, expected_in_service
):
    returned = timezone.localdate() - timedelta(days=3)
    employee = org["employees"][0]
    EmployeeStatus.objects.bulk_create([
        EmployeeStatus(employee=employee, status_type=_ST.SICK_LEAVE,
            start_date=returned - timedelta(days=4),
            end_date=returned + timedelta(days=planned_days) if planned_days is not None else None,
            actual_end_date=returned if has_actual_end else None,
            state=EmployeeStatus.StatusState.COMPLETED),
        EmployeeStatus(employee=employee, status_type=_ST.IN_SERVICE,
            start_date=returned, actual_end_date=returned + timedelta(days=1),
            state=EmployeeStatus.StatusState.COMPLETED),
    ])
    row = _row(org, returned)
    assert row["in_service"] == expected_in_service
    assert row["sick_leave"] == 6 - expected_in_service
