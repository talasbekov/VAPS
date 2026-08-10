"""Билдер снимка сдачи: знаменатель, факты и самодостаточность.

Снимок — это то, под чем подписывается подразделение, поэтому проверяется не
только «что попало», но и «что НЕ попало»: чужой сотрудник, уволенный,
отменённый и не накрывающий дату факт. Отдельно закрепляются свойства, без
которых снимок перестал бы быть заявлением-на-момент: детерминированный
порядок, JSON-безопасность и независимость от часов.
"""
import json
from datetime import date, timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.snapshot import (
    SCHEMA_VERSION,
    build_division_snapshot,
)
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"


@pytest.fixture(autouse=True)
def catalog():
    """Справочник нужен КАЖДОМУ тесту файла, хотя ни один его не проверяет.

    Со схемы снимка 3 билдер отказывается собирать день, справочник которого
    непригоден: замороженный каталог не чинится задним числом, и день без
    колонки для выводимого «в строю» остался бы невыводимым навсегда. Мир без
    единого типа статуса — не «минимальная фикстура», а состояние, в котором
    прод не бывает: seed_status_types заводит их до всего остального.
    """
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def other_division():
    return Division.objects.create(name="Управление 2")


def in_slot(division, **overrides):
    employee = make_employee(**overrides)
    StaffUnit.objects.create(
        division=division, employee=employee, index=employee.id
    )
    return employee


def fact(employee, code="DUTY", start=None, end=None, **extra):
    fields = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": TODAY if start is None else start,
        "date_end": TODAY + timedelta(days=2) if end is None else end,
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": ACTOR,
    }
    fields.update(extra)
    return OpsEmployeeStatus.objects.create(**fields)


def ids(rows):
    return [row["employee_id"] for row in rows]


class TestRoster:
    def test_occupant_without_facts_stays_in_the_denominator(self, division):
        # Сотрудник без единого факта — «в строю»: он и есть та часть
        # знаменателя, ради которой roster хранится отдельно от rows.
        employee = in_slot(division)
        snapshot = build_division_snapshot(division.id, TODAY)
        assert ids(snapshot["roster"]) == [employee.id]
        assert snapshot["rows"] == []

    def test_denorm_carries_values_not_references(self, division):
        rank = Rank.objects.create(name="капитан", code="RANK-CPT", level=5)
        employee = in_slot(
            division,
            last_name="Иванов",
            first_name="Иван",
            middle_name="Иванович",
            rank=rank,
        )
        row = build_division_snapshot(division.id, TODAY)["roster"][0]
        # Сравнение ЦЕЛИКОМ, а не по знакомым ключам: снимок подписывают, и
        # поле, приехавшее в него незаметно, никто бы не обсудил. Уровень
        # должности здесь None — у сотрудника нет штатной должности в
        # справочнике, и снимок честно хранит «не нашлось», а не подменяет
        # числом (куда ставить такого — решает канон порядка).
        assert row == {
            "employee_id": employee.id,
            "full_name": "Иванов Иван Иванович",
            "rank": "капитан",
            "position_level": None,
        }

    def test_missing_rank_is_an_empty_string(self, division):
        in_slot(division)
        assert build_division_snapshot(division.id, TODAY)["roster"][0]["rank"] == ""

    def test_rename_after_the_build_does_not_touch_the_taken_snapshot(
        self, division
    ):
        # Заявление-на-момент: снимок хранит значения, поэтому позднее
        # переименование живёт только в НОВОМ снимке.
        employee = in_slot(division, last_name="Иванов", first_name="Иван")
        taken = build_division_snapshot(division.id, TODAY)
        Employee.objects.filter(pk=employee.id).update(last_name="Петров")
        assert taken["roster"][0]["full_name"] == "Иванов Иван"
        rebuilt = build_division_snapshot(division.id, TODAY)
        assert rebuilt["roster"][0]["full_name"] == "Петров Иван"

    def test_foreign_division_is_not_in_the_denominator(
        self, division, other_division
    ):
        mine = in_slot(division)
        in_slot(other_division)
        assert ids(build_division_snapshot(division.id, TODAY)["roster"]) == [mine.id]

    def test_dismissed_occupant_is_excluded(self, division):
        # То же правило, что и у расхода: слот, занятый уволенным, — пустой.
        # Иначе знаменатель сдачи и знаменатель расхода разошлись бы.
        alive = in_slot(division)
        in_slot(division, employment_status=Employee.EmploymentStatus.FIRED)
        assert ids(build_division_snapshot(division.id, TODAY)["roster"]) == [alive.id]

    def test_free_slot_adds_no_row(self, division):
        StaffUnit.objects.create(division=division, employee=None, index=1)
        assert build_division_snapshot(division.id, TODAY)["roster"] == []

    def test_employee_without_a_slot_is_not_in_the_denominator(self, division):
        # Знаменатель считается по слотам: человек без штатной единицы не
        # принадлежит подразделению вовсе (ограничение старой структуры).
        in_slot(division)
        orphan = make_employee()
        fact(orphan)
        snapshot = build_division_snapshot(division.id, TODAY)
        assert orphan.id not in ids(snapshot["roster"])
        assert orphan.id not in ids(snapshot["rows"])


