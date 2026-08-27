"""Роль наряда у назначения расстановки (Plane №238, шаг 2 плана №217).

ЗАЧЕМ ЭТО ЕСТЬ. В бланке «Общая расстановка» 1027 мест под людей, и каждое
названо ролью: «Кортежге жауапты», «VIP жүргізушісі», «S1 жүргізушісі». Без
роли у назначения документ заполняется порядком следования, то есть наугад —
водителем VIP становится человек с поста оцепления, и проверить это некому:
бланк на казахском (находка №195, решение заказчика — вариант «б»).

Что стерегут пробы:

1. РОЛЬ ДОЕЗЖАЕТ до строки представления — иначе бланку её взять неоткуда.
2. РОЛЬ ПРОВЕРЯЕТСЯ ПО СПРАВОЧНИКУ: строка «как пришла» означала бы, что
   «водитель VIP» и «водитель ВИП» — разные роли, и бланк снова заполняется
   наугад.
3. СНЯТАЯ РОЛЬ — тоже отказ: её убрали из справочника сознательно.
4. БЕЗ РОЛИ НАЗНАЧАТЬ МОЖНО: расстановка без ролей не ошибка, а «ещё не
   назначено». Старые строки, заведённые до этой правки, остаются законными.
"""
import pytest

from organization_management.apps.operations.models import OpsDictionaryEntry

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def roles():
    OpsDictionaryEntry.objects.create(
        dictionary_code="PLACEMENT_ROLES", code="DRIVER_VIP",
        label="Водитель VIP (VIP жүргізушісі)", is_active=True,
    )
    OpsDictionaryEntry.objects.create(
        dictionary_code="PLACEMENT_ROLES", code="RETIRED_ROLE",
        label="Снятая роль", is_active=False,
    )


def prepared(manager):  # noqa: F811
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    return base, data["reconSectorPosts"][0]["id"]


def test_role_reaches_the_assignment_row(manager, roles):  # noqa: F811
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Абенов")

    response = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk), "roleCode": "DRIVER_VIP"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    rows = response.json()["placementAssignments"]
    assert [row["roleCode"] for row in rows] == ["DRIVER_VIP"]


def test_an_unknown_role_is_refused(manager, roles):  # noqa: F811
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Оспанов")

    response = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk), "roleCode": "водитель ВИП"},
        format="json",
    )

    assert response.status_code == 400, response.json()
    assert "roleCode" in str(response.json())


def test_a_retired_role_is_refused(manager, roles):  # noqa: F811
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Токтаров")

    response = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk), "roleCode": "RETIRED_ROLE"},
        format="json",
    )

    assert response.status_code == 400, response.json()


def test_assignment_without_a_role_stays_legal(manager, roles):  # noqa: F811
    """Расстановка без ролей — «ещё не назначено», а не ошибка."""
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Сериков")

    response = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["placementAssignments"][0]["roleCode"] is None


def test_replacement_inherits_the_role(manager, roles):  # noqa: F811
    """Замена меняет ЧЕЛОВЕКА, а не место в бланке (Plane №239).

    🔴 Замену делают в день мероприятия — ровно тогда, когда документ уже
    печатают. Потеряй роль здесь, и место «водитель VIP» окажется пустым
    именно в тот момент, когда оно нужнее всего.

    Стадия выставляется В БАЗЕ, а не проходом всей цепочки (расстановка →
    согласование → ознакомление → проведение): цепочку стерегут свои пробы, и
    повторять её здесь значило бы проверять её же ещё раз, а не наследование
    роли.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, post_id = prepared(manager)
    outgoing = make_employee(last_name="Байжанов")
    incoming = make_employee(last_name="Кусаинов")
    assigned = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(outgoing.pk), "roleCode": "DRIVER_VIP"},
        format="json",
    ).json()
    assignment_id = assigned["placementAssignments"][0]["id"]
    OpsSecurityEvent.objects.filter(pk=assigned["id"]).update(stage="CONDUCT")

    response = manager.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": assignment_id,
            "incomingEmployeeId": str(incoming.pk),
            "reasonCode": "ILLNESS",
        },
        format="json",
    )

    assert response.status_code == 200, response.json()
    rows = response.json()["placementAssignments"]
    assert [row["employeeName"].split()[0] for row in rows] == ["Кусаинов"]
    assert rows[0]["roleCode"] == "DRIVER_VIP", "замена потеряла роль наряда"
