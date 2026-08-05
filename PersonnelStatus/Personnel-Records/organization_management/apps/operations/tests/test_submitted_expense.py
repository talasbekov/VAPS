"""Расход по СДАННОМУ дню: числа из снимка и только из него.

Главное свойство — неизменность: сданный расход не должен шевелиться от
сегодняшних правок. Поэтому половина тестов сравнивает ответ ДО и ПОСЛЕ
мутации живых данных, а не только считает колонки.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.strength_report import (
    DERIVED_IN_SERVICE,
    StatusCatalog,
    StrengthReportService,
    expense_from_snapshot,
    submitted_expense,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def submit(division, business_date=TODAY, at=MORNING):
    with clock.override(at):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def catalog():
    from organization_management.apps.operations.selectors import StatusTypeSelector

    return StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())


def column_of(code):
    return StatusType.objects.get(code=code).report_column_code


class TestNumbers:
    def test_everyone_in_service_falls_into_one_column(self, types, division):
        for _ in range(3):
            in_slot(division)
        submit(division)
        expense = submitted_expense(division.id, TODAY)
        assert expense.list_total == 3
        assert expense.columns[column_of(DERIVED_IN_SERVICE)] == 3
        assert expense.off_list == 0

    def test_a_fact_moves_a_person_into_its_column(self, types, division):
        first, second = in_slot(division), in_slot(division)
        fact(first, code="DUTY")
        submit(division)
        expense = submitted_expense(division.id, TODAY)
        assert expense.columns[column_of("DUTY")] == 1
        assert expense.columns[column_of(DERIVED_IN_SERVICE)] == 1
        assert expense.list_total == 2
        assert second.id

    def test_the_winner_decides_the_column(self, types, division):
        # Тот же победитель, что у живого расхода: два счёта одного дня
        # обязаны сходиться, на этом стоит светофор.
        employee = in_slot(division)
        fact(employee, code="VACATION")  # старший приоритет
        fact(employee, code="STUDY")
        submit(division)
        expense = submitted_expense(division.id, TODAY)
        assert expense.columns[column_of("VACATION")] == 1
        assert expense.columns[column_of("STUDY")] == 0

    def test_an_out_of_list_winner_leaves_the_list(self, types, division):
        # DETACHED не считается в штате: человек наш, но сегодня не по списку.
        StatusType.objects.filter(code="DETACHED").update(
            counts_in_staff=False, priority=5
        )
        employee = in_slot(division)
        fact(employee, code="DETACHED")
        in_slot(division)
        submit(division)
        expense = submitted_expense(division.id, TODAY)
        assert expense.off_list == 1
        assert expense.list_total == 1
        assert employee.id

    def test_columns_sum_to_the_list(self, types, division):
        for code in ("DUTY", "STUDY", None):
            employee = in_slot(division)
            if code:
                fact(employee, code=code)
        submit(division)
        expense = submitted_expense(division.id, TODAY)
        assert sum(expense.columns.values()) == expense.list_total == 3

    def test_a_vacant_slot_is_not_in_the_list(self, types, division):
        in_slot(division)
        StaffUnit.objects.create(division=division, employee=None, index=999)
        submit(division)
        # Вакансий снимок не знает вовсе — в списке их нет и быть не должно.
        assert submitted_expense(division.id, TODAY).list_total == 1


class TestImmutability:
    def test_a_new_fact_does_not_move_the_submitted_numbers(self, types, division):
        employee = in_slot(division)
        submit(division)
        before = submitted_expense(division.id, TODAY)
        fact(employee, code="DUTY")
        after = submitted_expense(division.id, TODAY)
        assert after == before
        # А живой расход при этом уже другой — сравнение доказывает, что
        # числа берутся не из живых данных.
        live = StrengthReportService.compute(TODAY, division_ids=[division.id])
        assert live.rows[0].columns[column_of("DUTY")] == 1

    def test_a_newcomer_does_not_enter_the_submitted_list(self, types, division):
        in_slot(division)
        submit(division)
        in_slot(division)
        assert submitted_expense(division.id, TODAY).list_total == 1

    def test_a_dismissal_does_not_shrink_the_submitted_list(self, types, division):
        employee = in_slot(division)
        submit(division)
        employee.employment_status = employee.EmploymentStatus.FIRED
        employee.save(update_fields=["employment_status"])
        assert submitted_expense(division.id, TODAY).list_total == 1

    def test_no_live_tables_are_read(self, types, division):
        employee = in_slot(division)
        fact(employee, code="DUTY")
        submit(division)
        with CaptureQueriesContext(connection) as captured:
            submitted_expense(division.id, TODAY)
        touched = " ".join(query["sql"] for query in captured.captured_queries)
        assert "ops_daily_submissions" in touched
        # Ни слотов, ни статусов, ни сотрудников: снимок самодостаточен.
        for table in ("staff_units", "ops_employee_statuses", "employees"):
            assert table not in touched, touched


class TestVersions:
    def test_the_current_version_is_the_expense(self, types, division):
        employee = in_slot(division)
        submit(division)
        fact(employee, code="DUTY")
        with clock.override(MORNING):
            amend_day(
                division_id=division.id,
                business_date=TODAY,
                actor=ACTOR,
                reason="ошибка",
                sanction="замечание",
            )
        expense = submitted_expense(division.id, TODAY)
        assert expense.version == 2
        assert expense.columns[column_of("DUTY")] == 1

    def test_a_displaced_version_is_no_longer_the_expense(self, types, division):
        in_slot(division)
        submit(division)
        OpsDailySubmission.objects.update(is_current=False)
        assert submitted_expense(division.id, TODAY) is None

    def test_an_unsubmitted_day_has_no_expense(self, types, division):
        in_slot(division)
        assert submitted_expense(division.id, TODAY) is None

    def test_another_day_is_not_this_day(self, types, division):
        in_slot(division)
        submit(division, business_date=TODAY + timedelta(days=1))
        assert submitted_expense(division.id, TODAY) is None
        assert submitted_expense(division.id, TODAY + timedelta(days=1)) is not None

    def test_the_passport_of_the_submission_travels_with_the_numbers(
        self, types, division
    ):
        in_slot(division)
        submission = submit(division, at=MORNING.replace(hour=13, minute=30))
        expense = submitted_expense(division.id, TODAY)
        assert expense.version == submission.version
        assert expense.submitted_at == submission.submitted_at
        assert expense.late is True


class TestPureFunction:
    def test_it_reads_neither_clock_nor_database(self, types):
        # Чистая функция над снимком: считается и без Django-контекста дня.
        snapshot = {
            "schema_version": 1,
            "roster": [
                {"employee_id": 1, "full_name": "А", "rank": ""},
                {"employee_id": 2, "full_name": "Б", "rank": ""},
            ],
            "rows": [
                {
                    "employee_id": 1,
                    "status_type_code": "DUTY",
                    "status_id": 10,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=2)).isoformat(),
                    "source": "USER",
                }
            ],
        }
        numbers = expense_from_snapshot(snapshot, TODAY, catalog())
        assert numbers["list_total"] == 2
        assert numbers["columns"][column_of("DUTY")] == 1

    def test_a_fact_outside_the_day_does_not_count(self, types):
        snapshot = {
            "schema_version": 1,
            "roster": [{"employee_id": 1, "full_name": "А", "rank": ""}],
            "rows": [
                {
                    "employee_id": 1,
                    "status_type_code": "DUTY",
                    "status_id": 10,
                    "date_start": (TODAY + timedelta(days=5)).isoformat(),
                    "date_end": (TODAY + timedelta(days=6)).isoformat(),
                    "source": "USER",
                }
            ],
        }
        numbers = expense_from_snapshot(snapshot, TODAY, catalog())
        assert numbers["columns"][column_of(DERIVED_IN_SERVICE)] == 1
        assert numbers["columns"][column_of("DUTY")] == 0

    def test_an_unknown_code_fails_loud(self, types):
        snapshot = {
            "schema_version": 1,
            "roster": [{"employee_id": 1, "full_name": "А", "rank": ""}],
            "rows": [
                {
                    "employee_id": 1,
                    "status_type_code": "НЕТ_ТАКОГО",
                    "status_id": 10,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    "source": "USER",
                }
            ],
        }
        with pytest.raises(ValueError):
            expense_from_snapshot(snapshot, TODAY, catalog())


class TestAgreementWithTheLiveReport:
    def test_the_untouched_day_matches_the_live_report(self, types, division):
        # Сдали и ничего не трогали — сданные и живые числа обязаны совпасть,
        # иначе светофор красил бы жёлтым на ровном месте.
        for code in ("DUTY", "VACATION", None):
            employee = in_slot(division)
            if code:
                fact(employee, code=code)
        submit(division)
        submitted = submitted_expense(division.id, TODAY)
        live = StrengthReportService.compute(TODAY, division_ids=[division.id])
        row = live.rows[0]
        assert submitted.list_total == row.list_total
        assert submitted.off_list == row.off_list
        assert submitted.columns == row.columns
