"""QA-проход 5.11 — интеграция сводки с СОСЕДНИМИ поверхностями.

Dev-модуль (test_summary_service, 25 тестов) исчерпывает сервисный слой
assemble/freshness/rebuild. Здесь — судьи, которых нет НИГДЕ:

- **HTTP-каналы 5.8x поверх сводки.** Стори декларирует «текущие роуты сводку
  УЖЕ отдают как обычную DailySubmission — detail покажет ``sources``», но
  read-сьют 5.8c живёт в мире без сводок: JSONB→DRF-канал пинов, own-level
  roster в HTTP-проекции и цепочка «взамен» (старый pk → старые пины) не
  судились никем.
- **Ручной amend API поверх сводки** — HTTP-проекция Task 1 (Ловушка №2):
  оператор жмёт ``POST /{pk}/amend/`` на сдаче родителя, не зная что это
  сводка. Без переноса пинов сводка молча деградирует в обычную сдачу
  (``summary_freshness`` → None). Dev судит перенос только hook-путём (5.4b)
  на сервисном слое.
- **Светофор 5.5a поверх сводки** — Ловушка №7: сводка «сдана» → не RED;
  протухание пинов — ОТДЕЛЬНАЯ ось видимости, светофор не красит; own-drift
  на сводке даёт YELLOW (``_snapshot_winners`` реально несёт own-rows сводки).
- **Конверсионный гард**: assemble поверх обычной own-сдачи родителя → 409
  (Д10: конверсия сдача↔сводка вне скоупа — гейт обязан не пустить молча).

Мир — свои копии фикстур (канон сьютов: общий conftest не заводим); HTTP-
обвязка — канон 5.8b/c (seed_operations + DIVISION_OPERATOR unscoped +
HTTP_X_USER_ID); байт-ассерты — канон Д3 5.10 (sort_keys + ensure_ascii=False).
"""

import itertools
import json
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import amend_day, submit_day
from apps.operations.submissions.services.summary_service import (
    FRESH,
    STALE,
    assemble_summary,
    rebuild_summary,
    summary_freshness,
)
from apps.operations.submissions.traffic_light import (
    TrafficLightStatus,
    division_traffic_light,
)

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 16)
ACTOR = "op-sqa"
_iin = itertools.count(760_000)
_code = itertools.count(1)


def _day(offset):
    return TODAY + timedelta(days=offset)


