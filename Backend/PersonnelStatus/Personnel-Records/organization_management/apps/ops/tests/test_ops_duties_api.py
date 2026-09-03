"""Срез C1: /api/ops/duty-*/ — план дежурств.

Правила и производные (конфликты, action policy, отпечаток плана) — порт
чистой модели клиента (entities/duty-shift) и мок-слоя (duties-handlers.ts).
Сквозной тест месячного плана: черновик → проверка → утверждение → замок →
новая редакция; отпечаток обязан протухать при изменении состава месяца.
"""
import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy,
    OpsDutyType,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    make_employee,
    make_object,
)

pytestmark = pytest.mark.django_db

SHIFTS = "/api/ops/duty-shifts/"
PLAN = "/api/ops/duty-monthly-plan/"


@pytest.fixture(autouse=True)
def duty_registry(db):
    OpsDutyType.objects.create(
        duty_type_code="DAY_OBJECT",
        safe_label="Суточное дежурство на объекте",
        target_type="PROTECTED_OBJECT",
        default_duration_minutes=1440,
        requires_senior=True,
        rest_after_minutes=1440,
        requires_current_passport=True,
    )
    OpsDutyType.objects.create(
        duty_type_code="DAY_OWN",
        safe_label="Дежурство по управлению",
        target_type="OWN_OBJECT",
        default_duration_minutes=1440,
        requires_senior=False,
        rest_after_minutes=720,
        requires_current_passport=False,
    )
    OpsDutyConflictPolicy.objects.create(
        singleton_key=1, version="cp-v1", rest_after_duty_mode="SOFT_OVERRIDE"
    )


@pytest.fixture
def planner():
    api, _ = client_for(
        "duty-planner", "DUTY_PLANNER",
        perms=("duty.view", "duty.manage", "duty.approve_plan"),
    )
    return api


@pytest.fixture
def viewer():
    api, _ = client_for("duty-viewer", "DUTY_VIEWER", perms=("duty.view",))
    return api


def create_shift(api, obj, employee, date, type_code="DAY_OWN", **extra):
    body = {
        "businessDate": date,
        "dutyTypeCode": type_code,
        "objectId": str(obj.pk),
        "sectorId": extra.pop("sectorId", None),
        "postId": extra.pop("postId", None),
        "employeeId": str(employee.pk),
        "note": extra.pop("note", None),
    }
    body.update(extra)
    return api.post(SHIFTS, body, format="json")


def test_duty_types_with_policy(viewer):
    data = viewer.get("/api/ops/duty-types/").json()
    assert [t["dutyTypeCode"] for t in data["results"]] == [
        "DAY_OBJECT", "DAY_OWN",
    ]
    assert data["conflictPolicy"] == {
        "restAfterDutyMode": "SOFT_OVERRIDE",
        "conflictPolicyVersion": "cp-v1",
    }


