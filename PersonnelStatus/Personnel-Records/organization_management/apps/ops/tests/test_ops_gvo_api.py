"""API ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Контракт повторяет мок фронта 1:1:
- GET /api/ops/protected-persons/ → {"results": [...]} (id — строкой:
  ID-конвенция «бэк int, наружу строка», чтобы типы entities не менялись);
- GET /api/ops/gvo-summaries/ → {"results": [{omCode, patch, updatedAt}]};
- PATCH /api/ops/gvo-summaries/{omCode}/ — merge по ключам верхнего уровня;
- POST /api/ops/gvo-summaries/{omCode}/reset/ — сброс к базе из бюллетеня.

Права — существующие плоские коды: чтение event.view, правка event.manage.
Гейт fail-closed: нужна и персона С правом, и персона БЕЗ него — иначе
закрытое состояние недостижимо и тест вакуумен.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import (
    OpsGvoSummaryPatch,
    OpsProtectedPerson,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

PERSONS_URL = "/api/ops/protected-persons/"
GVO_URL = "/api/ops/gvo-summaries/"

pytestmark = pytest.mark.django_db


def viewer(name="ops-gvo-viewer"):
    api, _ = client_for(name, "VIEWER", ["event.view"])
    return api


def manager(name="ops-gvo-manager"):
    api, user = client_for(name, "MANAGER", ["event.view", "event.manage"])
    return api, user


def nobody(name="ops-gvo-nobody"):
    api, _ = client_for(name)
    return api


def make_event(code="ОМ-Т-9"):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Визит",
        object_name="Объект",
        business_date="2026-08-21",
        stage=OpsSecurityEvent.Stage.BULLETIN,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Тест",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


# ── Каталог лиц ──────────────────────────────────────────────────────────


def test_persons_list_active_only_ordered_ids_are_strings():
    OpsProtectedPerson.objects.bulk_create(
        [
            OpsProtectedPerson(name="Бекетов", category="OURS"),
            OpsProtectedPerson(name="Алиев", category="FOREIGN"),
            OpsProtectedPerson(name="Скрытый", category="OURS", is_active=False),
        ]
    )
    r = viewer().get(PERSONS_URL)
    assert r.status_code == 200
    rows = r.json()["results"]
    assert [p["name"] for p in rows] == ["Алиев", "Бекетов"]
    assert all(isinstance(p["id"], str) for p in rows)
    assert set(rows[0]) == {"id", "name", "callsign", "category", "bio"}


def test_persons_denied_without_permission():
    assert nobody().get(PERSONS_URL).status_code == 403


def test_persons_denied_anonymous():
    assert APIClient().get(PERSONS_URL).status_code == 403
