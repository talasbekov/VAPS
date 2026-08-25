"""Цепочка «Сбор сил на ОМ» (задача заказчика Plane №73).

Шаг «СС-1»: штаб получает с рекогносцировки ЧИСЛО и делит его между
департаментами. Здесь проверяется именно раскладка — адрес заявки, её сумма
и то, что правка не затирает уже начатую работу департамента.

Сквозной проход стадий лежит в `test_ops_security_events_api`; сюда вынесены
правила, которых он не показывает.
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"

# Дата, до которой статус привлечения ещё не начался: снять выделенного можно
# только до начала мероприятия, и пробы снятия обязаны стоять в будущем.
FUTURE_DATE = "2027-06-01"


def make_department(name="Департамент охраны"):
    return Division.objects.create(
        name=name, division_type=Division.DivisionType.DEPARTMENT
    )


def event_on_demand(manager, business_date="2026-08-10"):  # noqa: F811
    """ОМ, доведённое до «Потребности»: расчёт постов ушёл штабу числом.

    Дата по умолчанию прошлая (как у соседних проб жизненного цикла); шаги,
    которым нужен НЕ начавшийся статус привлечения, передают будущую.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, business_date=business_date).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    # Пост из паспорта просит одного человека — делить такую потребность
    # между департаментами бессмысленно, и проверки суммы прошли бы вакуумно.
    posts = [
        {**post, "need": 4} if index == 0 else post
        for index, post in enumerate(data["reconSectorPosts"])
    ]
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": posts,
        },
        format="json",
    )
    demand = manager.post(f"{base}recon/complete/").json()
    assert demand["stage"] == "DEMAND"
    # Сторож фикстуры: делить нечего, если расчёт постов пуст — тогда все
    # проверки суммы ниже прошли бы «сами собой».
    assert demand["forceDemandTotal"] > 1, "у фикстуры нет потребности — делить нечего"
    return base, demand["forceDemandTotal"]


def test_split_addresses_departments(manager):  # noqa: F811
    """Раскладка адресована: у строки есть департамент, имя и число."""
    base, total = event_on_demand(manager)
    department = make_department()

    data = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    ).json()

    assert len(data["forceAllocation"]) == 1
    row = data["forceAllocation"][0]
    assert row["departmentId"] == str(department.pk)
    assert row["departmentName"] == department.name
    assert (row["need"], row["status"]) == (1, "DRAFT")
    assert data["forceDemandTotal"] == total
    # Сохранённое читается обратно тем же: раскладка живёт в строке ОМ, а не
    # в ответе одной ручки.
    assert manager.get(base).json()["forceAllocation"] == data["forceAllocation"]


def test_split_refuses_more_than_demanded(manager):  # noqa: F811
    """Разложить больше, чем просили, нельзя — это ошибка ввода."""
    base, total = event_on_demand(manager)
    department = make_department()

    resp = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total + 1}]},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_OVER_DEMAND"
    assert str(total) in resp.json()["message"]
    # Недобор — не ошибка: штаб раскладывает в несколько заходов.
    ok = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total - 1}]},
        format="json",
    )
    assert ok.status_code == 200


def test_split_refuses_foreign_and_repeated_addresses(manager):  # noqa: F811
    """Адресат проверяется на сервере: не департамент и повтор — 400."""
    base, _ = event_on_demand(manager)
    department = make_department()
    directorate = Division.objects.create(
        name="Управление №1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )

    foreign = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(directorate.pk), "need": 1}]},
        format="json",
    )
    assert foreign.status_code == 400
    assert "rows.0.departmentId" in foreign.json()["details"]

    repeated = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(department.pk), "need": 1},
                {"departmentId": str(department.pk), "need": 1},
            ]
        },
        format="json",
    )
    assert repeated.status_code == 400
    assert "rows.1.departmentId" in repeated.json()["details"]


