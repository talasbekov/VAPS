import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    Organization,
)
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dt_type = DivisionType.objects.create(code="management", name="Управление")
    d1 = Division.objects.create(
        organization=org, type_code=dt_type, name="D1", code="D1"
    )
    d2 = Division.objects.create(
        organization=org, type_code=dt_type, name="D2", code="D2"
    )
    emp = Employee.objects.create(
        iin="900101300200",
        full_name="Тест",
        rank_code="MAJOR",
        position_code="OPER",
        division=d1,
    )
    return emp, d1, d2


def test_assign_closes_previous_open_interval(setup):
    emp, d1, d2 = setup
    t0 = timezone.now() - dt.timedelta(days=10)
    assign_employee_division(emp, d1, starts_at=t0, actor="test-actor")
    t1 = timezone.now()
    assign_employee_division(emp, d2, starts_at=t1, actor="test-actor")

    first = EmployeeDivisionHistory.objects.get(employee=emp, division=d1)
    second = EmployeeDivisionHistory.objects.get(employee=emp, division=d2)
    assert first.ends_at == t1
    assert second.ends_at is None
    emp.refresh_from_db()
    assert emp.division_id == d2.id


def test_starts_after_ends_rejected(setup):
    emp, d1, _ = setup
    now = timezone.now()
    with pytest.raises(ValidationError):
        EmployeeDivisionHistory(
            employee=emp, division=d1, starts_at=now, ends_at=now - dt.timedelta(days=1)
        ).full_clean()
