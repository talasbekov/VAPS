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


# ── Шаг «СС-4»: отправка окончательного списка штабу ────────────────────────


def notified_event_with_member(manager):  # noqa: F811
    """Заявка, дошедшая до «оповещено», с одним выделенным человеком."""
    make_assignment_status_type()
    department = make_department()
    make_directorate(department)
    employee = make_employee("Сериков")
    base, allocation_id = allocated_event(manager, department, FUTURE_DATE)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    return base, allocation_id, employee


def test_submitting_the_list_hands_it_to_the_staff(manager):  # noqa: F811
    """Отправка помечает заявку и МОМЕНТОМ, и событием журнала."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, allocation_id, employee = notified_event_with_member(manager)

    data = manager.post(f"{base}forces/allocation/{allocation_id}/submit/").json()

    row = data["forceAllocation"][0]
    assert row["status"] == "SUBMITTED"
    assert row["submittedAt"] is not None
    recorded = OpsAuditLog.objects.filter(
        action="FORCE_ALLOCATION_SUBMITTED"
    ).order_by("-id").first()
    assert recorded is not None
    # В журнале названы ЛЮДИ: с этого момента за них отвечает штаб, и список
    # «кого именно передали» обязан иметь след.
    assert recorded.new_value["members"] == [
        f"{employee.last_name} {employee.first_name[0]}."
    ]


def test_empty_list_is_not_submitted(manager):  # noqa: F811
    """Никого не выделили — отправлять нечего."""
    department = make_department()
    make_directorate(department)
    base, allocation_id = allocated_event(manager, department, FUTURE_DATE)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    resp = manager.post(f"{base}forces/allocation/{allocation_id}/submit/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_EMPTY"


def test_short_list_is_submitted_anyway(manager):  # noqa: F811
    """Недобор отправить МОЖНО: решает штаб, а не форма."""
    base, allocation_id, _ = notified_event_with_member(manager)

    data = manager.post(f"{base}forces/allocation/{allocation_id}/submit/").json()

    row = data["forceAllocation"][0]
    assert row["status"] == "SUBMITTED"
    # Сторож: у заявки потребность БОЛЬШЕ одного человека — иначе «недобор»
    # проверялся бы на полном списке.
    assert row["need"] > len(row["members"])


def test_not_notified_department_cannot_submit(manager):  # noqa: F811
    """Пока заявку не передали департаменту, отправлять ему нечего."""
    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Сериков")
    base, allocation_id = allocated_event(manager, department, FUTURE_DATE)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    resp = manager.post(f"{base}forces/allocation/{allocation_id}/submit/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_NOT_SUBMITTABLE"


def test_submitted_list_can_be_withdrawn_but_only_once(manager):  # noqa: F811
    """Отзыв возвращает заявку департаменту; повтор отзывать уже нечего."""
    base, allocation_id, _ = notified_event_with_member(manager)
    manager.post(f"{base}forces/allocation/{allocation_id}/submit/")

    data = manager.post(
        f"{base}forces/allocation/{allocation_id}/withdraw/"
    ).json()

    row = data["forceAllocation"][0]
    assert (row["status"], row["submittedAt"]) == ("NOTIFIED", None)
    again = manager.post(f"{base}forces/allocation/{allocation_id}/withdraw/")
    assert again.status_code == 422
    assert again.json()["error_code"] == "ALLOCATION_NOT_WITHDRAWABLE"


# ── Шаг «СС-5»: штаб принимает список и отдаёт людей мероприятию ────────────


def submitted_event(manager):  # noqa: F811
    base, allocation_id, employee = notified_event_with_member(manager)
    manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    return base, allocation_id, employee


def test_accepted_people_join_the_event_roster(manager):  # noqa: F811
    """Принятые уезжают в СОСТАВ мероприятия, а не только меняют статус заявки."""
    base, allocation_id, employee = submitted_event(manager)

    data = manager.post(f"{base}forces/allocation/{allocation_id}/accept/").json()

    row = data["forceAllocation"][0]
    assert (row["status"], row["decidedAt"] is not None) == ("ACCEPTED", True)
    assert [m["employeeId"] for m in data["forceRoster"]] == [str(employee.pk)]
    # Состав НАЗЫВАЕТ департамент, который человека отдал: спрашивать за него
    # будут с department, а не с мероприятия.
    assert data["forceRoster"][0]["departmentName"] != ""
    assert data["forceRoster"][0]["acceptedAt"] is not None


def test_second_acceptance_does_not_duplicate_the_roster(manager):  # noqa: F811
    """Отозвали, отправили заново, приняли снова — состав не удваивается."""
    base, allocation_id, employee = submitted_event(manager)
    manager.post(f"{base}forces/allocation/{allocation_id}/accept/")
    # Возврат к «оповещено» и повторная отправка: цикл, который в жизни идёт
    # после возврата штабом.
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.force_allocation = [
        {**row, "status": "SUBMITTED"} for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation"])

    data = manager.post(f"{base}forces/allocation/{allocation_id}/accept/").json()

    assert [m["employeeId"] for m in data["forceRoster"]] == [str(employee.pk)]


def test_return_needs_a_reason_and_sends_the_list_back(manager):  # noqa: F811
    """Возврат без причины отбивается; с причиной — заявка снова у департамента."""
    base, allocation_id, _ = submitted_event(manager)

    empty = manager.post(
        f"{base}forces/allocation/{allocation_id}/return/", {}, format="json"
    )
    assert empty.status_code == 400
    assert "reason" in empty.json()["details"]

    data = manager.post(
        f"{base}forces/allocation/{allocation_id}/return/",
        {"reason": "Нужны люди с допуском"},
        format="json",
    ).json()

    row = data["forceAllocation"][0]
    assert (row["status"], row["submittedAt"]) == ("RETURNED", None)
    assert row["decisionComment"] == "Нужны люди с допуском"
    # Возвращённых в составе нет: штаб их не принимал.
    assert data["forceRoster"] == []


def test_only_submitted_list_is_decided(manager):  # noqa: F811
    """По неотправленному списку решать нечего."""
    base, allocation_id, _ = notified_event_with_member(manager)

    accept = manager.post(f"{base}forces/allocation/{allocation_id}/accept/")

    assert accept.status_code == 422
    assert accept.json()["error_code"] == "ALLOCATION_NOT_DECIDABLE"


def test_forces_stage_completes_by_roster_not_by_numbers(manager):  # noqa: F811
    """Завершение этапа считает ЛЮДЕЙ состава, а не обещанные числа."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, allocation_id, _ = submitted_event(manager)
    manager.post(f"{base}forces/allocation/{allocation_id}/accept/")
    # Числа по группам при этом ЗАКРЫТЫ полностью — старое правило пропустило
    # бы этап; проба и стережёт, что решает теперь состав.
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.stage = "FORCES"
    event.force_requests = [
        {**r, "allocatedCount": r["requestedCount"]} for r in event.force_requests
    ]
    event.save(update_fields=["stage", "force_requests"])

    resp = manager.post(f"{base}forces/complete/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "FORCE_ALLOCATION_INCOMPLETE"
    # Отказ называет ЧИСЛА: «недобор» без цифры не говорит, сколько добирать.
    assert "недобор" in resp.json()["message"]


def test_forces_stage_waits_for_undecided_lists(manager):  # noqa: F811
    """Пока список висит у штаба нерешённым, этап не завершается."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, allocation_id, _ = submitted_event(manager)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.stage = "FORCES"
    event.save(update_fields=["stage"])

    resp = manager.post(f"{base}forces/complete/")

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "FORCE_ALLOCATION_INCOMPLETE"
    # Отказ НАЗЫВАЕТ департамент, чей список ждёт решения.
    assert "ждут решения штаба" in resp.json()["message"]


def test_forces_stage_completes_when_the_roster_covers_the_split(manager):  # noqa: F811
    """Состав покрыл разложенное — этап уходит на расстановку.

    Зелёная половина правила: без неё пробы выше доказывали бы лишь то, что
    завершение не проходит НИКОГДА.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    make_assignment_status_type()
    department = make_department()
    make_directorate(department)
    employee = make_employee("Сериков")
    base, _ = event_on_demand(manager, FUTURE_DATE)
    # Раскладываем РОВНО одного человека: столько же, сколько выделим.
    allocation_id = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    ).json()["forceAllocation"][0]["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    manager.post(f"{base}forces/allocation/{allocation_id}/accept/")
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.stage = "FORCES"
    event.save(update_fields=["stage"])

    data = manager.post(f"{base}forces/complete/").json()

    assert data["stage"] == "PLACEMENT"


# ── Шаг «СС-6»: расстановка берёт людей из состава ОМ ───────────────────────


def event_on_placement_with_roster(manager):  # noqa: F811
    """ОМ на «Расстановке», прошедшее цепочку сбора: в составе один человек."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    make_assignment_status_type()
    department = make_department()
    make_directorate(department)
    employee = make_employee("Сериков")
    base, _ = event_on_demand(manager, FUTURE_DATE)
    allocation_id = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    ).json()["forceAllocation"][0]["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    manager.post(f"{base}forces/allocation/{allocation_id}/accept/")
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.stage = "FORCES"
    event.save(update_fields=["stage"])
    fresh = manager.post(f"{base}forces/complete/").json()
    assert fresh["stage"] == "PLACEMENT"
    return base, employee, fresh["reconSectorPosts"][0]["id"]


def test_placement_takes_only_people_from_the_roster(manager):  # noqa: F811
    """На пост ставят того, кого штаб принял; чужого — отказ с объяснением."""
    base, employee, post_id = event_on_placement_with_roster(manager)
    stranger = make_employee("Посторонний")

    refused = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(stranger.pk)},
        format="json",
    )

    assert refused.status_code == 422
    assert refused.json()["error_code"] == "NOT_IN_ROSTER"
    assert "Сборе сил" in refused.json()["message"]

    # Зелёная половина: человек ИЗ состава на пост встаёт — иначе проба
    # доказывала бы лишь, что расстановка не работает вовсе.
    ok = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    assert ok.status_code == 200
    assert [a["employeeId"] for a in ok.json()["placementAssignments"]] == [
        str(employee.pk)
    ]


def test_event_without_roster_places_anyone(manager):  # noqa: F811
    """Мероприятие, которое вели прежним путём, расстановкой не заперто."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, _ = event_on_demand(manager)
    employee = make_employee("Прежний")
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.stage = "PLACEMENT"
    event.save(update_fields=["stage"])
    assert event.force_roster == [], "у фикстуры есть состав — проба вакуумна"
    post_id = manager.get(base).json()["reconSectorPosts"][0]["id"]

    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )

    assert resp.status_code == 200
