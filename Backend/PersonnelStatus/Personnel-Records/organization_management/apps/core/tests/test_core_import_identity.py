from organization_management.apps.core.api.serializers import EmployeeSerializer
from organization_management.apps.employees.api.serializers import (
    EmployeeSerializer as WriteSerializer,
)
from organization_management.apps.employees.models import Employee


def test_core_exposes_external_identity_and_unknown_personal_facts():
    e = Employee(external_id="7377", birth_date=None, hire_date=None, gender=None)
    data = EmployeeSerializer(e).data
    assert data["external_id"] == "7377"
    assert (
        data["birth_date"] is None
        and data["hire_date"] is None
        and data["gender"] is None
    )


def test_import_identity_cannot_be_overwritten_through_employee_crud():
    assert WriteSerializer().fields["external_id"].read_only
