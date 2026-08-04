"""POST /api/operations/daily-submissions/ — маршрут сдачи дня.

Вьюха тонкая, поэтому проверяется ровно её зона: гейт права, происхождение
области записи (из RBAC, а не из тела), происхождение актора (из
аутентификации), форма 201 и доставка отказов сервиса конвертом раздела, а
не 500-й. Правила самой сдачи — окно, повтор, событие, опоздание — живут в
day_submission_service и покрыты test_day_submission_service.py.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    make_employee,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

URL = "/api/operations/daily-submissions/"
SUBMIT_PERMS = ["daily_report.mark_update"]


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def other_division():
    return Division.objects.create(name="Управление 2")


def body(division, business_date=TODAY, **overrides):
    payload = {
        "division_id": division.id,
        "business_date": business_date.isoformat(),
    }
    payload.update(overrides)
    return payload


def post(api, payload, at=TODAY):
    with clock.override(at):
        return api.post(URL, payload, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области: оба 403, различает форма (гейт →
    {detail} DRF, область → конверт {error_code})."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    response = post(APIClient(), body(division))
    assert_denied_by_gate(response)
    assert not OpsDailySubmission.objects.exists()


def test_reader_cannot_submit(types, division):
    # Чтение статусов сдачу дня не открывает: это запись.
    api, _ = client_for("day-viewer", "VIEWER", ["status.view"])
    assert_denied_by_gate(post(api, body(division)))
    assert not OpsDailySubmission.objects.exists()


def test_corrector_permission_does_not_open_submission(types, division):
    # Право ПОПРАВКИ сданного не даёт сдавать: разные полномочия, и общий код
    # выдал бы правку задним числом всем, кому разрешили отмечать.
    api, _ = client_for("day-corrector", "CORRECTOR", ["daily_report.correct"])
    assert_denied_by_gate(post(api, body(division)))
    assert not OpsDailySubmission.objects.exists()


# ── Область записи ───────────────────────────────────────────────────────

def test_foreign_division_denied_by_scope(types, division, other_division):
    api, _ = client_for(
        "day-scoped", "OPERATOR", SUBMIT_PERMS, scope_division_id=division.id
    )
    response = post(api, body(other_division))
    # Конверт раздела, а не {detail} DRF: право ЕСТЬ, не хватает области.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert response.data["details"] == {"division_id": str(other_division.id)}
    assert not OpsDailySubmission.objects.exists()


def test_own_division_passes_scope(types, division):
    api, _ = client_for(
        "day-own", "OPERATOR", SUBMIT_PERMS, scope_division_id=division.id
    )
    response = post(api, body(division))
    assert response.status_code == 201, response.data
    assert OpsDailySubmission.objects.filter(division_id=division.id).exists()


def test_scope_is_checked_before_existence(types, division):
    # Скоупованный чужак не должен узнавать о существовании подразделения по
    # разнице между 404 и 403: сначала область, потом сервис.
    api, _ = client_for(
        "day-oracle", "OPERATOR", SUBMIT_PERMS, scope_division_id=division.id
    )
    phantom = division.id + 10_000
    response = post(api, {"division_id": phantom, "business_date": TODAY.isoformat()})
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_scope_ignores_division_in_query(types, division, other_division):
    # Область считается по ТЕЛУ запроса; подсунуть своё подразделение в query
    # и сдать за чужое нельзя.
    api, _ = client_for(
        "day-query", "OPERATOR", SUBMIT_PERMS, scope_division_id=division.id
    )
    with clock.override(TODAY):
        response = api.post(
            f"{URL}?division_id={division.id}", body(other_division), format="json"
        )
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not OpsDailySubmission.objects.exists()


# ── Актор и форма ответа ─────────────────────────────────────────────────

def test_actor_comes_from_authentication(types, division):
    api, user = client_for("day-actor", "ADMIN", ["*"])
    response = post(
        api, body(division, submitted_by="Кто-то другой", late=True)
    )
    assert response.status_code == 201, response.data
    row = OpsDailySubmission.objects.get(pk=response.data["id"])
    # Присланные submitted_by/late проигнорированы: подпись и отметка
    # опоздания — факты сервера, а не поля тела.
    assert row.submitted_by == str(user.pk)
    assert response.data["submitted_by"] == str(user.pk)
    assert row.late is False


def test_response_carries_the_row_without_snapshot(types, division):
    api, user = client_for("day-shape", "ADMIN", ["*"])
    employee = make_employee(division)
    response = post(api, body(division))
    assert response.status_code == 201, response.data
    assert set(response.data) == {
        "id", "division_id", "business_date", "version", "is_current",
        "event", "submitted_by", "submitted_at", "late",
    }
    assert response.data["division_id"] == division.id
    assert response.data["business_date"] == TODAY.isoformat()
    assert response.data["version"] == 1
    assert response.data["is_current"] is True
    assert response.data["event"] == OpsDailySubmission.Event.CHANGED
    # Снимок собран (сотрудник в знаменателе) — но наружу не поехал.
    row = OpsDailySubmission.objects.get(pk=response.data["id"])
    assert [entry["employee_id"] for entry in row.snapshot["roster"]] == [employee.id]


def test_tomorrow_is_submittable(types, division):
    # Основной режим раздела — сдача на день вперёд; дата берётся из тела.
    api, _ = client_for("day-tomorrow", "ADMIN", ["*"])
    tomorrow = TODAY + timedelta(days=1)
    response = post(api, body(division, business_date=tomorrow))
    assert response.status_code == 201, response.data
    assert response.data["business_date"] == tomorrow.isoformat()


# ── Форма тела ───────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "case, field",
    [
        ("no_division", "division_id"),
        ("no_date", "business_date"),
        ("garbage_division", "division_id"),
        ("garbage_date", "business_date"),
    ],
)
def test_broken_body_is_400(types, division, case, field):
    api, _ = client_for(f"day-form-{case}", "ADMIN", ["*"])
    payload = {
        "no_division": {"business_date": TODAY.isoformat()},
        "no_date": {"division_id": division.id},
        "garbage_division": {
            "division_id": "две", "business_date": TODAY.isoformat()
        },
        "garbage_date": {"division_id": division.id, "business_date": "вчера"},
    }[case]
    response = post(api, payload)
    assert response.status_code == 400
    assert field in response.data
    assert not OpsDailySubmission.objects.exists()


# ── Отказы сервиса доезжают конвертом ────────────────────────────────────

def test_missing_division_is_404_envelope(types, division):
    api, _ = client_for("day-404", "ADMIN", ["*"])
    phantom = division.id + 10_000
    response = post(api, {"division_id": phantom, "business_date": TODAY.isoformat()})
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_repeat_submission_is_409_envelope(types, division):
    api, _ = client_for("day-409", "ADMIN", ["*"])
    assert post(api, body(division)).status_code == 201
    response = post(api, body(division))
    assert response.status_code == 409
    assert response.data["error_code"] == "DAY_ALREADY_SUBMITTED"
    assert OpsDailySubmission.objects.count() == 1


def test_date_out_of_window_is_422_envelope(types, division):
    api, _ = client_for("day-422", "ADMIN", ["*"])
    response = post(api, body(division, business_date=TODAY - timedelta(days=1)))
    assert response.status_code == 422
    assert response.data["error_code"] == "BUSINESS_DATE_OUT_OF_WINDOW"
    assert not OpsDailySubmission.objects.exists()


def test_window_moves_with_the_clock(types, division):
    # Окно считается в момент вызова, а не при импорте: вчерашняя по
    # календарю дата сдаётся, если «сегодня» — это она.
    api, _ = client_for("day-window", "ADMIN", ["*"])
    yesterday = TODAY - timedelta(days=1)
    response = post(api, body(division, business_date=yesterday), at=yesterday)
    assert response.status_code == 201, response.data


# ── Поверхность методов ──────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["get", "put", "patch", "delete"])
def test_only_post_is_served(types, division, method):
    """Кроме записи, маршрут не отвечает ничем.

    Пинится ОТСУТСТВИЕ действий, а не http_method_names: добавленный list()
    сделает GET успешным (проверено красной пробой), и это уже другой срез —
    у чтения снимка своя область видимости. Правки и удаления не будет и
    потом: сданное иммутабельно, его единственная законная перезапись —
    поправка отдельным действием со своей причиной.
    """
    api, _ = client_for(f"day-method-{method}", "ADMIN", ["*"])
    with clock.override(TODAY):
        response = getattr(api, method)(URL, {}, format="json")
    assert response.status_code == 405


def test_business_date_is_not_defaulted(types, division):
    # Пустое тело — 400, а не «сдал сегодняшний день»: молчаливый дефолт
    # записал бы заявление не тем числом.
    api, _ = client_for("day-empty", "ADMIN", ["*"])
    response = post(api, {})
    assert response.status_code == 400
    assert not OpsDailySubmission.objects.exists()


# ── Гонка ────────────────────────────────────────────────────────────────

def test_race_constraints_map_to_the_same_409(types):
    """Сдача, проскочившая предпроверку, обязана выглядеть бизнес-отказом.

    Обе уникальности дня ведут в один код: проигравшему гонку незачем знать,
    на какой именно из них он встал.
    """
    from organization_management.apps.operations.api.exception_handler import (
        CONSTRAINT_ERROR_MAP,
    )

    for name in ("unique_ops_submission_current", "unique_ops_submission_version"):
        assert CONSTRAINT_ERROR_MAP[name] == ("DAY_ALREADY_SUBMITTED", 409, False)


def test_submission_writes_a_journal_entry_with_the_http_actor(types, division):
    # Журнал раздела получает АКТОРА ЗАПРОСА, а не системную метку: событие
    # сдачи должно указывать на того, кто нажал кнопку.
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    api, user = client_for("day-journal", "ADMIN", ["*"])
    response = post(api, body(division))
    assert response.status_code == 201, response.data
    entry = OpsAuditLog.objects.get(
        entity_type=audit_service.ENTITY_SUBMISSION, entity_id=response.data["id"]
    )
    assert entry.actor_user_id == str(user.pk)
    assert entry.action == audit_service.DAILY_SUBMISSION_SUBMITTED


def test_date_from_the_past_leaves_no_journal_trace(types, division):
    # Отклонённая сдача не пишет в журнал ничего: журнал рассказывает о
    # случившемся, а не о попытках.
    from organization_management.apps.operations.models_audit import OpsAuditLog

    api, _ = client_for("day-no-trace", "ADMIN", ["*"])
    before = OpsAuditLog.objects.count()
    assert post(
        api, body(division, business_date=TODAY - timedelta(days=1))
    ).status_code == 422
    assert OpsAuditLog.objects.count() == before
