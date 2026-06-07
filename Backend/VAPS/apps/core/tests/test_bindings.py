import pytest

from apps.core.models import (
    Division, DivisionType, Employee, Organization, UserEmployeeBinding,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def employee():
    org = Organization.objects.create(name="HQ", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dt, name="D", code="D")
    return Employee.objects.create(
        iin="900101300300", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )


def test_binding_uses_string_user_id(employee):
    b = UserEmployeeBinding.objects.create(user_id="auth-user-42", employee=employee)
    assert isinstance(b.user_id, str)


def test_user_id_unique(employee):
    UserEmployeeBinding.objects.create(user_id="u1", employee=employee)
    with pytest.raises(Exception):
        UserEmployeeBinding.objects.create(user_id="u1", employee=employee)
