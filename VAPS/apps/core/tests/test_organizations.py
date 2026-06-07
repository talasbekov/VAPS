import pytest

from apps.core.models import Organization

pytestmark = pytest.mark.django_db


def test_create_organization_with_self_parent():
    parent = Organization.objects.create(name="Главк", code="HQ")
    child = Organization.objects.create(name="Филиал", code="BR1", parent=parent)
    assert child.parent_id == parent.id
    assert child.is_active is True


def test_organization_code_unique():
    Organization.objects.create(name="A", code="DUP")
    with pytest.raises(Exception):
        Organization.objects.create(name="B", code="DUP")
