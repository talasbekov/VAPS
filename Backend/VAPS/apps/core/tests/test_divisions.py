import pytest
from django.db import IntegrityError

from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def org():
    return Organization.objects.create(name="Главк", code="HQ")


@pytest.fixture
def dtype():
    return DivisionType.objects.create(code="management", name="Управление")


def test_create_division_tree(org, dtype):
    root = Division.objects.create(
        organization=org, type_code=dtype, name="УВД", code="UVD"
    )
    child = Division.objects.create(
        organization=org, type_code=dtype, name="Отдел 1", code="OT1", parent=root
    )
    assert child.parent_id == root.id


def test_code_unique_per_organization(org, dtype):
    Division.objects.create(organization=org, type_code=dtype, name="A", code="SAME")
    with pytest.raises(IntegrityError):
        Division.objects.create(
            organization=org, type_code=dtype, name="B", code="SAME"
        )
