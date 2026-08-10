"""Срез C2: /api/ops/combat-*/ — боевые группы на Трассе (§24).

Правила — порт мок-слоя (combat-handlers.ts) дословно. Сквозной тест ведёт
одну смену через весь процесс §24.1: потребность → подача → возврат →
повторная подача → принятие → индивидуальное ознакомление → заступление →
сдача смены → факт; замена участника до заступления сбрасывает его
ознакомление; DOUBLE_ASSIGNMENT держит дату и на подаче, и на замене.
"""
import pytest

from organization_management.apps.operations.models_combat import (
    OpsCombatDutyType,
    OpsCombatRoute,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

SHIFTS = "/api/ops/combat-duty-shifts/"


@pytest.fixture(autouse=True)
def registries(db):
    OpsCombatDutyType.objects.create(
        duty_type_code="COMBAT_GROUP_SINGLE_ROUTE",
        safe_label="Одна Трасса",
        supports_multiple_routes=False,
    )
    OpsCombatDutyType.objects.create(
        duty_type_code="COMBAT_GROUP_MULTI_ROUTE",
        safe_label="Несколько Трасс",
        supports_multiple_routes=True,
    )
    for code, label in [
        ("route-1", "Трасса №1"), ("route-2", "Трасса №2"),
    ]:
        OpsCombatRoute.objects.create(route_code=code, safe_label=label)


@pytest.fixture
def planner():
    api, _ = client_for(
        "combat-planner", "COMBAT_PLANNER", perms=("duty.view", "duty.manage")
    )
    return api


def create_shift(api, routes=("route-1",), type_code="COMBAT_GROUP_SINGLE_ROUTE",
                 date="2026-08-20", required=2):
    return api.post(
        SHIFTS,
        {
            "businessDate": date,
            "dutyTypeCode": type_code,
            "routeIds": list(routes),
            "coverageMode": "RESERVE",
            "requiredEmployees": required,
        },
        format="json",
    )


def submit(api, shift_id, leader="Байжанов С.", members=("Дюсенов М.",),
           reserve=()):
    return api.post(
        f"{SHIFTS}{shift_id}/submit/",
        {
            "groupLeaderEmployeeName": leader,
            "memberEmployeeNames": list(members),
            "reserveEmployeeNames": list(reserve),
        },
        format="json",
    )


def accept(api, shift_id):
    return api.post(
        f"{SHIFTS}{shift_id}/review/",
        {"decision": "ACCEPT", "returnReason": None},
        format="json",
    )


def test_registries(planner):
    types = planner.get("/api/ops/combat-duty-types/").json()["results"]
    assert [t["dutyTypeCode"] for t in types] == [
        "COMBAT_GROUP_MULTI_ROUTE", "COMBAT_GROUP_SINGLE_ROUTE",
    ]
    routes = planner.get("/api/ops/combat-routes/").json()["results"]
    assert routes[0] == {"routeId": "route-1", "safeLabel": "Трасса №1"}


def test_create_validations(planner):
    assert create_shift(planner, date="20.08.2026").json()["error_code"] == (
        "INVALID_BUSINESS_DATE"
    )
    assert create_shift(planner, routes=()).json()["error_code"] == (
        "EMPTY_ROUTE_SET"
    )
    assert create_shift(planner, required=0).json()["error_code"] == (
        "INVALID_REQUIREMENT"
    )
    assert create_shift(
        planner, routes=("route-1", "route-2")
    ).json()["error_code"] == "TOO_MANY_ROUTES"
    assert create_shift(planner, routes=("route-9",)).json()["error_code"] == (
        "UNKNOWN_ROUTE"
    )
    resp = create_shift(
        planner, routes=("route-1", "route-2"),
        type_code="COMBAT_GROUP_MULTI_ROUTE",
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["submission"] is None  # «Требует подачи»
    assert data["routeSet"]["safeLabel"] == "Трасса №1, Трасса №2"


def test_full_walkthrough(planner):
    shift_id = create_shift(planner).json()["id"]
    base = f"{SHIFTS}{shift_id}/"

    # пустая группа не подаётся
    resp = submit(planner, shift_id, leader=" ", members=())
    assert resp.json()["error_code"] == "EMPTY_GROUP"

    # подача → возврат с причиной → повторная подача легальна
    assert submit(planner, shift_id).json()["submission"]["stateCode"] == (
        "SUBMITTED"
    )
    resp = submit(planner, shift_id)
    assert resp.json()["error_code"] == "ALREADY_SUBMITTED"
    resp = planner.post(
        f"{base}review/", {"decision": "RETURN", "returnReason": ""},
        format="json",
    )
    assert resp.json()["error_code"] == "REASON_REQUIRED"
    data = planner.post(
        f"{base}review/",
        {"decision": "RETURN", "returnReason": "усилить состав"},
        format="json",
    ).json()
    assert data["submission"]["stateCode"] == "RETURNED"
    assert data["submission"]["returnReason"] == "усилить состав"
    data = submit(
        planner, shift_id, members=("Дюсенов М.", "Кенжебаев А.")
    ).json()
    assert data["submission"]["stateCode"] == "SUBMITTED"

    # принятие открывает ознакомление
    data = accept(planner, shift_id).json()
    execution = data["submission"]["execution"]
    assert execution["stateCode"] == "PENDING_ACKNOWLEDGEMENT"

    # ознакомление: чужой — отказ; резервный не входит; каждый по одному разу
    resp = planner.post(
        f"{base}acknowledge/", {"employeeName": "Посторонний"}, format="json"
    )
    assert resp.json()["error_code"] == "NOT_IN_ROSTER"
    for name in ("Байжанов С.", "Дюсенов М."):
        planner.post(f"{base}acknowledge/", {"employeeName": name}, format="json")
    resp = planner.post(
        f"{base}acknowledge/", {"employeeName": "Байжанов С."}, format="json"
    )
    assert resp.json()["error_code"] == "ALREADY_ACKNOWLEDGED"
    # заступить рано: ознакомились не все
    resp = planner.post(f"{base}check-in/")
    assert resp.json()["error_code"] == "INVALID_STATE_TRANSITION"
    data = planner.post(
        f"{base}acknowledge/", {"employeeName": "Кенжебаев А."}, format="json"
    ).json()
    assert data["submission"]["execution"]["stateCode"] == "READY"

    # заступление; завершение без сдачи смены — отказ
    data = planner.post(f"{base}check-in/").json()
    assert data["submission"]["execution"]["stateCode"] == "ACTIVE"
    resp = planner.post(
        f"{base}complete/", {"actualMemberNames": []}, format="json"
    )
    assert resp.json()["error_code"] == "MISSING_HANDOVER"

    # сдача смены: только участник состава
    resp = planner.post(
        f"{base}handover/",
        {"unresolvedIncidents": "", "remarks": "", "confirmedByEmployeeName": "Чужак"},
        format="json",
    )
    assert resp.json()["error_code"] == "NOT_IN_ROSTER"
    data = planner.post(
        f"{base}handover/",
        {
            "unresolvedIncidents": "",
            "remarks": "без происшествий",
            "confirmedByEmployeeName": "Байжанов С.",
        },
        format="json",
    ).json()
    assert data["submission"]["execution"]["handover"]["remarks"] == (
        "без происшествий"
    )

    # факт: фактический состав задаётся отдельно (§24.23)
    data = planner.post(
        f"{base}complete/",
        {"actualMemberNames": ["Байжанов С.", "Дюсенов М."]},
        format="json",
    ).json()
    execution = data["submission"]["execution"]
    assert execution["stateCode"] == "COMPLETED"
    assert execution["actualMemberNames"] == ["Байжанов С.", "Дюсенов М."]
    assert execution["actualEnd"] is not None


def test_double_assignment_on_submit(planner):
    first = create_shift(planner).json()["id"]
    submit(planner, first)
    accept(planner, first)
    second = create_shift(planner).json()["id"]
    resp = submit(planner, second, leader="Дюсенов М.", members=("Рахимов Т.",))
    assert resp.json()["error_code"] == "DOUBLE_ASSIGNMENT"
    # другая дата — не конфликт
    third = create_shift(planner, date="2026-08-21").json()["id"]
    assert submit(
        planner, third, leader="Дюсенов М.", members=("Рахимов Т.",)
    ).status_code == 200


def test_replace_resets_acknowledgement_and_guards_date(planner):
    shift_id = create_shift(planner).json()["id"]
    submit(planner, shift_id)
    accept(planner, shift_id)
    base = f"{SHIFTS}{shift_id}/"
    planner.post(
        f"{base}acknowledge/", {"employeeName": "Байжанов С."}, format="json"
    )
    planner.post(
        f"{base}acknowledge/", {"employeeName": "Дюсенов М."}, format="json"
    )
    # состав READY; замена участника возвращает PENDING и сбрасывает его отметку
    data = planner.post(
        f"{base}replace/",
        {
            "outgoingEmployeeName": "Дюсенов М.",
            "incomingEmployeeName": "Рахимов Т.",
            "reasonCode": "болезнь",
            "safeComment": None,
        },
        format="json",
    ).json()
    submission = data["submission"]
    assert submission["memberEmployeeNames"] == ["Рахимов Т."]
    execution = submission["execution"]
    assert execution["stateCode"] == "PENDING_ACKNOWLEDGEMENT"
    assert execution["acknowledgedMemberNames"] == ["Байжанов С."]
    assert submission["replacements"][0]["reasonCode"] == "болезнь"

    # заменяющий, принятый в другую группу на эту дату, — отказ
    other = create_shift(planner).json()["id"]
    submit(planner, other, leader="Сарсенов Б.", members=("Тастанова Г.",))
    accept(planner, other)
    resp = planner.post(
        f"{base}replace/",
        {
            "outgoingEmployeeName": "Рахимов Т.",
            "incomingEmployeeName": "Сарсенов Б.",
            "reasonCode": "усиление",
            "safeComment": None,
        },
        format="json",
    )
    assert resp.json()["error_code"] == "DOUBLE_ASSIGNMENT"

    # после заступления замена невозможна
    planner.post(
        f"{base}acknowledge/", {"employeeName": "Рахимов Т."}, format="json"
    )
    planner.post(f"{base}check-in/")
    resp = planner.post(
        f"{base}replace/",
        {
            "outgoingEmployeeName": "Рахимов Т.",
            "incomingEmployeeName": "Кенжебаев А.",
            "reasonCode": "поздно",
            "safeComment": None,
        },
        format="json",
    )
    assert resp.json()["error_code"] == "INVALID_STATE_TRANSITION"


def test_candidates_from_live_employees(planner):
    from organization_management.apps.ops.tests.test_ops_security_events_api import (
        make_employee,
    )

    make_employee()
    data = planner.get("/api/ops/combat-roster-candidates/").json()
    assert {"employeeName": "Абенов С.", "unitName": ""} in data["results"]


def test_mutations_require_manage():
    viewer, _ = client_for("combat-viewer", "COMBAT_VIEWER", perms=("duty.view",))
    assert create_shift(viewer).status_code == 403
    assert viewer.get(SHIFTS).status_code == 200
