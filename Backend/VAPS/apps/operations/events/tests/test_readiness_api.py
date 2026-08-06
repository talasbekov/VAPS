"""Story 20.1b — API behavioral tests: `readiness` action on
SecurityEventViewSet. Thin HTTP wrapper over
SecurityEventReadinessSelector.readiness_for() (20.1a). Structural mirror
of test_closure_archive_api.py's `archive` tests, minus the lifecycle
gate (readiness is queryable at any event stage)."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def event_manager_client(seeded):
    role = Role.objects.create(code="TEST_EVENT_MANAGER_20_1B", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-20-1b", role_code=role)
    return _client("event-operator-20-1b")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role-20-1b")


def make_event(code, status_code=SecurityEvent.StatusCode.DRAFT):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def readiness_url(event):
    return reverse("ops-security-event-readiness", args=[event.pk])


def test_readiness_returns_all_six_fields(event_manager_client):
    event = make_event("OBJ-RDNS-1")

    resp = event_manager_client.get(readiness_url(event))

    assert resp.status_code == 200
    assert set(resp.data.keys()) == {
        "checklist_ready",
        "demand_ready",
        "placement_ready",
        "acknowledgement_ready",
        "conflicts_ready",
        "readiness_pct",
    }
    # DRAFT + пустой чек-лист + нет версии: checklist/ack/conflicts
    # вырожденно True, demand/placement False -> 3/5 = 60%.
    assert resp.data["demand_ready"] is False
    assert resp.data["placement_ready"] is False
    assert resp.data["checklist_ready"] is True
    # Review (Blind Hunter): изначально проверялось только 4 из 6 полей —
    # `acknowledgement_ready`/`conflicts_ready` проверялись только на
    # ПРИСУТСТВИЕ ключа, не на значение (не поймал бы транспозицию/typo
    # в имени поля сериализатора).
    assert resp.data["acknowledgement_ready"] is True
    assert resp.data["conflicts_ready"] is True
    assert resp.data["readiness_pct"] == 60


@pytest.mark.parametrize(
    "status_code",
    [
        SecurityEvent.StatusCode.CANCELLED,
        SecurityEvent.StatusCode.CLOSED,
        SecurityEvent.StatusCode.IN_PROGRESS,
    ],
)
def test_readiness_available_at_any_lifecycle_stage(event_manager_client, status_code):
    # Review (Blind Hunter): изначально проверялась только ОДНА стадия
    # (CANCELLED) — частичный/неполный гейт (напр. блокирующий только
    # DRAFT+IN_PROGRESS, но пропускающий CANCELLED) не был бы пойман.
    event = make_event(f"OBJ-RDNS-2-{status_code}", status_code=status_code)

    resp = event_manager_client.get(readiness_url(event))

    assert resp.status_code == 200


def test_readiness_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-RDNS-3")

    resp = no_permission_client.get(readiness_url(event))

    assert resp.status_code == 403
    # Review (Blind Hunter): изначально проверялся только статус-код, не
    # тело ошибки — регрессия на generic 403 без канонического кода не
    # была бы поймана.
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_readiness_nonexistent_event_is_404(event_manager_client):
    resp = event_manager_client.get(
        reverse("ops-security-event-readiness", args=[999999])
    )

    assert resp.status_code == 404


def test_readiness_non_numeric_pk_is_404(event_manager_client):
    resp = event_manager_client.get("/api/operations/security-events/abc/readiness/")

    assert resp.status_code == 404
