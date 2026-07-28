"""Story 10.1b2 — GET /api/operations/statuses/types/ (справочник статус-типов,
combobox грида 10.2). Read-only, глобальный (не подразделение-скоуповый)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import StatusType

pytestmark = pytest.mark.django_db

URL = reverse("ops-status-type-list")


def _grant(user_id, role_code):
    UserRole.objects.create(user_id=user_id, role_code_id=role_code)


def _client(actor):
    c = APIClient()
    c.raise_request_exception = False
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def env():
    call_command("seed_operations")
    StatusType.objects.create(
        code="VACATION", name="Отпуск", is_hard_block=True,
        priority=20, report_column_code="VACATION", color="#ffcc00",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING", color="#00ccff",
    )
    StatusType.objects.create(
        code="RETIRED_TYPE", name="Устарело", is_hard_block=False,
        priority=99, report_column_code="OTHER_ABSENCE", is_active=False,
    )


def test_happy_path_returns_active_types_sorted(env):
    _grant("viewer", "VIEWER")

    resp = _client("viewer").get(URL)

    assert resp.status_code == 200, resp.content
    codes = [row["code"] for row in resp.data]
    assert codes == ["VACATION", "STUDY"]  # priority order 20 < 32
    assert resp.data[0]["name"] == "Отпуск"
    assert resp.data[0]["color"] == "#ffcc00"
    assert resp.data[0]["is_hard_block"] is True


def test_deactivated_type_excluded(env):
    _grant("viewer", "VIEWER")

    resp = _client("viewer").get(URL)

    codes = [row["code"] for row in resp.data]
    assert "RETIRED_TYPE" not in codes


def test_anonymous_403(env):
    resp = _client(None).get(URL)
    assert resp.status_code == 403


def test_without_view_permission_403(env):
    _grant("noview", "INTEGRATION_USER")  # holds status.manage, not .view

    resp = _client("noview").get(URL)

    assert resp.status_code == 403


def test_scoped_holder_still_sees_full_catalog(env):
    """Справочник не подразделение-скоуповый — тот же грубый гейт, что и
    держатель без scope на конкретное подразделение видит весь список."""
    import uuid

    UserRole.objects.create(
        user_id="scoped", role_code_id="DIVISION_OPERATOR",
        scope_division_id=uuid.uuid4(),  # phantom scope, irrelevant here
    )

    resp = _client("scoped").get(URL)

    assert resp.status_code == 200
    assert len(resp.data) == 2