class TestFacts:
    def test_covering_fact_is_taken_with_its_credentials(self, division):
        seed_types()
        employee = in_slot(division)
        row = fact(employee, start=TODAY, end=TODAY + timedelta(days=2))
        assert build_division_snapshot(division.id, TODAY)["rows"] == [
            {
                "employee_id": employee.id,
                "status_type_code": "DUTY",
                "status_id": row.pk,
                "date_start": str(TODAY),
                "date_end": str(TODAY + timedelta(days=2)),
                "source": "USER",
            }
        ]

    def test_cancelled_fact_does_not_exist_for_the_snapshot(self, division):
        employee = in_slot(division)
        fact(employee, cancelled_at=clock.Clock.now(), cancelled_by=ACTOR)
        assert build_division_snapshot(division.id, TODAY)["rows"] == []

    def test_finished_fact_is_not_taken(self, division):
        # Полуинтервал [начало, конец): день конца в статус НЕ входит.
        employee = in_slot(division)
        fact(employee, start=TODAY - timedelta(days=2), end=TODAY)
        assert build_division_snapshot(division.id, TODAY)["rows"] == []

    def test_fact_starting_on_the_date_is_taken(self, division):
        employee = in_slot(division)
        fact(employee, start=TODAY, end=TODAY + timedelta(days=1))
        assert len(build_division_snapshot(division.id, TODAY)["rows"]) == 1

    def test_future_fact_is_not_taken(self, division):
        employee = in_slot(division)
        fact(employee, start=TODAY + timedelta(days=1), end=TODAY + timedelta(days=3))
        assert build_division_snapshot(division.id, TODAY)["rows"] == []

    def test_rows_are_a_subset_of_the_roster(self, division, other_division):
        # Факт не может сослаться на человека вне знаменателя: чужой
        # сотрудник со статусом в снимок не приходит ни одной половиной.
        mine = in_slot(division)
        foreign = in_slot(other_division)
        fact(mine)
        fact(foreign)
        snapshot = build_division_snapshot(division.id, TODAY)
        assert set(ids(snapshot["rows"])) <= set(ids(snapshot["roster"]))
        assert foreign.id not in ids(snapshot["rows"])

    def test_several_facts_of_one_employee_are_all_taken(self, division):
        # Снимок хранит ФАКТЫ, а не победителя дня: свести их в одно
        # состояние — работа чтения, и делать это заранее значило бы
        # заморозить сегодняшнее правило вывода в сданном дне.
        employee = in_slot(division)
        fact(employee, code="DUTY")
        fact(employee, code="STUDY")
        assert len(build_division_snapshot(division.id, TODAY)["rows"]) == 2


