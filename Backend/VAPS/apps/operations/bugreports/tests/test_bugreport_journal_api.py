"""Story 13.4a — resolve + journal HTTP surface.

resolve: same holder as list/retrieve (bugreports.view), 409 on a second
call. journal: any authenticated user (mirrors create's gate), anonymized
projection — user_id/screen_path/description never reach it.
"""

import re
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.bugreports.models import BugReport
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded():
    call_command("seed_operations")


def _seed_report(description="что-то сломалось"):
    return BugReport.objects.create(
        user_id="op-1", screen_path="/x", description=description
    )


def test_resolve_requires_bugreports_view(seeded):
    report = _seed_report()
    resp = _client("plain-operator").post(
        reverse("bugreport-resolve", kwargs={"pk": report.id}),
        {"resolved_in_version": "abc1234", "resolution_summary": "исправлено"},
        format="json",
    )
    assert resp.status_code == 403


def test_resolve_sets_fields_and_returns_them(seeded):
    report = _seed_report()
    UserRole.objects.create(user_id="the-dev", role_code_id="DEVELOPER")
    resp = _client("the-dev").post(
        reverse("bugreport-resolve", kwargs={"pk": report.id}),
        {"resolved_in_version": "abc1234", "resolution_summary": "исправлено"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["resolved_in_version"] == "abc1234"
    assert resp.data["resolution_summary"] == "исправлено"
    assert resp.data["resolved_at"] is not None
    report.refresh_from_db()
    assert report.resolved_in_version == "abc1234"


def test_resolve_twice_is_409(seeded):
    report = _seed_report()
    UserRole.objects.create(user_id="the-dev-2", role_code_id="DEVELOPER")
    client = _client("the-dev-2")
    url = reverse("bugreport-resolve", kwargs={"pk": report.id})
    client.post(
        url,
        {"resolved_in_version": "abc1234", "resolution_summary": "исправлено"},
        format="json",
    )
    resp = client.post(
        url,
        {"resolved_in_version": "def5678", "resolution_summary": "снова"},
        format="json",
    )
    assert resp.status_code == 409
    report.refresh_from_db()
    assert report.resolved_in_version == "abc1234"  # unchanged by the 2nd call


def test_resolve_rejects_blank_fields(seeded):
    report = _seed_report()
    UserRole.objects.create(user_id="the-dev-3", role_code_id="DEVELOPER")
    resp = _client("the-dev-3").post(
        reverse("bugreport-resolve", kwargs={"pk": report.id}),
        {"resolved_in_version": "  ", "resolution_summary": "x"},
        format="json",
    )
    assert resp.status_code == 400


def test_journal_requires_authentication_only(seeded):
    resp = APIClient().get(reverse("bugreport-journal"))
    assert resp.status_code == 403


def test_journal_visible_to_any_authenticated_user_no_role_needed(seeded):
    report = _seed_report()
    UserRole.objects.create(user_id="the-dev-4", role_code_id="DEVELOPER")
    _client("the-dev-4").post(
        reverse("bugreport-resolve", kwargs={"pk": report.id}),
        {"resolved_in_version": "abc1234", "resolution_summary": "публичный текст"},
        format="json",
    )

    resp = _client("no-role-reader").get(reverse("bugreport-journal"))
    assert resp.status_code == 200
    entry = resp.data["results"][0]
    assert entry["version"] == "abc1234"
    assert entry["summary"] == "публичный текст"
    assert set(entry) == {"id", "version", "releasedAt", "summary"}


def test_journal_excludes_unresolved_reports(seeded):
    _seed_report()  # never resolved
    UserRole.objects.create(user_id="reader-1", role_code_id="DEVELOPER")
    resp = _client("reader-1").get(reverse("bugreport-journal"))
    assert resp.data["results"] == []


def test_journal_projection_has_no_pii_fields(seeded):
    report = _seed_report(description="конфиденциальный текст оператора")
    UserRole.objects.create(user_id="the-dev-5", role_code_id="DEVELOPER")
    _client("the-dev-5").post(
        reverse("bugreport-resolve", kwargs={"pk": report.id}),
        {"resolved_in_version": "abc1234", "resolution_summary": "исправлено"},
        format="json",
    )
    resp = _client("reader-2").get(reverse("bugreport-journal"))
    body = str(resp.data)
    assert "конфиденциальный" not in body
    assert "op-1" not in body
    assert "/x" not in body


def test_bugreport_already_resolved_code_in_registry():
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    block = re.search(r"^  BUGREPORT_ALREADY_RESOLVED:\n((?:    .*\n)+)", text, re.M)
    assert block, "BUGREPORT_ALREADY_RESOLVED missing from error-codes.yaml"
    assert "http_status: 409" in block.group(1)
