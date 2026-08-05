"""POST /api/operations/tomorrow-block/override/ — маршрут законного обхода.

Зона вьюхи, а не сервиса (запись, ограничения и журнал покрыты
test_tomorrow_block_override.py): свой гейт права, границы допустимой даты
(в будущем и не дальше горизонта), подпись из аутентификации и сквозняк —
после обхода расход на эту дату отдаётся.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/operations/tomorrow-block/override/"
EXPENSE_URL = "/api/operations/strength-report/"
TOMORROW = TODAY + timedelta(days=1)
REASON = "решение руководителя"
HORIZON = 7


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def require(*divisions):
    row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    row.required_division_ids = [d.id for d in divisions]
    row.save(update_fields=["required_division_ids"])


def boss(name="ov-boss"):
    api, user = client_for(
        name, "ORGD", ["daily_report.override_block", "status.view"]
    )
    return api, user


def post(api, business_date=TOMORROW, reason=REASON, **body):
    if business_date is not None:
        body["business_date"] = business_date.isoformat()
    if reason is not None:
        body["reason"] = reason
    with clock.override(MORNING):
        return api.post(URL, body, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_403():
    response = post(APIClient())

    assert response.status_code == 403
    assert OpsTomorrowBlockOverride.objects.count() == 0


def test_the_right_to_submit_is_not_the_right_to_override():
    """Обход снимает замок со ВСЕГО раздела на целый день.

    Выдать его вместе с отметками в отчёте значило бы раздать полномочие
    руководителя каждому оператору.
    """
    api, _ = client_for(
        "ov-op", "OPERATOR", ["daily_report.mark_update", "daily_report.correct"]
    )

    response = post(api)

    assert response.status_code == 403
    assert OpsTomorrowBlockOverride.objects.count() == 0


# ── Границы даты ─────────────────────────────────────────────────────────


def test_a_future_date_is_recorded():
    api, user = boss()

    response = post(api)

    assert response.status_code == 201
    assert response.data["business_date"] == TOMORROW.isoformat()
    assert response.data["reason"] == REASON
    # Подпись — из аутентификации, а не из тела.
    assert response.data["overridden_by"] == str(user.pk)


def test_the_actor_from_the_body_is_ignored():
    api, user = boss()

    response = post(api, overridden_by="999", actor="999")

    assert response.status_code == 201
    assert response.data["overridden_by"] == str(user.pk)


@pytest.mark.parametrize("shift", [0, -1, -30])
def test_a_non_future_date_is_400(shift):
    """Обходить нечего: гейт прошлое и сегодня не закрывает.

    Такая заявка не разрешение, а недоразумение, и записанной она осталась бы
    в журнале как чьё-то решение.
    """
    api, _ = boss()

    response = post(api, business_date=TODAY + timedelta(days=shift))

    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert OpsTomorrowBlockOverride.objects.count() == 0


def test_the_last_day_of_the_horizon_is_allowed():
    api, _ = boss()

    response = post(api, business_date=TODAY + timedelta(days=HORIZON))

    assert response.status_code == 201


def test_a_date_beyond_the_horizon_is_400():
    """Строка неотзывна: опечатка в годе открыла бы день навсегда."""
    api, _ = boss()

    response = post(api, business_date=TODAY + timedelta(days=HORIZON + 1))

    assert response.status_code == 400
    assert response.data["details"]["max_days_ahead"] == HORIZON
    assert OpsTomorrowBlockOverride.objects.count() == 0


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_an_unexplained_override_is_400(reason):
    api, _ = boss()

    response = post(api, reason=reason)

    assert response.status_code == 400
    assert OpsTomorrowBlockOverride.objects.count() == 0


def test_a_missing_date_is_400():
    api, _ = boss()

    response = post(api, business_date=None)

    assert response.status_code == 400
    assert OpsTomorrowBlockOverride.objects.count() == 0


# ── Состояние ────────────────────────────────────────────────────────────


def test_a_second_override_for_the_same_date_is_409():
    api, _ = boss()
    assert post(api).status_code == 201

    response = post(api, reason="ещё раз")

    assert response.status_code == 409
    assert response.data["error_code"] == "TOMORROW_BLOCK_ALREADY_OVERRIDDEN"
    assert OpsTomorrowBlockOverride.objects.count() == 1


# ── Сквозняк: обход открывает расход ─────────────────────────────────────


def test_the_expense_for_that_date_opens_after_the_override(types, division):
    require(division)
    api, _ = boss()
    with clock.override(MORNING):
        blocked = api.get(EXPENSE_URL, {"business_date": TOMORROW.isoformat()})
    assert blocked.status_code == 422

    assert post(api).status_code == 201

    with clock.override(MORNING):
        opened = api.get(EXPENSE_URL, {"business_date": TOMORROW.isoformat()})
    assert opened.status_code == 200


def test_the_override_does_not_open_another_date(types, division):
    require(division)
    api, _ = boss()
    assert post(api).status_code == 201

    with clock.override(MORNING):
        other = api.get(
            EXPENSE_URL,
            {"business_date": (TOMORROW + timedelta(days=1)).isoformat()},
        )

    assert other.status_code == 422
