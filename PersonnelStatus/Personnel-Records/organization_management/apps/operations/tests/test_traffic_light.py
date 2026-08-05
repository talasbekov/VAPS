"""Светофор подразделения: цвет и поимённое расхождение.

Главное здесь — ГРАНИЦА жёлтого: расхождением считается только то, что
сдвинуло победителя дня, потому что расход строится из снимка. Поэтому
проверяется не только «что стало жёлтым», но и «что осталось зелёным»:
пересоздание идентичного факта, правка, перекрытая старшим статусом, и
переименование человека.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.strength_report import (
    DERIVED_IN_SERVICE,
)
from organization_management.apps.operations.traffic_light import (
    TrafficLightStatus,
    division_traffic_light,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import seed_types
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def types():
    """Справочник статусов + выводимое «в строю».

    seed_types() ставит всем один приоритет (тай-брейк по коду) и не содержит
    IN_SERVICE — светофору этого мало: он выводит ПОБЕДИТЕЛЯ, и без разницы
    приоритетов «перекрытый старшим статусом» ничем не отличался бы от
    смены победителя.
    """
    seed_types()
    # Своя колонка каждому типу: seed_types складывает их все в одну ("X"), и
    # на таком справочнике «победитель занял свою колонку» не отличить от
    # «победитель занял чужую».
    for code, priority in [("VACATION", 20), ("DUTY", 70), ("STUDY", 80)]:
        StatusType.objects.filter(code=code).update(
            priority=priority, report_column_code=code
        )
    StatusType.objects.get_or_create(
        code=DERIVED_IN_SERVICE,
        defaults={
            "name": "В строю",
            "priority": 999,
            "report_column_code": DERIVED_IN_SERVICE,
            "is_hard_block": False,
        },
    )


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def light(division, business_date=TODAY):
    return division_traffic_light(division.id, business_date)


class TestRed:
    def test_no_submission_is_red(self, types, division):
        in_slot(division)
        result = light(division)
        assert result.status == TrafficLightStatus.RED.value
        assert result.drift is None
        assert result.late is False

    def test_a_division_with_nobody_is_neutral_not_red(self, types, division):
        # Красный зовёт дежурного разбираться; звать его к подразделению без
        # людей значило бы требовать сдать пустоту. Одно правило со сводом.
        result = light(division)
        assert result.status == TrafficLightStatus.NEUTRAL.value
        assert result.drift is None

    def test_submission_of_another_day_does_not_colour_this_one(
        self, types, division
    ):
        in_slot(division)
        submit(division, TODAY + timedelta(days=1))
        assert light(division).status == TrafficLightStatus.RED.value
        assert (
            light(division, TODAY + timedelta(days=1)).status
            == TrafficLightStatus.GREEN.value
        )

    def test_displaced_version_alone_is_red(self, types, division):
        # «Ноль текущих» — вырожденное состояние: читателю честнее «сдачи
        # нет», чем версия, которую сам раздел действующей не считает.
        in_slot(division)
        submit(division)
        OpsDailySubmission.objects.update(is_current=False)
        assert light(division).status == TrafficLightStatus.RED.value


class TestGreen:
    def test_untouched_day_is_green(self, types, division):
        employee = in_slot(division)
        fact(employee, code="DUTY")
        submit(division)
        result = light(division)
        assert result.status == TrafficLightStatus.GREEN.value
        assert result.drift is None

    def test_empty_division_with_a_submission_is_green(self, types, division):
        submit(division)
        assert light(division).status == TrafficLightStatus.GREEN.value

    def test_recreating_an_identical_fact_stays_green(self, types, division):
        employee = in_slot(division)
        row = fact(employee, code="DUTY")
        submit(division)
        row.delete()
        fact(employee, code="DUTY")
        # Тот же победитель — расход не сдвинулся, звать дежурного не за чем.
        assert light(division).status == TrafficLightStatus.GREEN.value

    def test_a_fact_hidden_behind_a_stronger_one_stays_green(self, types, division):
        employee = in_slot(division)
        fact(employee, code="VACATION")  # старший приоритет в фикстуре
        submit(division)
        fact(employee, code="STUDY")
        result = light(division)
        assert result.status == TrafficLightStatus.GREEN.value, result.drift

    def test_renaming_a_person_stays_green(self, types, division):
        employee = in_slot(division)
        submit(division)
        employee.last_name = "Петров"
        employee.save(update_fields=["last_name"])
        assert light(division).status == TrafficLightStatus.GREEN.value

    def test_a_vacant_slot_is_not_a_person(self, types, division):
        # Пустой слот не человек: попади он в знаменатель, светофор объявил
        # бы расхождением саму вакансию — и с обеих сторон разом.
        in_slot(division)
        StaffUnit.objects.create(division=division, employee=None, index=999)
        submit(division)
        result = light(division)
        assert result.status == TrafficLightStatus.GREEN.value, result.drift

    def test_a_fact_outside_the_day_stays_green(self, types, division):
        employee = in_slot(division)
        submit(division)
        fact(
            employee,
            code="DUTY",
            start=TODAY + timedelta(days=5),
            end=TODAY + timedelta(days=6),
        )
        assert light(division).status == TrafficLightStatus.GREEN.value


class TestYellow:
    def test_a_new_winner_is_a_change(self, types, division):
        employee = in_slot(division)
        submit(division)
        fact(employee, code="DUTY")
        result = light(division)
        assert result.status == TrafficLightStatus.YELLOW.value
        assert result.drift == {
            "added": [],
            "removed": [],
            "changed": [
                {"employee_id": employee.id, "from": "IN_SERVICE", "to": "DUTY"}
            ],
        }

    def test_a_cancelled_fact_is_a_change(self, types, division):
        employee = in_slot(division)
        row = fact(employee, code="DUTY")
        submit(division)
        row.cancelled_at = clock.Clock.now()
        row.cancelled_by = ACTOR
        row.cancelled_reason = "приказ отменён"
        row.save(update_fields=["cancelled_at", "cancelled_by", "cancelled_reason"])
        result = light(division)
        assert result.status == TrafficLightStatus.YELLOW.value
        assert result.drift["changed"] == [
            {"employee_id": employee.id, "from": "DUTY", "to": "IN_SERVICE"}
        ]

    def test_a_newcomer_is_added(self, types, division):
        submit(division)
        newcomer = in_slot(division)
        result = light(division)
        assert result.status == TrafficLightStatus.YELLOW.value
        assert result.drift["added"] == [newcomer.id]
        assert result.drift["removed"] == []

    def test_a_dismissed_occupant_is_removed(self, types, division):
        employee = in_slot(division)
        submit(division)
        employee.employment_status = employee.EmploymentStatus.FIRED
        employee.save(update_fields=["employment_status"])
        result = light(division)
        assert result.status == TrafficLightStatus.YELLOW.value
        assert result.drift["removed"] == [employee.id]

    def test_drift_is_listed_in_a_deterministic_order(self, types, division):
        first, second, third = (in_slot(division) for _ in range(3))
        submit(division)
        for employee in (third, first, second):
            fact(employee, code="DUTY")
        changed = light(division).drift["changed"]
        assert [item["employee_id"] for item in changed] == sorted(
            [first.id, second.id, third.id]
        )


class TestScope:
    def test_another_division_does_not_leak_into_the_drift(self, types, division):
        stranger_division = Division.objects.create(name="Управление 2")
        in_slot(division)
        submit(division)
        stranger = in_slot(stranger_division)
        fact(stranger, code="DUTY")
        assert light(division).status == TrafficLightStatus.GREEN.value


class TestLateAndCost:
    def test_late_comes_from_the_submission_not_from_the_colour(
        self, types, division
    ):
        employee = in_slot(division)
        # Сдача после контрольного часа: опоздавшая, но ничем не разошедшаяся.
        with clock.override(
            MORNING.replace(hour=13, minute=30)
        ):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        result = light(division)
        assert result.late is True
        assert result.status == TrafficLightStatus.GREEN.value
        assert employee.id  # фикстура использована

    def test_query_count_does_not_grow_with_the_division(self, types, division):
        for _ in range(2):
            fact(in_slot(division), code="DUTY")
        submit(division)
        with CaptureQueriesContext(connection) as small:
            light(division)
        for _ in range(8):
            fact(in_slot(division), code="DUTY")
        with CaptureQueriesContext(connection) as big:
            light(division)
        # Абсолютное число не пиним — сравниваются ДВА размера: победитель по
        # человеку отдельным запросом дал бы рост.
        assert len(big.captured_queries) == len(small.captured_queries)


class TestUnknownType:
    def test_a_snapshot_code_outside_the_catalog_fails_loud(
        self, types, division
    ):
        employee = in_slot(division)
        submit(division)
        submission = OpsDailySubmission.objects.get()
        submission.snapshot = {
            "schema_version": 1,
            "roster": [{"employee_id": employee.id, "full_name": "И", "rank": ""}],
            "rows": [
                {
                    "employee_id": employee.id,
                    "status_type_code": "НЕТ_ТАКОГО",
                    "status_id": 1,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    "source": OpsEmployeeStatus.Source.USER,
                }
            ],
        }
        submission.save(update_fields=["snapshot"])
        # Молчаливый «неизвестный цвет» здесь был бы хуже падения: светофор
        # для того и существует, чтобы расхождение было видно.
        with pytest.raises(ValueError):
            light(division)
