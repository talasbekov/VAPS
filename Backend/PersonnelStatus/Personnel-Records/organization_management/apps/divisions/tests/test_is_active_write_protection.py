import pytest
from organization_management.apps.operations.tests.support import client_for
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division


pytestmark = pytest.mark.django_db
URL = "/api/divisions/divisions/{}/"


@pytest.fixture
def api():
    client, _ = client_for("division-validator", "DIVISION_VALIDATOR", ["orgstructure.manage"])
    return client


def payload(division, is_active):
    return {
        "name": division.name,
        "code": division.code,
        "division_type": division.division_type,
        "parent": division.parent_id,
        "is_active": is_active,
        "order": division.order,
    }


@pytest.mark.parametrize("method", ["patch", "put"])
def test_standard_update_cannot_archive_division(api, method):
    division = Division.objects.create(name="ACTIVE", code="ACTIVE")

    response = getattr(api, method)(
        URL.format(division.pk), payload(division, False), format="json"
    )

    assert response.status_code == 200
    division.refresh_from_db()
    assert division.is_active is True
    assert division.archived_at is None


@pytest.mark.parametrize("method", ["patch", "put"])
def test_standard_update_cannot_restore_division(api, method):
    archived_at = timezone.now()
    division = Division.objects.create(
        name="ARCHIVED", code="ARCHIVED", is_active=False, archived_at=archived_at
    )

    response = getattr(api, method)(
        URL.format(division.pk), payload(division, True), format="json"
    )

    assert response.status_code == 200
    division.refresh_from_db()
    assert division.is_active is False
    assert division.archived_at == archived_at
