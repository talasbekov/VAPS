import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division


pytestmark = pytest.mark.django_db
URL = "/api/divisions/divisions/{}/"


@pytest.fixture
def api():
    user = get_user_model().objects.create_user(username="division-patch-user")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def division(code, parent=None):
    return Division.objects.create(name=code, code=code, parent=parent)


def test_patch_parent_rejects_self(api):
    node = division("SELF")

    response = api.patch(URL.format(node.pk), {"parent": node.pk}, format="json")

    assert response.status_code == 400
    node.refresh_from_db()
    assert node.parent_id is None


def test_patch_parent_rejects_own_descendant(api):
    root = division("ROOT")
    branch = division("BRANCH", root)
    leaf = division("LEAF", branch)

    response = api.patch(URL.format(branch.pk), {"parent": leaf.pk}, format="json")

    assert response.status_code == 400
    branch.refresh_from_db()
    assert branch.parent_id == root.pk


def test_patch_parent_rejects_depth_beyond_five(api):
    parent = division("LEVEL-0")
    for level in range(1, 6):
        parent = division(f"LEVEL-{level}", parent)
    moving = division("MOVING")

    response = api.patch(URL.format(moving.pk), {"parent": parent.pk}, format="json")

    assert response.status_code == 400
    moving.refresh_from_db()
    assert moving.parent_id is None


def test_patch_parent_accepts_valid_parent(api):
    root = division("VALID-ROOT")
    source = division("VALID-SOURCE", root)
    target = division("VALID-TARGET", root)

    response = api.patch(URL.format(source.pk), {"parent": target.pk}, format="json")

    assert response.status_code == 200
    source.refresh_from_db()
    assert source.parent_id == target.pk
