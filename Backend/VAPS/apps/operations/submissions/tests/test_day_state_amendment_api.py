"""Story 10.6 — amendment/summary-блоки detail-режима day-state.

Additive-расширение read-модели 10.3 (единственное изменение API стори):

- ``detail.amendment`` — {reason, sanction} ТЕКУЩЕЙ submitted-строки, если её
  event == AMENDED; иначе null (v1 CONFIRMED/CHANGED, несданный день,
  list-режим). ``triggered_by_status_id`` НЕ выдаётся (внутренний
  provenance-ref хука 5.4b);
- ``detail.summary`` — проекция ``summary_freshness`` 5.11 (status FRESH/STALE
  + оси superseded/missing/unpinned); null у обычной сдачи (current без
  ``sources``) и несданного дня;
- NFR-4: число SQL-запросов detail-режима — константа по числу детей/версий
  (freshness — один вызов сервиса, никаких per-child запросов из view).

Auth via HTTP_X_USER_ID (канон 5.8-сюит); роли — seed_operations + прямые
UserRole; Clock запинен clock.override; фикстуры сводки — канон
test_summary_service (_family: родитель со own-штабом + дети со штатом).
"""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import amend_day, submit_day
from apps.operations.submissions.services.summary_service import assemble_summary

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)
ACTOR = "op-1"
_iin = itertools.count(810_000)
_code = itertools.count(1)


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def org_dt():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-AMD")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    return org, dt