def test_create_shift_binds_passport_and_audits(planner):
    obj = make_object(with_passport=True)
    employee = make_employee()
    objects = planner.get(
        "/api/ops/duty-plan-objects/", {"date": "2026-08-15"}
    ).json()["results"]
    option = next(o for o in objects if o["objectId"] == str(obj.pk))
    assert option["blockReason"] is None
    sector = option["sectors"][0]
    resp = create_shift(
        planner, obj, employee, "2026-08-15",
        type_code="DAY_OBJECT",
        sectorId=sector["sectorId"], postId=sector["posts"][0]["postId"],
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["stateCode"] == "PLANNED"
    assert data["passportBinding"]["postName"] == "Пост 1"
    assert data["employeeName"] == "Абенов С."
    row = OpsAuditLog.objects.get(action="DUTY_SHIFT_CREATED")
    assert row.entity_type == "duty_shift"


def test_passport_required_type_rejects_without_version(planner):
    obj = make_object()  # без публикаций
    employee = make_employee()
    resp = create_shift(planner, obj, employee, "2026-08-15", type_code="DAY_OBJECT")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "PASSPORT_REQUIRED"


def test_same_day_overlap_is_hard(planner):
    obj = make_object()
    employee = make_employee()
    assert create_shift(planner, obj, employee, "2026-08-15").status_code == 201
    resp = create_shift(planner, obj, employee, "2026-08-15")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "DUTY_OVERLAP"


def test_rest_conflict_soft_409_then_override(planner):
    obj = make_object()
    employee = make_employee()
    # DAY_OWN: отдых 720 мин; следующая смена НА СЛЕДУЮЩИЙ день — 0 свободных
    # минут между днями → конфликт отдыха
    assert create_shift(planner, obj, employee, "2026-08-15").status_code == 201
    resp = create_shift(planner, obj, employee, "2026-08-16")
    assert resp.status_code == 409
    payload = resp.json()
    assert payload["error_code"] == "DUTY_CONFLICT_DETECTED"
    assert payload["overridable"] is True
    assert payload["details"]["conflicts"][0]["conflict_code"] == (
        "REST_AFTER_DUTY"
    )
    resp = create_shift(
        planner, obj, employee, "2026-08-16",
        override=True, override_reason="усиление по приказу",
    )
    assert resp.status_code == 201
    assert resp.json()["overrideReason"] == "усиление по приказу"


def test_rest_conflict_hard_mode_blocks(planner):
    OpsDutyConflictPolicy.objects.filter(singleton_key=1).update(
        rest_after_duty_mode="HARD_BLOCK"
    )
    obj = make_object()
    employee = make_employee()
    assert create_shift(planner, obj, employee, "2026-08-15").status_code == 201
    # обход причиной не помогает: HARD не обходится
    resp = create_shift(
        planner, obj, employee, "2026-08-16",
        override=True, override_reason="не поможет",
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "REST_AFTER_DUTY"


def test_shift_execution_cycle_and_cancel_guard(planner):
    obj = make_object()
    employee = make_employee()
    shift_id = create_shift(planner, obj, employee, "2026-08-15").json()["id"]
    base = f"{SHIFTS}{shift_id}/"
    data = planner.post(f"{base}acknowledge/").json()
    assert data["stateCode"] == "ACKNOWLEDGED"
    assert data["acknowledgedAt"] is not None
    data = planner.post(f"{base}clock-in/").json()
    assert data["stateCode"] == "ACTIVE"
    data = planner.post(f"{base}clock-out/").json()
    assert (data["stateCode"], data["actualEnd"] is None) == ("COMPLETED", False)
    # завершённую не отменить
    resp = planner.post(f"{base}cancel/", {"reason": "поздно"}, format="json")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"


def test_cancelled_shift_frees_the_day(planner):
    obj = make_object()
    employee = make_employee()
    shift_id = create_shift(planner, obj, employee, "2026-08-15").json()["id"]
    data = planner.post(
        f"{SHIFTS}{shift_id}/cancel/", {"reason": "приказ отменён"},
        format="json",
    ).json()
    assert data["stateCode"] == "CANCELLED"
    assert data["cancellation"]["reason"] == "приказ отменён"
    # отменённая не занимает день — новая смена на ту же дату проходит
    assert create_shift(planner, obj, employee, "2026-08-15").status_code == 201


def test_monthly_plan_full_cycle_with_stale_fingerprint(planner):
    obj = make_object()
    first = make_employee()
    second = make_employee(last_name="Оспанова", first_name="Айгуль")
    assert create_shift(planner, obj, first, "2026-09-10").status_code == 201

    # черновик; повторный — 422
    assert planner.post(PLAN + "draft/", {"month": "2026-09"}, format="json").status_code == 201
    resp = planner.post(PLAN + "draft/", {"month": "2026-09"}, format="json")
    assert resp.json()["error_code"] == "PLAN_ALREADY_EXISTS"

    # без проверки утверждение недоступно
    resp = planner.post(PLAN + "approve/", {"month": "2026-09"}, format="json")
    assert resp.json()["error_code"] == "PLAN_NOT_APPROVABLE"

    data = planner.post(PLAN + "check/", {"month": "2026-09"}, format="json").json()
    assert data["lastValidation"]["passed"] is True

    # состав месяца изменился ПОСЛЕ проверки — отпечаток протух
    assert create_shift(planner, obj, second, "2026-09-11").status_code == 201
    resp = planner.post(PLAN + "approve/", {"month": "2026-09"}, format="json")
    assert resp.json()["error_code"] == "PLAN_NOT_APPROVABLE"
    envelope = planner.get(PLAN, {"month": "2026-09"}).json()
    approve_action = next(
        a for a in envelope["actions"] if a["code"] == "APPROVE"
    )
    assert approve_action["enabled"] is False
    assert "менялся после последней проверки" in approve_action["reason"]

    # свежая проверка → утверждение → замок планирующих мутаций
    planner.post(PLAN + "check/", {"month": "2026-09"}, format="json")
    data = planner.post(PLAN + "approve/", {"month": "2026-09"}, format="json").json()
    assert data["stateCode"] == "APPROVED"
    resp = create_shift(planner, obj, first, "2026-09-20")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "PLAN_APPROVED_LOCKED"

    # новая редакция снимает замок и поднимает revision
    data = planner.post(PLAN + "reopen/", {"month": "2026-09"}, format="json").json()
    assert (data["stateCode"], data["revision"]) == ("DRAFT", 2)
    assert [h["event"] for h in data["history"]] == [
        "DRAFT_CREATED", "VALIDATED", "VALIDATED", "APPROVED", "REOPENED",
    ]
    assert create_shift(planner, obj, first, "2026-09-20").status_code == 201


def test_hard_conflict_fails_validation(planner):
    obj = make_object()
    employee = make_employee()
    # два дежурства одного сотрудника в один день руками через модель нельзя
    # (create отобьёт) — конфликт создаём последовательными днями в HARD-режиме
    OpsDutyConflictPolicy.objects.filter(singleton_key=1).update(
        rest_after_duty_mode="HARD_BLOCK"
    )
    assert create_shift(planner, obj, employee, "2026-09-10").status_code == 201
    # вторая смена другого сотрудника — чтобы месяц был не пуст
    other = make_employee(last_name="Есимов", first_name="Болат")
    assert create_shift(planner, obj, other, "2026-09-11").status_code == 201
    # конфликт вносим напрямую: смена въезжает в отдых существующей
    from organization_management.apps.operations.models_duty import OpsDutyShift

    template = OpsDutyShift.objects.get(employee_name="Абенов С.")
    OpsDutyShift.objects.create(
        business_date="2026-09-11",
        duty_type_code="DAY_OWN",
        target=template.target,
        employee_name=template.employee_name,
        employee_id=template.employee_id,
        state_code="PLANNED",
        passport_binding=None,
        note=None,
        cancellation=None,
        override_reason=None,
    )
    planner.post(PLAN + "draft/", {"month": "2026-09"}, format="json")
    data = planner.post(PLAN + "check/", {"month": "2026-09"}, format="json").json()
    assert data["lastValidation"]["passed"] is False
    assert data["lastValidation"]["hardConflicts"] >= 1
    resp = planner.post(PLAN + "approve/", {"month": "2026-09"}, format="json")
    assert resp.json()["error_code"] == "PLAN_NOT_APPROVABLE"


def test_actions_reflect_missing_rights(viewer):
    envelope = viewer.get(PLAN, {"month": "2026-09"}).json()
    by_code = {a["code"]: a for a in envelope["actions"]}
    assert by_code["CREATE_DRAFT"]["enabled"] is False
    assert "ops.duty.manage" in by_code["CREATE_DRAFT"]["reason"]
    assert "ops.duty.approve_plan" in by_code["APPROVE"]["reason"]


def test_candidates_show_busy_flag(planner):
    obj = make_object()
    employee = make_employee()
    assert create_shift(planner, obj, employee, "2026-08-15").status_code == 201
    data = planner.get(
        "/api/ops/duty-candidates/", {"date": "2026-08-15"}
    ).json()
    row = next(
        r for r in data["results"] if r["employeeId"] == str(employee.pk)
    )
    assert row["busyOnRequestedDate"] is True
    assert row["nearestDutyDate"] == "2026-08-15"


def test_shift_detail_carries_day_conflicts(planner):
    obj = make_object()
    employee = make_employee()
    first = create_shift(planner, obj, employee, "2026-08-15").json()["id"]
    planner.post(
        f"{SHIFTS}{first}/cancel/", {"reason": "перенос"}, format="json"
    )
    second = create_shift(planner, obj, employee, "2026-08-15").json()["id"]
    detail = planner.get(f"{SHIFTS}{second}/").json()
    assert detail["shift"]["id"] == second
    assert detail["dutyType"]["dutyTypeCode"] == "DAY_OWN"
    assert detail["conflicts"] == []  # отменённая не считается
    assert detail["conflictPolicy"]["conflictPolicyVersion"] == "cp-v1"


def test_mutations_require_manage(viewer):
    resp = viewer.post(PLAN + "draft/", {"month": "2026-09"}, format="json")
    assert resp.status_code == 403
    resp = viewer.post(SHIFTS, {}, format="json")
    assert resp.status_code == 403


# ── «Мои смены»: самообслуживание без права на чужие (Plane №381) ────────────


def test_mine_returns_own_shifts_without_duty_view(planner):
    """Рядовой сотрудник читает СВОИ смены, не имея `duty.view`.

    Красная проба к №381: до неё «Мой календарь» ходил за реестром целиком,
    а реестр отвечает такому человеку 403 — смены не показывались никогда.
    """
    obj = make_object()
    mine_employee = make_employee(last_name="Своев")
    other_employee = make_employee(last_name="Чужов")
    assert create_shift(planner, obj, mine_employee, "2026-08-15").status_code == 201
    assert create_shift(planner, obj, other_employee, "2026-08-16").status_code == 201

    api, user = client_for("duty-self")  # ни одной роли, ни одного права
    mine_employee.user = user
    mine_employee.save(update_fields=["user"])

    # Реестр целиком ему по-прежнему закрыт — право на чужие смены не выдано.
    assert api.get(SHIFTS).status_code == 403

    resp = api.get(SHIFTS + "mine/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["unlinkedReason"] is None
    assert [row["businessDate"] for row in body["results"]] == ["2026-08-15"]
    assert body["results"][0]["employeeId"] == str(mine_employee.pk)


def test_mine_without_employee_link_answers_reason(planner):
    """Учётка без кадровой привязки — 200 с причиной, а не 403 и не 404."""
    api, _ = client_for("duty-unlinked")
    resp = api.get(SHIFTS + "mine/")
    assert resp.status_code == 200
    assert resp.json()["results"] == []
    assert "не связана с кадровой" in resp.json()["unlinkedReason"]


def test_mine_open_to_duty_view_holder(viewer):
    """Держатель `duty.view` ручку не теряет: у него та же ручка о себе."""
    resp = viewer.get(SHIFTS + "mine/")
    assert resp.status_code == 200
    assert resp.json()["results"] == []