def _canon(value):
    """Канон байт-формы 5.10 (Д3): одна форма для всех байт-ассертов."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-SQA")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt, parent=None):
    org, dt = org_dt
    c = f"SQA-{next(_code)}"
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


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


@pytest.fixture
def api_op(db):
    """HTTP-обвязка канона 5.8b/c: роли из seed + unscoped DIVISION_OPERATOR
    (держит и mark_update — чтение, и correct — amend)."""
    call_command("seed_operations")
    UserRole.objects.create(
        user_id=ACTOR, role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return ACTOR


def _client(actor=ACTOR):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _detail(pk):
    return _client().get(reverse("ops-daily-submission-detail", kwargs={"pk": str(pk)}))


def _post_amend(pk, reason="уточнение состава", sanction="замечание"):
    return _client().post(
        reverse("ops-daily-submission-amend", kwargs={"pk": str(pk)}),
        {"reason": reason, "sanction": sanction},
        format="json",
    )


def _submit(division):
    return submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)


def _assemble(division):
    return assemble_summary(division_id=division.id, business_date=TODAY, actor=ACTOR)


def _family(org_dt, children=1):
    """Родитель со own-штабом (+ статус — own-rows непусты) и детьми со сдачей."""
    parent = make_division(org_dt)
    own = make_employee(parent)
    make_status(own, "DUTY", _day(-3), _day(3))
    kids = []
    for _ in range(children):
        child = make_division(org_dt, parent=parent)
        make_employee(child)
        kids.append((child, _submit(child)))
    return parent, own, kids


# --- HTTP-ось: detail отдаёт сводку с пинами (Д1 5.8c: единственный канал) ----


def test_detail_serves_summary_sources_and_own_level_roster(api_op, org_dt):
    parent, own, kids = _family(org_dt, children=2)
    summary = _assemble(parent)

    resp = _detail(summary.pk)
    assert resp.status_code == 200

    # Пины пережили JSONB→DRF канал: независимое ожидание из мира, не из БД.
    expected = sorted(
        (
            {"division_id": str(child.id), "submission_id": sub.pk, "version": 1}
            for child, sub in kids
        ),
        key=lambda pin: pin["division_id"],
    )
    assert resp.data["snapshot"]["sources"] == expected

    # HTTP-проекция Ловушки №1: roster сводки own-level — люди детей не едут.
    assert [r["employee_id"] for r in resp.data["snapshot"]["roster"]] == [str(own.id)]

    # Канал верен байт-в-байт хранимому снапшоту (JSONB round-trip fidelity).
    stored = DailySubmissionSelector.by_id(summary.pk).snapshot
    assert _canon(resp.data["snapshot"]) == _canon(stored)


# --- HTTP-ось: ручной amend поверх сводки — проекция Task 1 (Ловушка №2) ------


def test_manual_amend_api_on_summary_keeps_pins_verbatim(api_op, org_dt):
    parent, own, _ = _family(org_dt)
    summary = _assemble(parent)
    v1 = DailySubmissionSelector.by_id(summary.pk)
    v1_pins = _canon(v1.snapshot["sources"])
    v1_rows = _canon(v1.snapshot["rows"])
    assert v1.snapshot["sources"]  # sanity: перенос не вакуумен

    # Own-мир реально меняется ПОСЛЕ сборки — иначе «свежий срез» неотличим
    # от копии v1 и тест не докажет, что позитивная ветка пересъёма исполнялась.
    make_status(own, "SICK_LEAVE", _day(-1), _day(1))

    resp = _post_amend(summary.pk)
    assert resp.status_code == 201
    assert resp.data["version"] == 2

    v2 = _detail(resp.data["id"])
    assert v2.status_code == 200
    # Пины VERBATIM (Task 1): без переноса сводка молча деградировала бы.
    assert _canon(v2.data["snapshot"]["sources"]) == v1_pins
    # Own-срез при этом ПЕРЕСНЯТ (не копия v1) — невакуумность.
    assert _canon(v2.data["snapshot"]["rows"]) != v1_rows

    # Свежесть жива (не None — сводка осталась сводкой) и FRESH: ручной amend
    # не пере-пиновывает и не протухает сводку сам по себе.
    freshness = summary_freshness(parent.id, TODAY)
    assert freshness is not None
    assert freshness.status == FRESH


# --- HTTP-ось: цепочка «взамен» после rebuild — потребитель 10.6 --------------


def test_detail_serves_rebuild_chain_old_pk_old_pins(api_op, org_dt):
    parent, _, kids = _family(org_dt)
    child, _ = kids[0]
    summary = _assemble(parent)
    amend_day(
        division_id=child.id,
        business_date=TODAY,
        actor=ACTOR,
        reason="ретро-правка",
        sanction="указание",
    )
    rebuilt = rebuild_summary(
        division_id=parent.id,
        business_date=TODAY,
        actor=ACTOR,
        reason="уточнение снизу",
        sanction="приказ №1",
    )

    # Старый pk — точечное чтение вытесненной v1 со СТАРЫМИ пинами (5.8c Д1).
    old = _detail(summary.pk)
    assert old.status_code == 200
    assert old.data["version"] == 1
    assert old.data["is_current"] is False
    assert [p["version"] for p in old.data["snapshot"]["sources"]] == [1]

    # Новый pk — v2 AMENDED со СВЕЖИМИ пинами и amend-полями.
    new = _detail(rebuilt.pk)
    assert new.status_code == 200
    assert new.data["version"] == 2
    assert new.data["is_current"] is True
    assert new.data["event"] == "AMENDED"
    assert new.data["reason"] == "уточнение снизу"
    assert new.data["sanction"] == "приказ №1"
    assert [p["version"] for p in new.data["snapshot"]["sources"]] == [2]


# --- Светофор 5.5a поверх сводки (Ловушка №7): оси не смешиваются -------------


def test_traffic_light_over_summary_separate_axis_from_freshness(org_dt):
    parent, own, kids = _family(org_dt)
    child, _ = kids[0]
    _assemble(parent)

    # Сводка — current-строка: родитель НЕ RED; own-мир совпадает → GREEN.
    tl = division_traffic_light(parent.id, TODAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.drift is None

    # Ребёнок пересдал → пины протухли, но светофор родителя НЕ меняется:
    # свежесть пинов — отдельная ось видимости, не цвет светофора.
    amend_day(
        division_id=child.id,
        business_date=TODAY,
        actor=ACTOR,
        reason="ретро-правка",
        sanction="указание",
    )
    assert summary_freshness(parent.id, TODAY).status == STALE
    assert division_traffic_light(parent.id, TODAY).status == TrafficLightStatus.GREEN

    # Own-drift на сводке даёт YELLOW: _snapshot_winners реально derive-ит
    # own-rows снапшота сводки (additive-ключ sources не мешает).
    make_status(own, "SICK_LEAVE", _day(-1), _day(1))
    tl = division_traffic_light(parent.id, TODAY)
    assert tl.status == TrafficLightStatus.YELLOW
    assert tl.drift is not None


# --- Конверсионный гард: assemble поверх обычной own-сдачи родителя ----------


def test_assemble_over_regular_own_submission_409(org_dt):
    parent, _, _ = _family(org_dt)
    _submit(parent)  # обычная own-сдача родителя занимает (division, date)

    with pytest.raises(DomainError) as err:
        _assemble(parent)
    assert err.value.code == "DAY_ALREADY_SUBMITTED"
    assert err.value.http_status == 409
    # Конверсия сдача↔сводка вне скоупа (Д10): строк не прибавилось, head тот же.
    assert (
        DailySubmission.objects.filter(
            division_id=parent.id, business_date=TODAY
        ).count()
        == 1
    )
