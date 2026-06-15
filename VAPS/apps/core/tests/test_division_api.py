import pytest
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def tree():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(
        organization=org, type_code=dtp, name="root", code="R"
    )
    a = Division.objects.create(
        organization=org, type_code=dtp, name="a", code="A", parent=root
    )
    a1 = Division.objects.create(
        organization=org, type_code=dtp, name="a1", code="A1", parent=a
    )
    return root, a, a1


def test_list_divisions(client, tree):
    resp = client.get("/api/core/divisions/")
    assert resp.status_code == 200
    assert resp.json()["count"] == 3


def test_leaf_descendants_endpoint(client, tree):
    root, a, a1 = tree
    resp = client.get(f"/api/core/divisions/{root.id}/leaf-descendants/")
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert ids == {str(a1.id)}