def test_split_keeps_started_department_state(manager):  # noqa: F811
    """Правка раскладки не затирает работу департамента и не снимает его.

    Департамент, которому заявка уже ушла, остаётся в раскладке: его
    управления оповещены, а люди, возможно, выделены.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, _ = event_on_demand(manager)
    first = make_department("Департамент охраны")
    second = make_department("Департамент сопровождения")
    manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first.pk), "need": 1},
                {"departmentId": str(second.pk), "need": 1},
            ]
        },
        format="json",
    )
    # Состояние, которое заведут следующие шаги цепочки (СС-2, СС-3), — здесь
    # ставится руками: своей ручки у него пока нет.
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    event.force_allocation = [
        {**row, "status": "NOTIFIED", "members": [{"employeeId": "1"}]}
        if row["departmentId"] == str(first.pk)
        else row
        for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation"])

    dropped = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(second.pk), "need": 2}]},
        format="json",
    )
    assert dropped.status_code == 422
    assert dropped.json()["error_code"] == "ALLOCATION_LOCKED"
    assert first.name in dropped.json()["message"]

    kept = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first.pk), "need": 2},
                {"departmentId": str(second.pk), "need": 1},
            ]
        },
        format="json",
    ).json()
    started = next(
        row
        for row in kept["forceAllocation"]
        if row["departmentId"] == str(first.pk)
    )
    assert (started["status"], started["need"]) == ("NOTIFIED", 2)
    assert started["members"] == [{"employeeId": "1"}]


def test_split_only_while_forces_are_gathered(manager):  # noqa: F811
    """До рекогносцировки делить нечего — стадия отбивает раскладку."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    department = make_department()

    resp = manager.post(
        f"{URL}{event_id}/forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"


# ── Шаг «СС-2»: оповещение управлений департамента ──────────────────────────


def make_directorate(department, name="Управление №1"):
    return Division.objects.create(
        name=name,
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )


def allocated_event(manager, department, business_date="2026-08-10"):  # noqa: F811
    """ОМ с сохранённой заявкой одному департаменту."""
    base, total = event_on_demand(manager, business_date)
    data = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total}]},
        format="json",
    ).json()
    return base, data["forceAllocation"][0]["id"]


def test_notify_reaches_every_directorate_of_the_department(manager):  # noqa: F811
    """Оповещение адресовано управлениям ИМЕННО этого департамента."""
    department = make_department()
    first = make_directorate(department, "Управление охраны")
    second = make_directorate(department, "Управление сопровождения")
    # Управление ЧУЖОГО департамента — контрольное: без него проба не отличила
    # бы «оповестили своих» от «оповестили всех подряд».
    other = make_department("Департамент связи")
    foreign = make_directorate(other, "Управление связи")
    base, allocation_id = allocated_event(manager, department)

    data = manager.post(
        f"{base}forces/allocation/{allocation_id}/notify/"
    ).json()

    row = data["forceAllocation"][0]
    assert row["status"] == "NOTIFIED"
    assert row["notifiedAt"] is not None
    names = {item["name"] for item in row["directorates"]}
    assert names == {first.name, second.name}
    assert foreign.name not in names
    assert all(item["notifiedAt"] is not None for item in row["directorates"])


def test_notify_keeps_the_moment_of_those_already_told(manager):  # noqa: F811
    """Повтор добирает неоповещённых, а сказанному раньше время не переписывает."""
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    first = manager.post(f"{base}forces/allocation/{allocation_id}/notify/").json()
    told_at = first["forceAllocation"][0]["directorates"][0]["notifiedAt"]

    # Управление появилось ПОСЛЕ первого оповещения — второе нажатие обязано
    # добрать его, не трогая момент у прежнего.
    make_directorate(department, "Управление сопровождения")
    second = manager.post(f"{base}forces/allocation/{allocation_id}/notify/").json()

    rows = {item["name"]: item for item in second["forceAllocation"][0]["directorates"]}
    assert len(rows) == 2
    assert rows["Управление охраны"]["notifiedAt"] == told_at
    assert rows["Управление сопровождения"]["notifiedAt"] is not None


def test_notify_refuses_department_without_directorates(manager):  # noqa: F811
    """Департамент без действующих управлений — отказ, а не тихий успех."""
    department = make_department()
    inactive = make_directorate(department, "Управление расформированное")
    inactive.is_active = False
    inactive.save(update_fields=["is_active"])
    base, allocation_id = allocated_event(manager, department)

    resp = manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_NO_DIRECTORATES"
    assert department.name in resp.json()["message"]


def test_notified_department_cannot_be_dropped_from_the_split(manager):  # noqa: F811
    """Замок раскладки включается именно оповещением, а не руками теста."""
    department = make_department()
    make_directorate(department)
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    resp = manager.post(f"{base}forces/allocation/", {"rows": []}, format="json")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_LOCKED"