def make_division(org_dt, parent=None):
    org, dt = org_dt
    c = f"AMD-{next(_code)}"
    return Division.objects.create(
        organization=org, type_code=dt, name=c, code=c, parent=parent
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


@pytest.fixture
def global_op(org_dt):
    """DIVISION_OPERATOR с глобальной ролью (несёт mark_update — гейт day-state)."""
    UserRole.objects.create(
        user_id="op-global", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return "op-global"


def _submit(division, business_date=TODAY):
    return submit_day(division_id=division.id, business_date=business_date, actor=ACTOR)


def _amend(division, *, reason="уточнение задним числом", sanction="выговор"):
    return amend_day(
        division_id=division.id,
        business_date=TODAY,
        actor=ACTOR,
        reason=reason,
        sanction=sanction,
    )


def _assemble(division):
    return assemble_summary(division_id=division.id, business_date=TODAY, actor=ACTOR)


def _family(org_dt, children=1):
    """Родитель со own-штабом + ``children`` детей со штатом и сдачей."""
    parent = make_division(org_dt)
    make_employee(parent)
    kids = []
    for _ in range(children):
        child = make_division(org_dt, parent=parent)
        make_employee(child)
        kids.append((child, _submit(child)))
    return parent, kids


def _get(actor, division_id=None, business_date=TODAY):
    params = {"business_date": str(business_date)}
    if division_id is not None:
        params["division_id"] = str(division_id)
    client = APIClient()
    client.credentials(HTTP_X_USER_ID=actor)
    return client.get(reverse("ops-daily-submission-day-state"), params)


# -- AC-1: amendment-блок --------------------------------------------------------


def test_amendment_block_on_amended_current(global_op, org_dt):
    """Current v2 AMENDED → detail.amendment == {reason, sanction} ровно."""
    division = make_division(org_dt)
    make_employee(division)
    _submit(division)
    _amend(division, reason="ретро-правка статуса", sanction="устное замечание")

    response = _get(global_op, division_id=division.id)
    assert response.status_code == 200
    detail = response.json()["detail"]
    assert detail["amendment"] == {
        "reason": "ретро-правка статуса",
        "sanction": "устное замечание",
    }
    # triggered_by_status_id — внутренний provenance-ref, наружу НЕ едет.
    assert set(detail["amendment"]) == {"reason", "sanction"}
    # Сданный день: светофор на месте, preview НЕТ (ветка 10.3 не сломана).
    assert detail["preview_event"] is None
    assert detail["traffic_light"] is not None


def test_amendment_null_on_v1_current(global_op, org_dt):
    """Current v1 (CHANGED первой сдачи) → detail.amendment == null."""
    division = make_division(org_dt)
    make_employee(division)
    submission = _submit(division)
    assert submission.event != DailySubmission.Event.AMENDED

    detail = _get(global_op, division_id=division.id).json()["detail"]
    assert detail["amendment"] is None


def test_amendment_null_on_unsubmitted_day(global_op, org_dt):
    """День не сдан → preview-ветка не меняется, amendment/summary == null."""
    division = make_division(org_dt)
    make_employee(division)

    detail = _get(global_op, division_id=division.id).json()["detail"]
    assert detail["preview_event"] is not None
    assert detail["traffic_light"] is None
    assert detail["amendment"] is None
    assert detail["summary"] is None


def test_list_mode_detail_stays_null(global_op, org_dt):
    """Без division_id — list-режим: detail == null, как в 10.3."""
    division = make_division(org_dt)
    make_employee(division)
    _submit(division)
    _amend(division)

    payload = _get(global_op).json()
    assert payload["detail"] is None
    # Списочная 9-полевая проекция НЕ расширена (контракт 10.3/10.4 стабилен).
    row = next(r for r in payload["divisions"] if r["division_id"] == str(division.id))
    assert "reason" not in row["submission"]
    assert "sanction" not in row["submission"]


# -- AC-2: summary-блок ----------------------------------------------------------


def test_summary_stale_superseded_after_child_amend(global_op, org_dt):
    """Ребёнок пересдал под собранной сводкой → STALE + ось superseded."""
    parent, kids = _family(org_dt, children=1)
    child, _ = kids[0]
    _assemble(parent)
    _amend(child)

    detail = _get(global_op, division_id=parent.id).json()["detail"]
    summary = detail["summary"]
    assert summary["status"] == "STALE"
    assert summary["superseded"] == [
        {
            "division_id": str(child.id),
            "pinned_version": 1,
            "current_version": 2,
        }
    ]
    assert summary["missing"] == []
    assert summary["unpinned"] == []


def test_summary_fresh_with_actual_pins(global_op, org_dt):
    """Пины актуальны → FRESH с пустыми осями."""
    parent, _ = _family(org_dt, children=1)
    _assemble(parent)

    summary = _get(global_op, division_id=parent.id).json()["detail"]["summary"]
    assert summary["status"] == "FRESH"
    assert summary["superseded"] == []
    assert summary["missing"] == []
    assert summary["unpinned"] == []


def test_summary_missing_when_pinned_child_has_no_current(global_op, org_dt):
    """У запиненного ребёнка не осталось current («ноль текущих») → ось missing."""
    parent, kids = _family(org_dt, children=1)
    child, child_sub = kids[0]
    _assemble(parent)
    # Сим отзыва §82.1 ORM-сбросом (канон test_summary_service) — сам отзыв
    # вне скоупа: блок лишь ЧИТАЕТ этот класс.
    DailySubmission.objects.filter(pk=child_sub.pk).update(is_current=False)

    summary = _get(global_op, division_id=parent.id).json()["detail"]["summary"]
    assert summary["status"] == "STALE"
    assert summary["missing"] == [{"division_id": str(child.id), "pinned_version": 1}]
    assert summary["superseded"] == []


def test_summary_null_on_plain_submission(global_op, org_dt):
    """Обычная сдача листа (current без sources) → detail.summary == null."""
    division = make_division(org_dt)
    make_employee(division)
    _submit(division)

    detail = _get(global_op, division_id=division.id).json()["detail"]
    assert detail["summary"] is None
    # И после amendment обычной сдачи сводкой она не становится.
    _amend(division)
    detail = _get(global_op, division_id=division.id).json()["detail"]
    assert detail["summary"] is None
    assert detail["amendment"] is not None


# -- AC-3: NFR-пин ---------------------------------------------------------------


def test_detail_query_count_invariant_to_children(global_op, org_dt):
    """Detail-режим по сводке: SQL-константа на 1 и 4 детях (freshness — один
    вызов сервиса, никаких per-child/per-version запросов из view)."""
    parent1, _ = _family(org_dt, children=1)
    _assemble(parent1)
    parent4, _ = _family(org_dt, children=4)
    _assemble(parent4)
    # Прогрев (кэши подключений/contenttypes) — вне капчура.
    assert _get(global_op, division_id=parent1.id).status_code == 200
    assert _get(global_op, division_id=parent4.id).status_code == 200

    with CaptureQueriesContext(connection) as ctx_small:
        _get(global_op, division_id=parent1.id)
    with CaptureQueriesContext(connection) as ctx_big:
        _get(global_op, division_id=parent4.id)
    assert len(ctx_small) == len(ctx_big), (
        f"N+1: {len(ctx_small)} queries for 1 child vs {len(ctx_big)} for 4"
    )
