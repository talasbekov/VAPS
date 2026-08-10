"""Гейт блокировки завтрашнего дня на живом расходе.

Зона вьюхи и гейта, а не вывода (тот покрыт test_tomorrow_block.py): какие
даты вообще гейтятся, что попадает в отказ, как его снимает сдача и как —
законный обход, и в каком порядке стоят гарды. Отдельно — что мусор в
настройке (удалённое или отключённое подразделение) не запирает раздел
навсегда.
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

URL = "/api/operations/strength-report/"
SUBMITTED_URL = "/api/operations/strength-report/submitted/"
ACTOR = "7"
TOMORROW = TODAY + timedelta(days=1)
YESTERDAY = TODAY - timedelta(days=1)


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def require(*divisions):
    row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    row.required_division_ids = [d.id for d in divisions]
    row.save(update_fields=["required_division_ids"])


def admin(name="tg-admin"):
    api, _ = client_for(name, "ADMIN", ["*"])
    return api


def get(api, business_date=TOMORROW, url=URL, **params):
    if business_date is not None:
        params["business_date"] = business_date.isoformat()
    with clock.override(MORNING):
        return api.get(url, params)


def submit(division, business_date=TOMORROW):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


# ── Какие даты гейтятся ──────────────────────────────────────────────────


def test_future_date_with_a_laggard_is_422(types, division):
    require(division)

    response = get(admin())

    assert response.status_code == 422
    assert response.data["error_code"] == "TOMORROW_BLOCKED"
    assert response.data["details"] == {"laggards": [division.id]}


def test_today_is_never_blocked(types, division):
    """«Нельзя планировать завтра, пока не известно сегодня».

    Закрыв блокировкой сегодня, раздел запретил бы смотреть на обстановку
    ровно тем, от кого сдачи и ждёт.
    """
    require(division)

    response = get(admin(), business_date=TODAY)

    assert response.status_code == 200


def test_past_dates_are_never_blocked(types, division):
    require(division)

    response = get(admin(), business_date=YESTERDAY)

    assert response.status_code == 200


def test_the_default_date_is_not_blocked(types, division):
    # Умолчание — сегодня, а сегодня не гейтится: иначе раздел закрылся бы
    # целиком от первой же незаполненной сдачи.
    require(division)

    response = get(admin(), business_date=None)

    assert response.status_code == 200


def test_the_submitted_expense_is_not_gated(types, division):
    """Сданный расход отвечает про подписанное, а не про план.

    Ему блокировка не указ: день, о котором он рассказывает, уже сдан.
    """
    require(division)
    submit(division)

    response = get(admin(), url=SUBMITTED_URL, division_id=division.id)

    assert response.status_code == 200


# ── Что снимает замок ────────────────────────────────────────────────────


def test_a_submission_for_that_date_lifts_the_block(types, division):
    require(division)
    api = admin()
    assert get(api).status_code == 422

    submit(division)

    assert get(api).status_code == 200


def test_a_submission_for_another_date_does_not_lift_the_block(types, division):
    require(division)
    submit(division, business_date=TODAY)

    assert get(admin()).status_code == 422


def test_a_legal_override_lifts_the_block(types, division):
    require(division)
    api = admin()
    assert get(api).status_code == 422

    override_tomorrow_block(
        business_date=TOMORROW, actor=ACTOR, reason="решение руководителя"
    )

    assert get(api).status_code == 200


def test_an_empty_required_list_blocks_nothing(types, division):
    require()

    assert get(admin()).status_code == 200


# ── Мусор в настройке не запирает раздел ─────────────────────────────────


def test_a_deleted_required_division_does_not_block(types, division):
    """Сдать за удалённое подразделение не может НИКТО.

    Оставь его отстающим — и завтра оказалось бы закрыто навсегда, причём с
    перечнем виноватых, в котором никого нельзя ни спросить, ни найти.
    """
    require(division)
    division.delete()

    assert get(admin()).status_code == 200


def test_a_deactivated_required_division_does_not_block(types, division):
    require(division)
    Division.objects.filter(pk=division.id).update(is_active=False)

    assert get(admin()).status_code == 200


def test_garbage_does_not_hide_a_real_laggard(types, division):
    """Фильтр мусора не смеет уносить с собой живого должника."""
    ghost = Division.objects.create(name="Призрак")
    require(division, ghost)
    ghost.delete()

    response = get(admin())

    assert response.status_code == 422
    assert response.data["details"] == {"laggards": [division.id]}


# ── Порядок гардов ───────────────────────────────────────────────────────


def test_anonymous_is_403_even_on_a_blocked_date(types, division):
    require(division)

    response = get(APIClient())

    assert response.status_code == 403


def test_a_foreign_division_is_403_not_422(types, division):
    """Чужому нельзя даже сообщать, заблокирован ли день.

    422 вместо 403 рассказал бы посторонним и о существовании подразделения,
    и о состоянии его сдач.
    """
    require(division)
    foreign = Division.objects.create(name="Чужое")
    api, _ = client_for(
        "tg-scoped", "OPERATOR", ["status.view"], scope_division_id=foreign.id
    )

    response = get(api, division_id=division.id)

    assert response.status_code == 403


def test_the_laggards_list_is_section_wide_for_a_scoped_operator(types, division):
    """Список отстающих общий по разделу, а не суженный областью.

    Заблокирован день целиком; оператору, у которого в области все сдали,
    отказ иначе выглядел бы беспричинным.
    """
    own = Division.objects.create(name="Своё")
    require(division, own)
    submit(own)
    api, _ = client_for(
        "tg-scoped2", "OPERATOR", ["status.view"], scope_division_id=own.id
    )

    response = get(api, division_id=own.id)

    assert response.status_code == 422
    assert response.data["details"] == {"laggards": [division.id]}
