"""Секция бланка у назначения расстановки (Plane №242, Ш-3).

Вторая координата места: роль отвечает «кем человек идёт», секция — «где».
«Көшпелі күзетінің жауаптысы» есть у восьми выездных охран подряд, и одной
роли документу мало — он ставил первого назначенного в первую охрану наугад.

Пробы держат ровно то, что отличает эту правку от «просто ещё одно поле»:
секция валидируется справочником (строкой «как пришло» две записи одного
раздела стали бы разными секциями), снятая секция отбита, ПУСТО — законное
состояние, и секция НАСЛЕДУЕТСЯ при замене человека, иначе место в документе
опустеет ровно в день мероприятия, когда замену и делают.
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
SECTION = "ULAN_BATOR_KOSHPELI_KUZET"


@pytest.fixture
def sections():
    """Справочник заводится РУКАМИ, а не командой синхронизации.

    Команда читает настоящий шаблон, и проба зависела бы от образца заказчика:
    пересняли бланк — покраснела проверка валидации, к бланку отношения не
    имеющая. Состав шаблона стережёт своя проба (`test_placement_sections_dictionary`).
    """
    OpsDictionaryEntry.objects.create(
        dictionary_code="PLACEMENT_SECTIONS", code=SECTION,
        label="«Ұлан-батор» көшпелі күзет", is_active=True,
    )
    OpsDictionaryEntry.objects.create(
        dictionary_code="PLACEMENT_SECTIONS", code="RETIRED_SECTION",
        label="Снятая секция", is_active=False,
    )


def prepared(manager):  # noqa: F811
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    return base, data["reconSectorPosts"][0]["id"]


def test_section_reaches_the_assignment_row(manager, sections):  # noqa: F811
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Абенов")

    response = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(employee.pk),
            "sectionCode": SECTION,
        },
        format="json",
    )

    assert response.status_code == 200, response.json()
    rows = response.json()["placementAssignments"]
    assert [row["sectionCode"] for row in rows] == [SECTION]


def test_an_unknown_section_is_refused(manager, sections):  # noqa: F811
    """Строкой «как пришло» секцию хранить нельзя: «Ұлан-батор» и «Улан-Батор»
    стали бы разными разделами, и бланк снова заполнялся бы наугад."""
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Оспанов")

    response = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(employee.pk),
            "sectionCode": "Ұлан-батор",
        },
        format="json",
    )

    assert response.status_code == 400, response.json()
    assert "sectionCode" in str(response.json())


def test_a_retired_section_is_refused(manager, sections):  # noqa: F811
    """Снятую секцию убрали из справочника сознательно — тихо поставить её в
    новое назначение значило бы обойти это решение."""
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Токтаров")

    response = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(employee.pk),
            "sectionCode": "RETIRED_SECTION",
        },
        format="json",
    )

    assert response.status_code == 400, response.json()


def test_assignment_without_a_section_stays_legal(manager, sections):  # noqa: F811
    """Пусто — «ещё не назначено», а не ошибка.

    У расстановок, сделанных до №242, секции нет вовсе, и требовать её задним
    числом значило бы запретить правку старых мероприятий.
    """
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Сериков")

    response = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["placementAssignments"][0]["sectionCode"] is None


def test_role_and_section_live_side_by_side(manager, sections):  # noqa: F811
    """Две координаты, а не одна вместо другой: роль «кем», секция «где»."""
    OpsDictionaryEntry.objects.create(
        dictionary_code="PLACEMENT_ROLES", code="DRIVER_VIP",
        label="Водитель VIP", is_active=True,
    )
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Ахметова")

    response = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(employee.pk),
            "roleCode": "DRIVER_VIP",
            "sectionCode": SECTION,
        },
        format="json",
    )

    assert response.status_code == 200, response.json()
    row = response.json()["placementAssignments"][0]
    assert row["roleCode"] == "DRIVER_VIP"
    assert row["sectionCode"] == SECTION


def test_replacement_inherits_the_section(manager, sections):  # noqa: F811
    """Замена меняет ЧЕЛОВЕКА, а не место в бланке.

    Тот же довод, что у роли в №239, и та же цена ошибки: замену делают в день
    мероприятия, когда документ уже печатают. Потеряй секцию здесь — и место
    «Ұлан-батор» окажется пустым именно тогда, когда оно нужнее всего.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, post_id = prepared(manager)
    outgoing = make_employee(last_name="Байжанов")
    incoming = make_employee(last_name="Кусаинов")
    assigned = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(outgoing.pk),
            "sectionCode": SECTION,
        },
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
    assert rows[0]["sectionCode"] == SECTION, "замена потеряла секцию бланка"


def test_rows_made_before_the_field_read_as_empty(manager, sections):  # noqa: F811
    """Строка без ключа `sectionCode` читается как «секция не назначена».

    Бэкфилла у JSON-поля нет и быть не может: назначения лежат списком внутри
    мероприятия. Значит читатель обязан пережить отсутствие ключа — иначе
    экран старого мероприятия упал бы на первом же назначении.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, post_id = prepared(manager)
    employee = make_employee(last_name="Мукашев")
    assigned = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    ).json()
    event = OpsSecurityEvent.objects.get(pk=assigned["id"])
    legacy = dict(event.placement_assignments[0])
    legacy.pop("sectionCode")
    event.placement_assignments = [legacy]
    event.save(update_fields=["placement_assignments"])

    # Отдельной ручки списка назначений нет — они едут в карточке ОМ, как их
    # и читает экран расстановки.
    response = manager.get(base)

    assert response.status_code == 200, response.json()
    assert response.json()["placementAssignments"][0]["sectionCode"] is None
