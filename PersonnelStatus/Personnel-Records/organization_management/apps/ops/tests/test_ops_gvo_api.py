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


# ── Сводки ГВО: list / patch / reset ─────────────────────────────────────


def test_gvo_list_returns_patches_with_om_code():
    ev = make_event("ОМ-Т-10")
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "Черногория"})
    r = viewer("gvo-list-viewer").get(GVO_URL)
    assert r.status_code == 200
    rows = r.json()["results"]
    assert [row["omCode"] for row in rows] == ["ОМ-Т-10"]
    assert rows[0]["patch"] == {"country": "Черногория"}
    assert "updatedAt" in rows[0]


def test_gvo_patch_merges_top_level_keys():
    ev = make_event("ОМ-Т-11")
    OpsGvoSummaryPatch.objects.create(
        event=ev, patch={"country": "X", "weapons": "нет"}
    )
    api, _ = manager("gvo-patcher")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-11/",
        {"section": "head", "values": {"country": "Y"}},
        format="json",
    )
    assert r.status_code == 200
    # Присланный ключ заменён, отсутствующий — не тронут.
    assert r.json()["patch"] == {"country": "Y", "weapons": "нет"}
    ev.refresh_from_db()
    assert ev.gvo_patch.patch == {"country": "Y", "weapons": "нет"}  # из БД


def test_gvo_patch_unknown_key_is_400():
    make_event("ОМ-Т-12")
    api, _ = manager("gvo-bad-patcher")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-12/",
        {"section": "head", "values": {"weird": 1}},
        format="json",
    )
    assert r.status_code == 400
    assert OpsGvoSummaryPatch.objects.count() == 0  # мусор не сохранён


def test_gvo_patch_unknown_om_code_is_404():
    api, _ = manager("gvo-lost-patcher")
    assert (
        api.patch(
            f"{GVO_URL}НЕТ-ТАКОГО/",
            {"section": "head", "values": {"country": "Y"}},
            format="json",
        )
    ).status_code == 404


def test_gvo_patch_denied_for_viewer():
    make_event("ОМ-Т-13")
    r = viewer("gvo-view-only").patch(
        f"{GVO_URL}ОМ-Т-13/",
        {"section": "head", "values": {"country": "Y"}},
        format="json",
    )
    assert r.status_code == 403


def test_gvo_reset_removes_only_section_keys():
    ev = make_event("ОМ-Т-14")
    OpsGvoSummaryPatch.objects.create(
        event=ev, patch={"country": "X", "weapons": "нет"}
    )
    assert (
        viewer("gvo-reset-viewer").post(
            f"{GVO_URL}ОМ-Т-14/reset/", {"section": "head"}, format="json"
        )
    ).status_code == 403
    api, _ = manager("gvo-resetter")
    r = api.post(f"{GVO_URL}ОМ-Т-14/reset/", {"section": "head"}, format="json")
    assert r.status_code == 200
    ev.refresh_from_db()
    # Снят только ключ раздела head (country); чужой ключ остался.
    assert ev.gvo_patch.patch == {"weapons": "нет"}


def test_gvo_reset_of_last_section_deletes_record():
    ev = make_event("ОМ-Т-16")
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "X"})
    api, _ = manager("gvo-last-resetter")
    r = api.post(f"{GVO_URL}ОМ-Т-16/reset/", {"section": "head"}, format="json")
    assert r.status_code == 200
    assert r.json()["patch"] == {}
    assert not OpsGvoSummaryPatch.objects.filter(event=ev).exists()


def test_gvo_patch_writes_new_audit_row():
    from organization_management.apps.operations.models_audit import OpsAuditLog

    make_event("ОМ-Т-15")
    before_pks = set(OpsAuditLog.objects.values_list("pk", flat=True))
    api, _ = manager("gvo-audited")
    assert (
        api.patch(
            f"{GVO_URL}ОМ-Т-15/",
            {"section": "head", "values": {"country": "Z"}},
            format="json",
        )
    ).status_code == 200
    new_rows = OpsAuditLog.objects.exclude(pk__in=before_pks)
    # Новый pk, не счётчик: строка именно ОБ ЭТОЙ правке.
    assert new_rows.filter(action="GVO_SUMMARY_PATCHED").count() == 1


def test_gvo_patch_rejects_retired_visits_section():
    """Раздел «Объекты посещения» патчем больше НЕ правится («Реестр ОМ-35.1»).

    Объекты посещения живут таблицей мероприятия; пока патч принимал ключ
    `visits`, у одного вопроса было два ответа, и они расходились молча.
    Отказ здесь громкий нарочно: молчаливое сохранение похоронило бы правку в
    списке, который никто не читает.
    """
    make_event("ОМ-Т-17")
    api, _ = manager("gvo-visits-retired")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-17/",
        {"section": "visits", "values": {"visits": []}},
        format="json",
    )
    assert r.status_code == 400
    assert "visits" in str(r.json())
    r = api.post(f"{GVO_URL}ОМ-Т-17/reset/", {"section": "visits"}, format="json")
    assert r.status_code == 400
