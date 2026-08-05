"""GET /api/operations/tomorrow-block/ — состояние блокировки для экрана.

Главное здесь — ОДИН РАССКАЗ: показ обязан объяснять ровно тот отказ, который
поднимает гейт. Поэтому список отстающих сверяется с деталями 422 живьём, а не
глазами. Остальное — умолчание даты (завтра, а не сегодня), имена вместо голых
id, видимость обхода и то, что чтение не требует права обходить.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.block_override import (
    override_tomorrow_block,
)
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
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

URL = "/api/operations/tomorrow-block/"
EXPENSE_URL = "/api/operations/strength-report/"
ACTOR = "7"
TOMORROW = TODAY + timedelta(days=1)


@pytest.fixture
def division():
    return Division.objects.create(name="Управление кадров")


def require(*divisions):
    row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    row.required_division_ids = [d.id for d in divisions]
    row.save(update_fields=["required_division_ids"])


def reader(name="tbs-reader"):
    api, _ = client_for(name, "OBSERVER", ["status.view"])
    return api


def get(api, business_date=TOMORROW, **params):
    if business_date is not None:
        params["business_date"] = business_date.isoformat()
    with clock.override(MORNING):
        return api.get(URL, params)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_403():
    assert get(APIClient()).status_code == 403


def test_reading_the_block_does_not_require_the_right_to_override(types, division):
    """Видеть замок и снимать его — разные полномочия.

    Дежурному нужно знать, кого поторопить; право руководителя ему для
    этого не выдают.
    """
    require(division)

    response = get(reader())

    assert response.status_code == 200
    assert response.data["blocked"] is True


# ── Что показывается ─────────────────────────────────────────────────────


def test_the_laggards_carry_names(types, division):
    require(division)

    response = get(reader())

    assert response.data["laggards"] == [
        {"division_id": division.id, "name": "Управление кадров"}
    ]


def test_the_shown_laggards_are_exactly_those_in_the_refusal(types, division):
    """Показ и отказ — один рассказ.

    Разбери каждый список сам — и экран однажды объяснил бы отказ не тем
    перечнем, что стоял в отказе; заметили бы это, только начав спрашивать
    людей из списка.
    """
    ghost = Division.objects.create(name="Призрак")
    require(division, ghost)
    ghost.delete()
    api = reader()

    shown = get(api)
    with clock.override(MORNING):
        refused = api.get(EXPENSE_URL, {"business_date": TOMORROW.isoformat()})

    assert refused.status_code == 422
    assert [row["division_id"] for row in shown.data["laggards"]] == refused.data[
        "details"
    ]["laggards"]


def test_all_submitted_is_not_blocked(types, division):
    require(division)
    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TOMORROW, actor=ACTOR)

    response = get(reader())

    assert response.data["blocked"] is False
    assert response.data["laggards"] == []


def test_an_override_is_visible_and_keeps_the_laggards(types, division):
    require(division)
    override_tomorrow_block(business_date=TOMORROW, actor=ACTOR, reason="решение")

    response = get(reader())

    assert response.data["blocked"] is False
    assert response.data["overridden"] is True
    # Отстающие остаются: иначе снятый замок выглядел бы как «все сдали».
    assert [row["division_id"] for row in response.data["laggards"]] == [division.id]


def test_an_override_without_laggards_is_not_reported(types, division):
    require()
    override_tomorrow_block(business_date=TOMORROW, actor=ACTOR, reason="решение")

    response = get(reader())

    assert response.data["overridden"] is False


# ── Даты ─────────────────────────────────────────────────────────────────


def test_the_default_date_is_tomorrow(types, division):
    """Умолчание — ЗАВТРА, а не сегодня.

    Спрашивают о блокировке, а она бывает только на будущем: умолчание
    «сегодня» отвечало бы «не закрыто» всегда, то есть никогда бы не
    отвечало.
    """
    require(division)

    response = get(reader(), business_date=None)

    assert response.data["business_date"] == TOMORROW
    assert response.data["blocked"] is True


def test_today_is_never_blocked(types, division):
    require(division)

    response = get(reader(), business_date=TODAY)

    assert response.data["blocked"] is False
    assert response.data["laggards"] == []


def test_a_past_date_is_never_blocked(types, division):
    require(division)

    response = get(reader(), business_date=TODAY - timedelta(days=3))

    assert response.data["blocked"] is False


def test_an_unreadable_date_is_400(types):
    api = reader()
    with clock.override(MORNING):
        response = api.get(URL, {"business_date": "позавчера"})

    assert response.status_code == 400
