import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import Division, DivisionType, Employee, Organization
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
