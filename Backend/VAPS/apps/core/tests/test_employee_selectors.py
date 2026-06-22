import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import Division, DivisionType, Employee, Organization, Position
from apps.core.selectors import CoreEmployeeSelector, HistoricalEmployeeSelector
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    d1 = Division.objects.create(organization=org, type_code=dtp, name="D1", code="D1")
    d2 = Division.objects.create(organization=org, type_code=dtp, name="D2", code="D2")
    emp = Employee.objects.create(
        iin="900101300400",
        full_name="Тест",
        rank_code="MAJOR",
        position_code="OPER",
        division=d1,
    )
    return emp, d1, d2


@pytest.fixture
def fresh_division():
    org = Organization.objects.create(name="HQ2", code="HQ2")
    dtp = DivisionType.objects.create(code="dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="CanonDiv", code="CD"
    )


def _emp(division, *, iin, last_name, position_code, attached=False):
    # save() derives full_name from last_name + first_name; create() skips
    # full_clean so the iin validator is not exercised here (selector test).
    return Employee.objects.create(
        iin=iin,
        full_name="ignored",
        last_name=last_name,
        first_name="И",
        rank_code="OFFICER",
        position_code=position_code,
        division=division,
        is_attached_force=attached,
    )


def test_active_employees_in_division_excludes_inactive(setup):
    emp, d1, _ = setup
    Employee.objects.create(
        iin="900101300401",
        full_name="Inactive",
        rank_code="MAJOR",
        position_code="OPER",
        division=d1,
        is_active=False,
    )
    active = CoreEmployeeSelector.active_in_division(d1.id)
    assert [e.id for e in active] == [emp.id]


def test_active_in_division_applies_sort_canon(fresh_division):
    # AC-2/AC-5: own personnel by Position.level (asc) then surname; the
    # attached-force member goes to the bottom block (AC-1) regardless of level.
    div = fresh_division
    Position.objects.create(code="HEAD", name="Начальник", level=1)
    Position.objects.create(code="OPER", name="Оператор", level=5)
    oper = _emp(div, iin="900101300420", last_name="Яковлев", position_code="OPER")
    head_b = _emp(div, iin="900101300421", last_name="Бойко", position_code="HEAD")
    head_a = _emp(div, iin="900101300422", last_name="Абрамов", position_code="HEAD")
    attached = _emp(
        div, iin="900101300423", last_name="Сидоров", position_code="HEAD",
        attached=True,
    )
    result = [e.id for e in CoreEmployeeSelector.active_in_division(div.id)]
    assert result == [head_a.id, head_b.id, oper.id, attached.id]


def test_active_in_division_unmatched_position_code_does_not_crash(fresh_division):
    # AC-3: a position_code with no Position row gets UNKNOWN_LEVEL and sorts
    # after the known-level person, by surname — the list still comes out.
    div = fresh_division
    Position.objects.create(code="HEAD", name="Начальник", level=1)
    known = _emp(div, iin="900101300430", last_name="Яковлев", position_code="HEAD")
    unknown = _emp(div, iin="900101300431", last_name="Абрамов", position_code="NOPE")
    result = [e.id for e in CoreEmployeeSelector.active_in_division(div.id)]
    assert result == [known.id, unknown.id]


def test_historical_division_at_uses_history(setup):
    emp, d1, d2 = setup
    t0 = timezone.now() - dt.timedelta(days=10)
    t1 = timezone.now() - dt.timedelta(days=2)
    assign_employee_division(emp, d1, starts_at=t0, actor="test-actor")
    assign_employee_division(emp, d2, starts_at=t1, actor="test-actor")
    at = timezone.now() - dt.timedelta(days=5)
    assert HistoricalEmployeeSelector.division_at(emp.id, at) == d1.id


def test_historical_division_falls_back_to_current_when_no_history(setup, caplog):
    emp, d1, _ = setup
    result = HistoricalEmployeeSelector.division_at(emp.id, timezone.now())
    assert result == d1.id
    assert any("history" in r.message.lower() for r in caplog.records)
