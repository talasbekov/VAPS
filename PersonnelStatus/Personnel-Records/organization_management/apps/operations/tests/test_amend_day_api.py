"""POST /api/operations/daily-submissions/{id}/amend/ — маршрут поправки.

Зона вьюхи: СВОЙ гейт права (не тот, что у сдачи), область по подразделению
НАЙДЕННОЙ строки, происхождение актора, адресация цепочки по id любой
версии, форма 201 и доставка отказов сервиса конвертом. Правила самой
поправки живут в day_submission_service и покрыты test_amend_day.py.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    submitted,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

BASE = "/api/operations/daily-submissions/"
AMEND_PERMS = ["daily_report.correct"]
SUBMIT_PERMS = ["daily_report.mark_update"]
REASON = "Ошибка в наряде"
SANCTION = "Замечание оперативному дежурному"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def other_division():
    return Division.objects.create(name="Управление 2")


def amend_url(submission_id):
    return f"{BASE}{submission_id}/amend/"


def body(**overrides):
    payload = {"reason": REASON, "sanction": SANCTION}
    payload.update(overrides)
    return payload


def post(api, url, payload=None):
    with clock.override(TODAY):
        return api.post(url, body() if payload is None else payload, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области: оба 403, различает форма."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    row = submitted(division, TODAY)
    assert_denied_by_gate(post(APIClient(), amend_url(row.pk)))
    assert OpsDailySubmission.objects.count() == 1


def test_submitter_cannot_amend(types, division):
    # Право ОТМЕТОК не открывает правку подписанного: разные полномочия.
    api, _ = client_for("amend-submitter", "OPERATOR", SUBMIT_PERMS)
    row = submitted(division, TODAY)
    assert_denied_by_gate(post(api, amend_url(row.pk)))
    assert OpsDailySubmission.objects.count() == 1


def test_reader_cannot_amend(types, division):
    api, _ = client_for("amend-viewer", "VIEWER", ["status.view"])
    row = submitted(division, TODAY)
    assert_denied_by_gate(post(api, amend_url(row.pk)))


def test_corrector_can_amend_without_the_submit_right(types, division):
    # Обратная сторона: правка не требует права отмечать.
    api, _ = client_for("amend-corrector", "CORRECTOR", AMEND_PERMS)
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk))
    assert response.status_code == 201, response.data
    assert OpsDailySubmission.objects.count() == 2


# ── Область ──────────────────────────────────────────────────────────────

def test_foreign_division_denied_by_scope(types, division, other_division):
    api, _ = client_for(
        "amend-scoped", "CORRECTOR", AMEND_PERMS, scope_division_id=division.id
    )
    row = submitted(other_division, TODAY)
    response = post(api, amend_url(row.pk))
    # Конверт раздела: право есть, не хватает области.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert response.data["details"] == {"division_id": str(other_division.id)}
    assert OpsDailySubmission.objects.count() == 1


def test_scope_follows_the_resolved_row_not_the_payload(
    types, division, other_division
):
    # Подразделение из тела игнорируется: иначе поправку можно было бы
    # адресовать одному дню, а гейт пройти по другому.
    api, _ = client_for(
        "amend-payload", "CORRECTOR", AMEND_PERMS, scope_division_id=division.id
    )
    row = submitted(other_division, TODAY)
    response = post(api, amend_url(row.pk), body(division_id=division.id))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_own_division_passes_scope(types, division):
    api, _ = client_for(
        "amend-own", "CORRECTOR", AMEND_PERMS, scope_division_id=division.id
    )
    row = submitted(division, TODAY)
    assert post(api, amend_url(row.pk)).status_code == 201


# ── Адресация цепочки ────────────────────────────────────────────────────

def test_stale_version_id_amends_the_same_chain(types, division):
    api, _ = client_for("amend-chain", "ADMIN", ["*"])
    first = submitted(division, TODAY)
    second = post(api, amend_url(first.pk))
    assert second.status_code == 201, second.data
    # Ссылка на ту же (уже вытесненную) версию продолжает цепочку, а не
    # начинает вторую: голову перерезолвит сервис.
    third = post(api, amend_url(first.pk))
    assert third.status_code == 201, third.data
    assert third.data["version"] == 3
    assert (
        OpsDailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY, is_current=True
        ).count()
        == 1
    )


@pytest.mark.parametrize("pk", ["не-число", "0", "999999"])
def test_unknown_id_is_404_envelope(types, division, pk):
    api, _ = client_for(f"amend-404-{pk}", "ADMIN", ["*"])
    response = post(api, amend_url(pk))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


# ── Актор и форма ответа ─────────────────────────────────────────────────

def test_actor_comes_from_authentication(types, division):
    api, user = client_for("amend-actor", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk), body(submitted_by="кто-то другой"))
    assert response.status_code == 201, response.data
    amended = OpsDailySubmission.objects.get(pk=response.data["id"])
    assert amended.submitted_by == str(user.pk)


def test_response_carries_the_explanation(types, division):
    # Отличие от источника: ответ показывает записанные причину и санкцию —
    # текст обрезается сервисом, и присланное не равно сохранённому.
    api, _ = client_for("amend-shape", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(
        api, amend_url(row.pk), body(reason="  причина  ", sanction="  санкция  ")
    )
    assert response.status_code == 201, response.data
    assert set(response.data) == {
        "id", "division_id", "business_date", "version", "is_current",
        "event", "submitted_by", "submitted_at", "late",
        "reason", "sanction", "triggered_by_status_id",
    }
    assert response.data["reason"] == "причина"
    assert response.data["sanction"] == "санкция"
    assert response.data["event"] == OpsDailySubmission.Event.AMENDED
    assert response.data["version"] == 2
    assert response.data["triggered_by_status_id"] is None


def test_snapshot_never_leaves_through_this_route(types, division):
    api, _ = client_for("amend-nosnap", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk))
    assert "snapshot" not in response.data


# ── Форма тела ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("field", ["reason", "sanction"])
@pytest.mark.parametrize("value", ["", "   "])
def test_blank_explanation_is_400_naming_the_field(types, division, field, value):
    # Ассерт на КЛЮЧ поля обязателен: у amend_day свой такой же гард, и
    # ответ был бы 400 конвертом сервиса даже с allow_blank=True.
    api, _ = client_for(f"amend-blank-{field}-{len(value)}", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk), body(**{field: value}))
    assert response.status_code == 400
    assert field in response.data
    assert OpsDailySubmission.objects.count() == 1


@pytest.mark.parametrize("field", ["reason", "sanction"])
def test_missing_explanation_is_400(types, division, field):
    api, _ = client_for(f"amend-missing-{field}", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    payload = body()
    del payload[field]
    response = post(api, amend_url(row.pk), payload)
    assert response.status_code == 400
    assert field in response.data


def test_oversized_sanction_is_400_not_500(types, division):
    api, _ = client_for("amend-long", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk), body(sanction="я" * 256))
    assert response.status_code == 400
    assert "sanction" in response.data


def test_triggered_by_status_id_is_not_client_writable(types, division):
    # Происхождение поправки ставит система: принять ссылку от клиента
    # значило бы позволить приписать поправке любую причину появления.
    api, _ = client_for("amend-trigger", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk), body(triggered_by_status_id=777))
    assert response.status_code == 201, response.data
    assert response.data["triggered_by_status_id"] is None
    assert (
        OpsDailySubmission.objects.get(pk=response.data["id"]).triggered_by_status_id
        is None
    )


# ── Отказы сервиса и журнал ──────────────────────────────────────────────

def test_amendment_writes_the_journal_entry_with_the_http_actor(types, division):
    api, user = client_for("amend-journal", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    response = post(api, amend_url(row.pk))
    entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUBMISSION_AMENDED)
    assert entry.entity_id == response.data["id"]
    assert entry.actor_user_id == str(user.pk)
    assert entry.reason == REASON


def test_rejected_amendment_leaves_no_trace(types, division):
    api, _ = client_for("amend-no-trace", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    before = OpsAuditLog.objects.count()
    assert post(api, amend_url(row.pk), body(reason="")).status_code == 400
    assert OpsAuditLog.objects.count() == before
    row.refresh_from_db()
    assert row.is_current is True


def test_past_day_is_amendable(types, division):
    # Окно сдачи поправку не ограничивает — иначе позавчерашний день нечем
    # было бы исправить.
    api, _ = client_for("amend-past", "ADMIN", ["*"])
    row = submitted(division, TODAY - timedelta(days=30))
    response = post(api, amend_url(row.pk))
    assert response.status_code == 201, response.data
    assert response.data["business_date"] == (TODAY - timedelta(days=30)).isoformat()


# ── Поверхность маршрута ─────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["get", "put", "patch", "delete"])
def test_amend_answers_only_to_post(types, division, method):
    api, _ = client_for(f"amend-method-{method}", "ADMIN", ["*"])
    row = submitted(division, TODAY)
    with clock.override(TODAY):
        response = getattr(api, method)(amend_url(row.pk), {}, format="json")
    assert response.status_code == 405


def test_detail_route_itself_is_not_open(types, division):
    # Чтения одной сдачи нет: маршрута /{id}/ не существует вовсе.
    api, _ = client_for("amend-detail", "ADMIN", ["*"])
    with clock.override(TODAY):
        response = api.get(f"{BASE}{submitted(division, TODAY).pk}/")
    assert response.status_code == 404
