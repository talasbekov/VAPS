"""Story 13.4a — resolve + journal HTTP surface.

resolve: same holder as list/retrieve (bugreports.view), 409 on a second
call. journal: any authenticated user (mirrors create's gate), anonymized
projection — user_id/screen_path/description never reach it.
"""

import json
import re
import threading
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.bugreports.models import BugReport
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


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
    # Review (Blind Hunter): key-presence alone doesn't pin the WIRE format —
    # DRF's Response.data is pre-render, so a regression turning releasedAt
    # into a full datetime (breaking FixEntry.releasedAt's exact-string
    # contract in changelog.ts) would leave a key-only assertion green.
    # json.dumps(default=str) mirrors DRF's own JSONEncoder behavior for
    # date objects (both ultimately call date.isoformat()-equivalent).
    rendered = json.loads(json.dumps(resp.data, default=str))
    released_at = rendered["results"][0]["releasedAt"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", released_at), released_at


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


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_resolve_exactly_one_wins_no_lost_update():
    # Review (Blind Hunter + Edge Case Hunter, independently confirmed):
    # get_object_or_404 + Python `is not None` check + save() was a
    # check-then-act race — two concurrent resolvers could both read
    # resolved_at=None and the second save() would silently clobber the
    # first with no error. select_for_update() inside @transaction.atomic
    # (the fix) should serialize them: exactly one 200, the other 409, and
    # the row must hold the WINNER's fields, never a hybrid/lost update.
    call_command("seed_operations")
    report = BugReport.objects.create(
        user_id="op-race", screen_path="/x", description="race"
    )
    UserRole.objects.create(user_id="dev-a", role_code_id="DEVELOPER")
    UserRole.objects.create(user_id="dev-b", role_code_id="DEVELOPER")

    url = reverse("bugreport-resolve", kwargs={"pk": report.id})
    first_in_transaction = threading.Event()
    second_attempting = threading.Event()
    results = {}

    def resolve_as(actor, version, barrier_wait=None, barrier_set=None):
        try:
            if barrier_wait is not None:
                assert barrier_wait.wait(timeout=WAIT), "peer thread never signalled"
            if barrier_set is not None:
                barrier_set.set()
            client = _client(actor)
            resp = client.post(
                url,
                {"resolved_in_version": version, "resolution_summary": f"by {actor}"},
                format="json",
            )
            results[actor] = resp.status_code
        finally:
            connection.close()

    # Thread A starts, signals it's in-flight; thread B waits for that
    # signal before attempting — both still race for the row lock, but this
    # bounds the test's own wall-clock instead of relying on pure luck.
    thread_a = threading.Thread(
        target=resolve_as,
        args=("dev-a", "aaa1111"),
        kwargs={"barrier_set": first_in_transaction},
    )
    thread_b = threading.Thread(
        target=resolve_as,
        args=("dev-b", "bbb2222"),
        kwargs={"barrier_wait": first_in_transaction, "barrier_set": second_attempting},
    )
    thread_a.start()
    thread_b.start()
    for t in (thread_a, thread_b):
        t.join(timeout=WAIT)
        assert not t.is_alive(), "thread hung past the deadline"

    assert set(results.values()) == {200, 409}, results
    winner = "dev-a" if results["dev-a"] == 200 else "dev-b"
    winner_version = "aaa1111" if winner == "dev-a" else "bbb2222"

    report.refresh_from_db()
    # The row holds EXACTLY the winner's fields — not a hybrid of both
    # (the lost-update failure mode the race would otherwise produce).
    assert report.resolved_in_version == winner_version
