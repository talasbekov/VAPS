"""Назначения сотрудника по роли в данных (Plane №403, `[ОЗН-09]`).

Сотрудник без единого права раздела читает СВОИ назначения и подтверждает
СВОЁ ознакомление; чужие — нет. Начальник читает подчинённого по области
`status.manage`, чужое подразделение — отказ. Без кадровой привязки —
пустой ответ с причиной, не 403.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

MINE = f"{URL}my-assignments/"


def placed(manager, employee):  # noqa: F811
    """ОМ с одним назначением сотрудника на пост из паспорта."""
    from organization_management.apps.operations.models_object import OpsSecurityObject

    obj = make_object(
        code=f"OBJ-{OpsSecurityObject.objects.count() + 1}", with_passport=True
    )
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    post_id = data["reconSectorPosts"][0]["id"]
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    return base, resp.json()["placementAssignments"][0]["id"]


def linked_client(username, employee, **grant):
    api, user = client_for(username, **grant)
    employee.user = user
    employee.save(update_fields=["user"])
    return api


def test_employee_reads_own_assignments_without_any_permission(manager):  # noqa: F811
    me = make_employee("Свой", "Сотрудник")
    other = make_employee("Чужой", "Сотрудник")
    base, assignment_id = placed(manager, me)
    placed(manager, other)
    api = linked_client("emp-own", me)

    resp = api.get(MINE)
    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["employeeId"] == str(me.pk)
    assert [r["assignmentId"] for r in body["results"]] == [assignment_id]
    row = body["results"][0]
    assert row["eventId"] == base.split("/")[-2]
    assert (row["sector"], row["post"], row["task"]) == (
        "Периметр", "Пост 1", "Охрана периметра"
    )
    assert row["acknowledgedAt"] is None

    # Чужие — нет: ни по параметру, ни реестром.
    assert api.get(f"{MINE}?employee={other.pk}").status_code == 403
    assert api.get(URL).status_code == 403


def test_unlinked_account_gets_a_reason_not_403():
    api, _ = client_for("nobody")
    resp = api.get(MINE)
    assert resp.status_code == 200
    assert resp.json()["results"] == []
    assert "не связана" in resp.json()["unlinkedReason"]


def test_chief_reads_subordinate_by_status_scope_and_not_a_stranger(manager):  # noqa: F811
    mine_div = Division.objects.create(
        name="Первое управление", division_type=Division.DivisionType.DIRECTORATE
    )
    foreign_div = Division.objects.create(
        name="Второе управление", division_type=Division.DivisionType.DIRECTORATE
    )
    subordinate = make_employee("Подчинённый", "Ф")
    stranger = make_employee("Посторонний", "Ф")
    StaffUnit.objects.create(division=mine_div, employee=subordinate, index=1)
    StaffUnit.objects.create(division=foreign_div, employee=stranger, index=1)
    _, sub_assignment = placed(manager, subordinate)
    placed(manager, stranger)
    chief, _ = client_for(
        "chief", "HEAD_DIRECTORATE", perms=("status.manage",),
        scope_division_id=mine_div.pk,
    )

    resp = chief.get(f"{MINE}?employee={subordinate.pk}")
    assert resp.status_code == 200, resp.data
    assert [r["assignmentId"] for r in resp.json()["results"]] == [sub_assignment]
    assert chief.get(f"{MINE}?employee={stranger.pk}").status_code == 403


def test_employee_acknowledges_own_assignment_but_not_a_colleagues(manager):  # noqa: F811
    me = make_employee("Свой", "С")
    colleague = make_employee("Коллега", "К")
    base, my_assignment = placed(manager, me)
    _, their_assignment = placed(manager, colleague)
    their_base = _
    api = linked_client("emp-ack", me)

    resp = api.post(f"{base}acknowledge/{my_assignment}/")
    assert resp.status_code == 200, resp.data
    assert resp.json()["placementAssignments"][0]["acknowledgedAt"] is not None
    assert api.get(MINE).json()["results"][0]["acknowledgedAt"] is not None

    assert api.post(f"{their_base}acknowledge/{their_assignment}/").status_code == 403