def test_notify_is_recorded_in_the_audit_trail(manager):  # noqa: F811
    """«Нам не говорили» разбирается по журналу, а не по памяти дежурного."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    department = make_department()
    make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    before = OpsAuditLog.objects.filter(
        action="FORCE_ALLOCATION_NOTIFIED"
    ).count()

    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    entries = OpsAuditLog.objects.filter(action="FORCE_ALLOCATION_NOTIFIED")
    assert entries.count() == before + 1
    recorded = entries.order_by("-id").first()
    assert recorded.new_value["departmentName"] == department.name
    assert recorded.new_value["directorates"] == ["Управление охраны"]


def test_notify_unknown_allocation_is_404(manager):  # noqa: F811
    """Незнакомая заявка — 404 с конвертом, а не 500."""
    department = make_department()
    make_directorate(department)
    base, _ = allocated_event(manager, department)

    resp = manager.post(f"{base}forces/allocation/no-such-request/notify/")

    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"


# ── Шаг «СС-3»: управление выделяет людей статусом «Участие в ОМ» ───────────


def make_assignment_status_type():
    """Тип статуса привлечения: без него выделение отбивается справочником."""
    from organization_management.apps.operations.models import StatusType

    return StatusType.objects.get_or_create(
        code="EVENT_ASSIGNMENT",
        defaults={
            "name": "Привлечён на мероприятие",
            "priority": 80,
            "report_column_code": "IN_SERVICE",
            "is_hard_block": False,
        },
    )[0]


def test_selected_employee_gets_the_assignment_status(manager):  # noqa: F811
    """Выделение — это СТАТУС, а не строка в списке: расход считает по нему."""
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
    )

    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Сериков")
    base, allocation_id = allocated_event(manager, department)

    data = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    ).json()

    members = data["forceAllocation"][0]["members"]
    assert [m["employeeId"] for m in members] == [str(employee.pk)]
    status = OpsEmployeeStatus.objects.get(pk=members[0]["statusId"])
    assert status.employee_id == employee.pk
    assert status.status_type_code == "EVENT_ASSIGNMENT"
    # Полуинтервал: день мероприятия закрывается СЛЕДУЮЩИМ днём — иначе
    # строка пуста и статуса нет ни одного дня.
    assert status.date_end > status.date_start
    assert str(event_pk(base)) in status.source_ref


def event_pk(base):
    return base.rstrip("/").rsplit("/", 1)[-1]


def test_same_person_is_not_allocated_twice_to_one_event(manager):  # noqa: F811
    """Один человек — одно выделение на ОМ, даже из разных департаментов."""
    make_assignment_status_type()
    first = make_department("Департамент охраны")
    second = make_department("Департамент сопровождения")
    employee = make_employee("Сериков")
    base, total = event_on_demand(manager)
    rows = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first.pk), "need": 1},
                {"departmentId": str(second.pk), "need": 1},
            ]
        },
        format="json",
    ).json()["forceAllocation"]
    manager.post(
        f"{base}forces/allocation/{rows[0]['id']}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    resp = manager.post(
        f"{base}forces/allocation/{rows[1]['id']}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "DOUBLE_ASSIGNMENT"
    # Отказ НАЗЫВАЕТ департамент, который человека уже забрал: иначе штаб не
    # знает, с кем договариваться.
    assert first.name in resp.json()["message"]


def test_removing_a_planned_selection_cancels_its_status(manager):  # noqa: F811
    """Снятие до начала отменяет статус, а не оставляет его висеть."""
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
    )

    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Сериков")
    base, allocation_id = allocated_event(manager, department, FUTURE_DATE)
    added = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    ).json()
    status_id = added["forceAllocation"][0]["members"][0]["statusId"]

    data = manager.delete(
        f"{base}forces/allocation/{allocation_id}/members/{employee.pk}/"
    ).json()

    assert data["forceAllocation"][0]["members"] == []
    assert OpsEmployeeStatus.objects.get(pk=status_id).cancelled_at is not None


def test_started_selection_is_not_removed(manager):  # noqa: F811
    """Начавшееся привлечение — факт: снять его задним числом нельзя."""
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
    )

    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Сериков")
    base, allocation_id = allocated_event(manager, department, FUTURE_DATE)
    added = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    ).json()
    status_id = added["forceAllocation"][0]["members"][0]["statusId"]
    # Мероприятие фикстуры стоит будущей датой; привлечение «начинается»
    # переносом строки на сегодня — состояние выводится из дат, не хранится.
    today = Clock.today_local()
    OpsEmployeeStatus.objects.filter(pk=status_id).update(
        date_start=today, date_end=today + dt.timedelta(days=1)
    )

    resp = manager.delete(
        f"{base}forces/allocation/{allocation_id}/members/{employee.pk}/"
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ASSIGNMENT_ALREADY_STARTED"
    assert employee.last_name in resp.json()["message"]


def test_personnel_list_can_be_narrowed_to_a_division(manager):  # noqa: F811
    """Управление подбирает СВОИХ: отбор идёт по поддереву подразделения."""
    from organization_management.apps.staff_unit.models import StaffUnit

    department = make_department()
    directorate = make_directorate(department)
    mine = make_employee("Свой")
    stranger = make_employee("Чужой")
    unit = Division.objects.create(
        name="Отдел охраны",
        division_type=Division.DivisionType.DIVISION,
        parent=directorate,
    )
    StaffUnit.objects.create(division=unit, employee=mine, index=1)
    StaffUnit.objects.create(
        division=make_department("Департамент связи"), employee=stranger, index=2
    )

    data = manager.get(f"/api/ops/personnel/?division_id={directorate.pk}").json()

    names = [row["name"] for row in data["results"]]
    assert any("Свой" in name for name in names)
    assert not any("Чужой" in name for name in names)
    # Незнакомое подразделение — пусто, а не «все»: опечатка в фильтре не
    # должна молча расширять выбор.
    empty = manager.get("/api/ops/personnel/?division_id=999999").json()
    assert empty["results"] == []