class TestDeterminism:
    def test_roster_is_ordered_by_employee_id(self, division):
        # Естественный порядок выборки сотрудников — по фамилии (Meta
        # ordering старой модели), поэтому фамилии заданы ПРОТИВ порядка
        # id: без явной сортировки строки пришли бы наоборот.
        first = in_slot(division, last_name="Яковлев")
        second = in_slot(division, last_name="Петров")
        third = in_slot(division, last_name="Абаев")
        expected = sorted([first.id, second.id, third.id])
        assert ids(build_division_snapshot(division.id, TODAY)["roster"]) == expected

    def test_rows_are_ordered_by_employee_then_status(self, division):
        # Три строки и порядок вставки, НЕ совпадающий с ожидаемым: факты
        # второго сотрудника записаны первыми.
        first = in_slot(division)
        second = in_slot(division)
        late = fact(second, code="DUTY")
        early_a = fact(first, code="DUTY")
        early_b = fact(first, code="STUDY")
        assert first.id < second.id  # иначе ожидание ниже было бы не тем
        rows = build_division_snapshot(division.id, TODAY)["rows"]
        assert [row["status_id"] for row in rows] == [
            min(early_a.pk, early_b.pk),
            max(early_a.pk, early_b.pk),
            late.pk,
        ]
        assert ids(rows) == [first.id, first.id, second.id]

    def test_two_builds_of_the_same_day_are_equal(self, division):
        in_slot(division)
        employee = in_slot(division)
        fact(employee)
        assert build_division_snapshot(division.id, TODAY) == (
            build_division_snapshot(division.id, TODAY)
        )


class TestSelfContained:
    def test_snapshot_is_json_safe(self, division):
        employee = in_slot(division)
        fact(employee)
        snapshot = build_division_snapshot(division.id, TODAY)
        assert json.loads(json.dumps(snapshot)) == snapshot
        assert snapshot["schema_version"] == SCHEMA_VERSION

    def test_business_date_is_explicit_and_the_clock_is_not_read(self, division):
        # Часы раздела переведены на другой день: снимок обязан слушаться
        # ПАРАМЕТРА, иначе сборка сдачи за вчера тихо считала бы сегодня.
        employee = in_slot(division)
        yesterday = TODAY - timedelta(days=1)
        fact(employee, start=yesterday, end=TODAY)
        with clock.override(TODAY):
            assert build_division_snapshot(division.id, yesterday)["rows"]
            assert build_division_snapshot(division.id, TODAY)["rows"] == []

    def test_query_count_does_not_grow_with_the_division(self, division):
        for _ in range(3):
            employee = in_slot(division)
            fact(employee)
        with CaptureQueriesContext(connection) as small:
            build_division_snapshot(division.id, TODAY)
        for _ in range(20):
            employee = in_slot(division)
            fact(employee)
        with CaptureQueriesContext(connection) as large:
            build_division_snapshot(division.id, TODAY)
        # Сравниваются ДВА размера, а не абсолют: контракт — «число запросов
        # не зависит от числа людей», и он переживёт добавление ещё одной
        # выборки, а зашитое число потребовало бы правки теста.
        assert len(large) == len(small)


class TestDivisionId:
    """Приведение id — работа поля модели; здесь закреплено ПОВЕДЕНИЕ, а не
    его владелец: молчаливо пустой снимок недопустим при любом из них."""

    def test_string_id_works(self, division):
        employee = in_slot(division)
        assert ids(build_division_snapshot(str(division.id), TODAY)["roster"]) == [
            employee.id
        ]

    def test_garbage_id_fails_loudly(self, division):
        # Молчаливо пустой снимок — худший исход: подразделение выглядело бы
        # сдавшим день с пустым списком.
        in_slot(division)
        with pytest.raises(ValueError):
            build_division_snapshot("не-число", TODAY)

    def test_unknown_division_is_empty_but_well_formed(self, division):
        in_slot(division)
        snapshot = build_division_snapshot(division.id + 10_000, TODAY)
        assert snapshot["schema_version"] == SCHEMA_VERSION
        assert (snapshot["roster"], snapshot["rows"]) == ([], [])
        # Ключ справочника есть и у пустого подразделения: раскладка колонок —
        # свойство ДНЯ, а не состава, и без неё день нельзя было бы вывести.
        assert set(snapshot) == {
            "schema_version",
            "roster",
            "rows",
            "catalog",
            "division_title",
            "staff_total",
            "vacancies",
            "attached",
        }
        assert snapshot["catalog"]
