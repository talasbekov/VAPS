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
    """ОМ, у которого расчёт постов ушёл штабу числом.

    Имя фикстуры историческое: с 26.08.2026 (Plane №110) завершение
    рекогносцировки проводит мероприятие через «Потребность» и «Запрос сил»
    само и оставляет его на «Расстановке». Штаб раскладывает и принимает людей
    там же — сбор сил от стадии больше не зависит.

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
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
            "sectorPosts": posts,
        },
        format="json",
    )
    demand = manager.post(f"{base}recon/complete/").json()
    # Пин обновлён осознанно (Plane №110): «Потребность» и «Запрос сил» проходит
    # сервер, и завершение осмотра выводит ОМ сразу на «Расстановку». Пин не
    # снят, а перенацелен — он стережёт ровно то, что автопроход состоялся.
    assert demand["stage"] == "PLACEMENT"
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
    """Тип статуса привлечения: без него выделение отбивается справочником.

    Код `IN_EVENT`, а не `EVENT_ASSIGNMENT`: с Plane №486 оба «Привлечён на
    мероприятие» слиты в «Участие в ОМ», и цепочка пишет именно его. Пин
    правится ОСОЗНАННО — фикстура изображает справочник живого стенда, а там
    старых кодов больше нет в выдаче.
    """
    from organization_management.apps.operations.models import StatusType

    return StatusType.objects.get_or_create(
        code="IN_EVENT",
        defaults={
            "name": "Участие в ОМ",
            "priority": 75,
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
    assert status.status_type_code == "IN_EVENT"  # слияние, Plane №486
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


# ТРИ ПРОБЫ СНЯТЫ ВМЕСТЕ С РУЧКОЙ `forces/complete` (Plane №149).
#
# Они стерегли ПРАВИЛА завершения стадии «Запрос сил»: этап не закрывается,
# пока список висит у штаба нерешённым; закрытие считает людей состава, а не
# обещанные числа; принятый состав, покрывающий раскладку, этап закрывает.
#
# Правил больше нет — и не потому, что их отменили, а потому что стадии, на
# которой они действовали, мероприятие больше не занимает: завершение
# рекогносцировки проводит его сразу на «Расстановку» (Plane №110), а сбор сил
# идёт уже ТАМ. Гейта «нельзя уйти с FORCES с недобором» не существует, потому
# что уходить неоткуда.
#
# Что осталось стеречь и стережётся рядом: приёмка и возврат списков штабом
# (`accept`/`return`), недобор в самих списках и правило расстановки
# «человек — из состава» (`NOT_IN_ROSTER`, ниже в этом файле).


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
    # Мероприятие УЖЕ на «Расстановке»: туда его вывело завершение
    # рекогносцировки (Plane №110), а сбор сил идёт там же. Прежде фикстура
    # опускала ОМ на `FORCES` руками и поднимала снятой теперь ручкой
    # `forces/complete` — путь, которого в системе больше нет (Plane №149).
    fresh = manager.get(base).json()
    assert fresh["stage"] == "PLACEMENT", "фикстура ждёт ОМ на «Расстановке»"
    assert fresh["forceRoster"], "штаб принял состав — он обязан быть непустым"
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


# ── Plane №149: ручки автопройденных стадий СНЯТЫ ──────────────────────────


def test_the_removed_stage_handles_are_gone(manager):  # noqa: F811
    """`demand/approve` и `forces/complete` сняты и отвечают 404.

    Проба стоит вместо прежней (№125), которая стерегла их устаревание: пока
    ручки жили, надо было следить, что пометка на месте и старый путь работает;
    теперь надо следить за обратным — что путь не вернулся молча вместе с
    чьим-нибудь откатом.

    404, а не 405: адреса больше нет вовсе, а не «метод не тот».
    """
    base, _total = event_on_demand(manager)

    assert manager.post(f"{base}demand/approve/", {"rows": []}, format="json").status_code == 404
    assert manager.post(f"{base}forces/complete/").status_code == 404


def test_recon_completion_still_leads_to_placement(manager):  # noqa: F811
    """И главное: путь, который заменил снятые ручки, работает.

    Снять ручки и не проверить замену значило бы убрать дорогу, не убедившись,
    что рядом есть другая.
    """
    base, _total = event_on_demand(manager)

    assert manager.get(base).json()["stage"] == "PLACEMENT"


# ── Ш-5: цепочку ведёт СТАТУС, а не ручной набор штаба (Plane №274) ─────────


def _find_row(manager, base, allocation_id):  # noqa: F811
    """Строка раскладки из свежей выдачи мероприятия."""
    rows = manager.get(base).json()["forceAllocation"]
    return next(row for row in rows if row["id"] == allocation_id)


def _seed_participation_kinds():
    """Виды участия из справочника (Ш-2).

    Нужны там, где статус ставит ЧЕЛОВЕК: он выбирает вид из каталога, и
    сервис сверяет выбранное с ним. Системному пути цепочки они не нужны
    ОСОЗНАННО — см. `system_participations` в `status_service.create_status`.
    """
    from organization_management.apps.operations.models_settings import (
        OpsDictionaryEntry,
    )

    for code, label in (
        ("PHYSICAL_SQUAD", "Физический наряд"),
        ("SCREENING_GROUP", "Группа досмотра"),
    ):
        OpsDictionaryEntry.objects.get_or_create(
            dictionary_code="EVENT_PARTICIPATION_KINDS",
            code=code,
            defaults={"label": label, "description": "", "is_active": True},
        )


def _seat(employee, division):
    """Посадить человека в подразделение: департамент считается по поддереву
    штатной единицы, у `Employee` своего подразделения нет вовсе."""
    from organization_management.apps.staff_unit.models import StaffUnit

    StaffUnit.objects.create(division=division, employee=employee, index=1)
    return employee


def test_allocation_by_staff_writes_a_participation_row(manager):  # noqa: F811
    """Выделение штабом заводит СТРОКУ УЧАСТИЯ, а не только `source_ref`.

    До Ш-5 этот путь ставил статус и не писал участия вовсе: бэкфилл Ш-3
    перенёс то, что БЫЛО на момент миграции, и всё выделенное после неё
    оставалось новой таблице невидимым — на стенде так набралось 45 строк.
    Департаментский список, который теперь собирается из участий, потерял бы
    ровно этих людей.

    Стережёт мутацию: убрать `participations=` из `add_allocation_member`.
    """
    from organization_management.apps.operations.models_status import (
        OpsStatusParticipation,
    )

    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Каримов")
    base, allocation_id = allocated_event(manager, department)

    data = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    ).json()

    status_id = data["forceAllocation"][0]["members"][0]["statusId"]
    row = OpsStatusParticipation.objects.get(status_id=status_id)
    assert row.event_id == int(event_pk(base))
    # Вид выводится ИЗ КОДА СТАТУСА тем же соответствием, что и бэкфилл Ш-3.
    assert row.kind_code == "PHYSICAL_SQUAD"
    assert row.role_code == ""


def test_a_status_set_outside_the_chain_reaches_the_department(manager):  # noqa: F811
    """ПЕРЕВОРОТ НАПРАВЛЕНИЯ, о котором просил заказчик (Ш-5).

    Начальник управления ставит человеку статус участия в СВОЁМ расходе —
    штаб его не выделял. До Ш-5 список департамента был ручным набором штаба,
    и такой человек не появлялся в нём вовсе: список ничего не знал про
    статусы. Теперь источник — статус.

    Строка помечена `source: "STATUS"`: экран обязан отличать «штаб выделил»
    от «поставили статусом», иначе снятие обещало бы то, чего не может — у
    такой строки нет записи штаба, которую можно убрать.

    Стережёт мутацию: вернуть `"forceAllocation": event.force_allocation`.
    """
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations import clock

    make_assignment_status_type()
    _seed_participation_kinds()
    department = make_department()
    directorate = make_directorate(department)
    employee = _seat(make_employee("Ертаев"), directorate)
    base, _ = allocated_event(manager, department)
    event_id = int(event_pk(base))

    with clock.override(dt.date(2026, 8, 10)):
        status_service.create_status(
            employee_id=employee.pk,
            status_type_code="IN_EVENT",  # слияние статусов, Plane №486
            # Путь начальника — ЧЕКБОКСЫ запроса (Ш-11, Plane №427): ручной
            # ввод участия закрыт, статус ставит система.
            system_participations=True,
            date_start=dt.date(2026, 8, 10),
            date_end=dt.date(2026, 8, 11),
            actor="user:directorate-chief",
            participations=[
                {"event_id": event_id, "kind_code": "PHYSICAL_SQUAD"}
            ],
        )

    members = manager.get(base).json()["forceAllocation"][0]["members"]
    mine = [m for m in members if m["employeeId"] == str(employee.pk)]
    assert mine, f"человек со статусом не доехал до департамента: {members}"
    assert mine[0]["source"] == "STATUS"
    assert mine[0]["kindCode"] == "PHYSICAL_SQUAD"


def test_a_status_lands_in_exactly_one_row_of_the_department(manager):  # noqa: F811
    """Человек со статусом попадает в ОДНУ строку департамента (Plane №676).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. У департамента бывает больше одной строки:
    довыделение недобора (`[СБС-12]`, Plane №426) дописывает вторую, с
    `topUpOf`. Добавка людей по статусам ключилась по департаменту и
    дописывалась КАЖДОЙ его строке — один и тот же человек стоял в `members`
    обеих. `totals` считает «Прислано» суммой `len(members)` по строкам,
    поэтому число удваивалось, `shortage = max(0, need - sent)` схлопывался в
    ноль, и штаб видел укомплектованный сбор там, где людей не хватало.

    Мутация, на которой проба обязана краснеть: вернуть ключ по департаменту
    (`extra_by_department.get(str(row["departmentId"]))`) — тогда человек
    встанет в обе строки и `sent` станет 2.
    """
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations import clock

    make_assignment_status_type()
    _seed_participation_kinds()
    department = make_department()
    directorate = make_directorate(department)
    employee = _seat(make_employee("Двойников"), directorate)
    base, allocation_id = allocated_event(manager, department)

    # Вторая строка ТОГО ЖЕ департамента — довыделение недобора. Довыделять
    # можно только отправленный запрос, поэтому сначала оповещение.
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    top_up = manager.post(
        f"{base}forces/allocation/{allocation_id}/top-up/",
        {"count": 2},
        format="json",
    )
    assert top_up.status_code == 200, top_up.content
    rows = top_up.json()["forceAllocation"]
    assert len({r["id"] for r in rows}) == 2, "довыделения нет — сравнивать нечего"
    assert {str(r["departmentId"]) for r in rows} == {str(department.pk)}

    with clock.override(dt.date(2026, 8, 10)):
        status_service.create_status(
            employee_id=employee.pk,
            status_type_code="IN_EVENT",  # слияние статусов, Plane №486
            system_participations=True,
            date_start=dt.date(2026, 8, 10),
            date_end=dt.date(2026, 8, 11),
            actor="user:directorate-chief",
            participations=[
                {"event_id": int(event_pk(base)), "kind_code": "PHYSICAL_SQUAD"}
            ],
        )

    allocation = manager.get(base).json()["forceAllocation"]
    hits = [
        row["id"]
        for row in allocation
        for member in row["members"]
        if member["employeeId"] == str(employee.pk)
    ]
    assert len(hits) == 1, f"человек стоит в {len(hits)} строках департамента"
    # Приёмник — БАЗОВАЯ строка, а не довыделение: её правит редактор
    # раскладки, и участие, поставленное статусом, не знает, по какому запросу
    # человека дали.
    assert hits[0] == allocation_id
    # То самое число, ради которого всё: «Прислано» на карточке штаба.
    assert sum(len(row["members"]) for row in allocation) == 1


def test_a_status_of_another_department_does_not_leak(manager):  # noqa: F811
    """Человек ЧУЖОГО департамента в строку не попадает.

    Без контрольного департамента проба не отличила бы «разложили по адресу»
    от «свалили всех участников в первую строку».
    """
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations import clock

    make_assignment_status_type()
    _seed_participation_kinds()
    department = make_department()
    stranger_department = make_department("Департамент связи")
    stranger = _seat(
        make_employee("Чужаков"), make_directorate(stranger_department, "Управление С")
    )
    base, _ = allocated_event(manager, department)

    with clock.override(dt.date(2026, 8, 10)):
        status_service.create_status(
            employee_id=stranger.pk,
            status_type_code="IN_EVENT",  # слияние статусов, Plane №486
            date_start=dt.date(2026, 8, 10),
            date_end=dt.date(2026, 8, 11),
            actor="user:other-chief",
            participations=[
                {"event_id": int(event_pk(base)), "kind_code": "PHYSICAL_SQUAD"}
            ],
            # Чекбоксы запроса ставят статус системным путём (Ш-11, Plane №427).
            system_participations=True,
        )

    members = manager.get(base).json()["forceAllocation"][0]["members"]
    assert [m for m in members if m["employeeId"] == str(stranger.pk)] == []


def test_the_manual_row_is_not_dropped_when_participation_is_missing(  # noqa: F811
    manager,
):
    """Строка штаба без участия ОСТАЁТСЯ.

    Смена источника не даёт права стирать чужую работу: строка, заведённая до
    Ш-5 и не имеющая участия, обязана жить дальше.
    """
    from organization_management.apps.operations.models_status import (
        OpsStatusParticipation,
    )

    make_assignment_status_type()
    department = make_department()
    employee = make_employee("Досаев")
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    # Изображаем данные ДО Ш-5: статус есть, строки участия нет.
    OpsStatusParticipation.objects.all().delete()

    members = manager.get(base).json()["forceAllocation"][0]["members"]
    assert [m["employeeId"] for m in members] == [str(employee.pk)]


# ── №272 Ш-1: департамент делит свою квоту между управлениями ───────────────


def _split(manager, base, allocation_id, rows):  # noqa: F811
    return manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": rows},
        format="json",
    )


def test_the_department_splits_its_quota_between_directorates(manager):  # noqa: F811
    """Третий уровень раскладки: штаб → департамент → управления.

    До Ш-1 строка управления существовала (её заводит оповещение), но квоты у
    неё не было вовсе: управление узнавало «нас позвали» и не узнавало,
    сколько человек от него нужно.
    """
    department = make_department()
    first = make_directorate(department, "Управление охраны")
    second = make_directorate(department, "Управление сопровождения")
    base, allocation_id = allocated_event(manager, department)
    quota = _find_row(manager, base, allocation_id)["need"]

    # Числа берутся ОТ КВОТЫ, а не литералами: квота фикстуры считается из
    # расчёта постов и меняется вместе с ним — литералы делали бы пробу
    # красной от чужой правки. Раскладываем МЕНЬШЕ квоты: недобор допустим,
    # департамент раскладывает в несколько заходов.
    assert quota >= 3, f"квота фикстуры мала для раскладки на двоих: {quota}"
    mine, theirs = 1, quota - 2

    response = _split(
        manager,
        base,
        allocation_id,
        [
            {"divisionId": str(first.pk), "need": mine},
            {"divisionId": str(second.pk), "need": theirs},
        ],
    )

    assert response.status_code == 200, response.data
    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(first.pk)]["need"] == mine
    assert rows[str(second.pk)]["need"] == theirs
    assert mine + theirs < quota


def test_a_split_over_the_department_quota_is_refused(manager):  # noqa: F811
    """Перебор — отказ, и остаток назван числом, а не «слишком много»."""
    department = make_department()
    directorate = make_directorate(department)
    base, allocation_id = allocated_event(manager, department)
    quota = _find_row(manager, base, allocation_id)["need"]

    response = _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": quota + 4}]
    )

    assert response.status_code == 422, response.data
    assert response.data["error_code"] == "DIRECTORATE_QUOTA_OVERFLOW"
    assert "4" in response.data["message"]


def test_a_foreign_directorate_is_refused(manager):  # noqa: F811
    """Адресат обязан быть управлением ЭТОГО департамента.

    Без контрольного департамента проба не отличила бы «проверяем адрес» от
    «принимаем любой идентификатор подразделения».
    """
    department = make_department()
    stranger = make_directorate(make_department("Департамент связи"), "Управление С")
    base, allocation_id = allocated_event(manager, department)

    response = _split(
        manager, base, allocation_id, [{"divisionId": str(stranger.pk), "need": 1}]
    )

    assert response.status_code == 400, response.data
    assert "rows.0.divisionId" in str(response.data)


def test_quotas_are_locked_once_the_directorates_are_asked(manager):  # noqa: F811
    """«Квоты редактируются до запроса управлений» — подпись эталона.

    После оповещения управление уже выделяет людей под названное число, и
    молчаливая правка означала бы работу под квоту, которой больше нет.
    """
    department = make_department()
    directorate = make_directorate(department)
    base, allocation_id = allocated_event(manager, department)
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")

    response = _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": 1}]
    )

    assert response.status_code == 422, response.data
    assert response.data["error_code"] == "DIRECTORATE_QUOTAS_LOCKED"


def test_a_directorate_left_out_of_the_request_keeps_its_quota(manager):  # noqa: F811
    """Не названному в запросе квота не обнуляется молча.

    Запрос описывает то, что человек правил; строка, которой он не касался,
    остаётся как была — иначе правка одного управления стирала бы соседнее.
    """
    department = make_department()
    first = make_directorate(department, "Управление охраны")
    second = make_directorate(department, "Управление сопровождения")
    base, allocation_id = allocated_event(manager, department)
    quota = _find_row(manager, base, allocation_id)["need"]
    assert quota >= 3, f"квота фикстуры мала: {quota}"
    _split(
        manager,
        base,
        allocation_id,
        [{"divisionId": str(first.pk), "need": 1}, {"divisionId": str(second.pk), "need": 1}],
    )

    _split(manager, base, allocation_id, [{"divisionId": str(first.pk), "need": 2}])

    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(first.pk)]["need"] == 2
    # Соседнее управление правку не заметило.
    assert rows[str(second.pk)]["need"] == 1


def test_notifying_keeps_the_quotas_already_split(manager):  # noqa: F811
    """Оповещение НЕ стирает раскладку департамента.

    Оповещение пересобирает строки управлений целиком (оно добирает тех, кто
    появился в департаменте позже), и первая версия Ш-1 теряла на этой
    пересборке квоту: департамент раскладывал числа, нажимал «Запросить
    управления» — и числа обнулялись ровно в тот момент, когда впервые
    становились нужны управлению.

    Стережёт мутацию: убрать `"need"` из строки в `notify_directorates`.
    """
    department = make_department()
    directorate = make_directorate(department)
    base, allocation_id = allocated_event(manager, department)
    _split(manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": 2}])

    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")

    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(directorate.pk)]["need"] == 2
    assert rows[str(directorate.pk)]["notifiedAt"] is not None


# ── №272 Ш-2: «выделено N из M» по управлению — счёт НА ЧТЕНИИ ──────────────


def test_a_directorate_counts_its_own_assigned_people(manager):  # noqa: F811
    """Выделенные раскладываются по управлениям, а не сваливаются в кучу.

    Без второго управления проба не отличила бы «посчитали по адресу» от
    «посчитали всех в первой строке».
    """
    make_assignment_status_type()
    department = make_department()
    mine = make_directorate(department, "Управление охраны")
    other = make_directorate(department, "Управление сопровождения")
    employee = _seat(make_employee("Сериков"), mine)
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")

    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(mine.pk)]["assigned"] == 1
    assert rows[str(other.pk)]["assigned"] == 0


def test_a_person_from_a_department_of_the_directorate_counts_by_subtree(  # noqa: F811
    manager,
):
    """Человек числится в ОТДЕЛЕ, а квота адресована управлению.

    Сравнение «подразделение человека = управление» не нашло бы никого:
    у сотрудников штатная единица стоит в отделе. Считать надо по поддереву.

    Стережёт мутацию: сравнивать divisionId напрямую вместо `subtree_ids`.
    """
    from organization_management.apps.divisions.models import Division

    make_assignment_status_type()
    department = make_department()
    directorate = make_directorate(department, "Управление охраны")
    unit = Division.objects.create(
        name="Отдел №1", division_type=Division.DivisionType.DIVISION,
        parent=directorate,
    )
    employee = _seat(make_employee("Отделов"), unit)
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")

    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(directorate.pk)]["assigned"] == 1


def test_the_count_follows_a_transfer_without_touching_the_event(manager):  # noqa: F811
    """Счёт считается НА ЧТЕНИИ, а не хранится в строке.

    Человека перевели в другое управление мимо мероприятия. Записанная в
    момент выделения копия описывала бы вчерашнюю структуру; посчитанное на
    чтении число переезжает вместе с ним.

    Стережёт мутацию: сохранить `assigned` в JSON при выделении.
    """
    make_assignment_status_type()
    department = make_department()
    first = make_directorate(department, "Управление охраны")
    second = make_directorate(department, "Управление сопровождения")
    employee = _seat(make_employee("Переводов"), first)
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")

    staff_unit = employee.staff_unit
    staff_unit.division = second
    staff_unit.save(update_fields=["division"])

    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(first.pk)]["assigned"] == 0
    assert rows[str(second.pk)]["assigned"] == 1


# ── Ревью a5348abf/911ebfae: правила разнарядки (Plane №551-№561) ───────────


def test_the_quota_ceiling_counts_the_rows_the_request_did_not_name(manager):  # noqa: F811
    """🔴 Plane №559: две частичные отправки не складываются мимо предела.

    Строке, которую запрос не назвал, квота НЕ обнуляется (это правило верное
    и остаётся), а предел проверялся ТОЛЬКО по присланным строкам. Значит
    защита, ради которой правку и делали, обходилась двумя запросами — и
    докстринг `split_directorate_quotas` прямо утверждает, что этого быть не
    может.

    Мутация, которую стережёт проба: считать `total` по `prepared`, а не по
    `resulting` — второй запрос снова пройдёт.
    """
    department = make_department()
    first = make_directorate(department, "Управление охраны")
    second = make_directorate(department, "Управление сопровождения")
    base, allocation_id = allocated_event(manager, department)
    quota = _find_row(manager, base, allocation_id)["need"]
    assert quota >= 3, f"квота фикстуры мала: {quota}"

    ok = _split(manager, base, allocation_id, [{"divisionId": str(first.pk), "need": quota}])
    assert ok.status_code == 200, ok.data

    # Второй запрос называет ТОЛЬКО второе управление — первое остаётся с
    # прежней квотой, и вместе они уезжают за предел.
    over = _split(manager, base, allocation_id, [{"divisionId": str(second.pk), "need": 1}])

    assert over.status_code == 422, over.data
    assert over.json()["error_code"] == "DIRECTORATE_QUOTA_OVERFLOW"
    assert over.json()["details"] == {"quota": str(quota), "split": str(quota + 1)}
    # Состояние не поехало: у второго управления по-прежнему ноль.
    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(second.pk)]["need"] == 0


def test_a_fractional_or_boolean_number_is_refused_not_rounded(manager):  # noqa: F811
    """🔴 Plane №556: `int()` не проверяет целость, а приводит к ней.

    `int(2.9)` даёт 2, `int(True)` даёт 1 — и оба молча становились
    сохранённым числом при тексте ошибки «Укажите целое число».

    Мутация: вернуть `int(row.get("need", 0))` — оба запроса ниже станут
    зелёными и сохранят 2 и 1.
    """
    department = make_department()
    directorate = make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)

    fractional = _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": 2.9}]
    )
    assert fractional.status_code == 400, fractional.data
    assert fractional.json()["details"]["rows.0.need"] == ["Укажите целое число."]

    boolean = _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": True}]
    )
    assert boolean.status_code == 400, boolean.data

    # Строка целых цифр — законный ввод: формы шлют числа текстом.
    text = _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": "2"}]
    )
    assert text.status_code == 200, text.data
    rows = {
        row["divisionId"]: row
        for row in _find_row(manager, base, allocation_id)["directorates"]
    }
    assert rows[str(directorate.pk)]["need"] == 2


def test_the_staff_split_also_refuses_a_fractional_need(manager):  # noqa: F811
    """Та же проверка на ВЕРХНЕМ уровне раскладки (Plane №556).

    Мутация: вернуть в `split_force_demand` голый `int()` — 2.9 сохранится
    департаменту как 2.
    """
    department = make_department()
    base, _total = event_on_demand(manager)

    resp = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 2.9}]},
        format="json",
    )

    assert resp.status_code == 400, resp.data
    assert resp.json()["details"]["rows.0.need"] == ["Укажите целое число."]


def test_dispatch_refuses_a_split_wider_than_the_promise(manager):  # noqa: F811
    """🔴 Plane №558: рассылка не уходит шире обещанного «Выделяем».

    Разбивка ограничена цифрой «Выделяем» в момент сохранения, но сама цифра
    правится, пока список не ушёл. Значит предел обходился порядком действий:
    разложить по управлениям, пока «Выделяем» не задан (потолок падает на
    запрос штаба), затем ответить меньшим числом — и начальникам уходило
    больше обещанного.

    Проверка стоит в рассылке, а не в ответе: «0 закрывает запрос» —
    правило `[СБС-21]`, и запрещать ответ из-за сохранённой разбивки значило
    бы его отменить.

    Мутация: убрать проверку `planned > promised` из `notify_directorates` —
    рассылка пройдёт с перебором.
    """
    department = make_department()
    directorate = make_directorate(department, "Управление охраны")
    base, allocation_id = allocated_event(manager, department)
    quota = _find_row(manager, base, allocation_id)["need"]
    assert quota >= 3, f"квота фикстуры мала: {quota}"

    assert _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": 3}]
    ).status_code == 200
    lowered = manager.post(
        f"{base}forces/allocation/{allocation_id}/respond/",
        {"allocating": 1, "comment": ""},
        format="json",
    )
    assert lowered.status_code == 200, lowered.data

    refused = manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    assert refused.status_code == 422, refused.data
    assert refused.json()["error_code"] == "DIRECTORATE_QUOTA_OVERFLOW"
    assert refused.json()["details"] == {"quota": "1", "split": "3"}

    # Поправили разбивку — рассылка уходит.
    assert _split(
        manager, base, allocation_id, [{"divisionId": str(directorate.pk), "need": 1}]
    ).status_code == 200
    assert manager.post(f"{base}forces/allocation/{allocation_id}/notify/").status_code == 200
