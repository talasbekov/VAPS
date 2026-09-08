"""«Отправить запросы» штаба и следствия (`[СБС-12]`, `[СБС-13]`, `[СБС-22]`;
Plane №944 — задача заказчика «привести сбор сил к документации»).

Стережём: черновик (`draft: true`) департамент не видит и по нему не
отвечает; отправка ставит момент и шлёт ответственному департамента письмо со
ссылкой; отправленная цифра заперта (правится только довыделением), снять
отправленную строку нельзя; присланный список сразу в составе мероприятия,
отзыв и возврат забирают людей из состава, а после передачи на расстановку —
отказывают; «В строю» по управлениям считается на деловую дату.
"""
import pytest

from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import forces_send
from organization_management.apps.ops.tests.test_ops_forces_gathering import (  # noqa: F401
    event_on_demand,
    make_assignment_status_type,
    make_department,
    make_directorate,
    manager,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    make_employee,
)

pytestmark = pytest.mark.django_db

LIST = "/api/ops/security-events/forces/requests/"


def _event_id(base):
    return base.rstrip("/").rsplit("/", 1)[-1]


def _split(manager, base, department, need, *, draft=False):  # noqa: F811
    body = {"rows": [{"departmentId": str(department.pk), "need": need}]}
    if draft:
        body["draft"] = True
    resp = manager.post(f"{base}forces/allocation/", body, format="json")
    assert resp.status_code == 200, resp.content
    return resp.json()["forceAllocation"][0]


def _officer(department):
    """Ответственный за сбор сил департамента — `forces.allocate` с областью
    на департамент, как персона заказчика `acc_forces_officer`."""
    api, user = client_for(
        f"officer-{department.pk}",
        "FORCES_OFFICER_944",
        perms=("forces.allocate",),
        scope_division_id=department.pk,
    )
    api.user = user
    return api


def test_a_draft_is_invisible_to_the_department_and_unanswerable(manager):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, total = event_on_demand(manager)
    officer = _officer(department)

    row = _split(manager, base, department, total, draft=True)
    assert not row.get("sentAt")
    assert officer.get(LIST).json()["results"] == [], "черновик штаба виден департаменту"
    assert officer.get(f"{LIST}{row['id']}/").status_code == 404
    refused = manager.post(
        f"{base}forces/allocation/{row['id']}/respond/", {"allocating": 2}, format="json"
    )
    assert refused.status_code == 422 and refused.json()["error_code"] == "ALLOCATION_NOT_SENT"
    refused = manager.post(f"{base}forces/allocation/{row['id']}/notify/")
    assert refused.json()["error_code"] == "ALLOCATION_NOT_SENT"

    # Черновик правится на месте: и цифра, и снятие строки.
    changed = _split(manager, base, department, total - 1, draft=True)
    assert changed["need"] == total - 1 and changed["id"] == row["id"]
    resp = manager.post(f"{base}forces/allocation/", {"rows": [], "draft": True}, format="json")
    assert resp.status_code == 200 and resp.json()["forceAllocation"] == []


def test_sending_marks_the_moment_and_notifies_the_department_officer(manager):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, total = event_on_demand(manager)
    officer = _officer(department)
    outsider = _officer(make_department("Департамент связи"))

    row = _split(manager, base, department, total)
    assert row["sentAt"], "отправка не поставила момент"
    mine = officer.get(LIST).json()["results"]
    assert [r["allocationId"] for r in mine] == [row["id"]]
    assert outsider.get(LIST).json()["results"] == [], "чужой департамент видит запрос"

    letter = OpsNotification.objects.get(kind="FORCES_REQUEST_SENT", recipient=str(officer.user.pk))
    assert letter.payload["allocationId"] == row["id"]
    assert letter.payload["need"] == total
    assert not OpsNotification.objects.filter(
        kind="FORCES_REQUEST_SENT", recipient=str(outsider.user.pk)
    ).exists()

    # Повторная отправка той же раскладки второго письма не даёт и момент не
    # переписывает: «отправлено» — факт, а не счётчик нажатий. Счёт — по
    # ответственному: у `manager` грант без области, и письмо ему положено
    # тоже (глобальный `forces.allocate` на запрос отвечает).
    again = _split(manager, base, department, total)
    assert again["sentAt"] == row["sentAt"]
    assert (
        OpsNotification.objects.filter(
            kind="FORCES_REQUEST_SENT", recipient=str(officer.user.pk)
        ).count()
        == 1
    )


def test_a_sent_figure_is_locked_and_the_row_cannot_be_dropped(manager):  # noqa: F811
    department = make_department()
    make_directorate(department, "Управление охраны")
    base, total = event_on_demand(manager)
    row = _split(manager, base, department, total)

    refused = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total - 1}]},
        format="json",
    )
    # Ошибка ФОРМЫ у той строки, которую тронули, — тем же ответом, что и у
    # остальных ошибок раскладки (`_validation`).
    assert refused.status_code == 400, refused.content
    assert "rows.0.need" in refused.json()["details"]

    dropped = manager.post(f"{base}forces/allocation/", {"rows": []}, format="json")
    assert dropped.status_code == 422 and dropped.json()["error_code"] == "ALLOCATION_LOCKED"

    # Довыделение — единственный путь изменить цифру: новая строка, старая цела.
    topped = manager.post(
        f"{base}forces/allocation/{row['id']}/top-up/", {"count": 2}, format="json"
    ).json()
    rows = topped["forceAllocation"]
    assert [r["need"] for r in rows] == [total, 2]
    assert rows[1]["topUpOf"] == row["id"] and rows[1]["sentAt"]


def _submit_one(manager, base, department, business_date="2027-03-01"):  # noqa: F811
    make_assignment_status_type()
    make_directorate(department, "Управление охраны")
    row = _split(manager, base, department, 2)
    manager.post(f"{base}forces/allocation/{row['id']}/notify/")
    employee = make_employee()
    added = manager.post(
        f"{base}forces/allocation/{row['id']}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    assert added.status_code == 200, added.content
    submitted = manager.post(f"{base}forces/allocation/{row['id']}/submit/")
    assert submitted.status_code == 200, submitted.content
    return row["id"], str(employee.pk), submitted.json()


def test_a_submitted_list_is_in_the_roster_at_once(manager):  # noqa: F811
    """Блок 3 «появляется с первым присланным списком» — без отдельного
    «Принять в мероприятие» (`[СБС-13]`)."""
    department = make_department()
    base, _total = event_on_demand(manager, "2027-03-01")
    allocation_id, employee_id, data = _submit_one(manager, base, department)
    assert [m["employeeId"] for m in data["forceRoster"]] == [employee_id]
    assert data["forceAllocation"][0]["status"] == "SUBMITTED"

    # Приём остаётся идемпотентным: состав не задваивается.
    accepted = manager.post(f"{base}forces/allocation/{allocation_id}/accept/").json()
    assert [m["employeeId"] for m in accepted["forceRoster"]] == [employee_id]


def test_withdraw_and_return_take_people_out_of_the_roster(manager):  # noqa: F811
    department = make_department()
    base, _total = event_on_demand(manager, "2027-03-01")
    allocation_id, employee_id, _ = _submit_one(manager, base, department)

    withdrawn = manager.post(f"{base}forces/allocation/{allocation_id}/withdraw/").json()
    assert withdrawn["forceRoster"] == []
    resent = manager.post(f"{base}forces/allocation/{allocation_id}/submit/").json()
    assert [m["employeeId"] for m in resent["forceRoster"]] == [employee_id]

    returned = manager.post(
        f"{base}forces/allocation/{allocation_id}/return/",
        {"reason": "Нужны люди с допуском"},
        format="json",
    ).json()
    assert returned["forceRoster"] == []
    assert returned["forceAllocation"][0]["status"] == "RETURNED"


def test_after_hand_over_the_list_cannot_be_withdrawn(manager):  # noqa: F811
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    department = make_department()
    base, _total = event_on_demand(manager, "2027-03-01")
    allocation_id, employee_id, _ = _submit_one(manager, base, department)
    event = OpsSecurityEvent.objects.get(pk=_event_id(base))
    visit = event.visit_objects.first()
    assert visit is not None, "у пробного ОМ нет объекта посещения"
    given = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": employee_id, "visitObjectId": str(visit.pk)}]},
        format="json",
    )
    assert given.status_code == 200, given.content
    handed = manager.post(
        f"{base}force-collection/hand-over/", {"comment": "остальных доберём"}, format="json"
    )
    assert handed.status_code == 200, handed.content

    refused = manager.post(f"{base}forces/allocation/{allocation_id}/withdraw/")
    assert refused.status_code == 422 and refused.json()["error_code"] == "FORCE_HANDED_OVER"
    event.refresh_from_db()
    assert [m["employeeId"] for m in event.force_roster] == [employee_id]


def test_in_service_is_counted_per_directorate_on_the_business_date(manager):  # noqa: F811
    """«В строю» (`[СБС-22]`): человек относится к управлению по поддереву,
    статус вне строя на дату ОМ вычитает его, «в строю» считается на ДЕЛОВУЮ
    дату мероприятия, а не на сегодня."""
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.operations.models import StatusType
    from organization_management.apps.operations.models_status import OpsEmployeeStatus
    from organization_management.apps.staff_unit.models import StaffUnit

    department = make_department()
    directorate = make_directorate(department, "Управление охраны")
    unit = Division.objects.create(
        name="Отдел №1", division_type=Division.DivisionType.DIVISION, parent=directorate
    )
    base, _total = event_on_demand(manager, "2027-03-01")
    officer = _officer(department)
    row = _split(manager, base, department, 2)

    first, second = make_employee(), make_employee("Бекова", "Айгуль")
    StaffUnit.objects.create(division=unit, employee=first, index=1)
    StaffUnit.objects.create(division=unit, employee=second, index=2)
    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"},
    )
    OpsEmployeeStatus.objects.create(
        employee_id=second.pk,
        status_type_code="VACATION",
        date_start="2027-02-25",
        date_end="2027-03-05",
    )
    detail = officer.get(f"{LIST}{row['id']}/").json()
    assert detail["inServiceByDirectorate"] == {str(directorate.pk): 1}

    # Тот же отпуск, но не на дату ОМ, — в строю снова двое.
    OpsEmployeeStatus.objects.filter(employee_id=second.pk).update(
        date_start="2027-04-01", date_end="2027-04-05"
    )
    detail = officer.get(f"{LIST}{row['id']}/").json()
    assert detail["inServiceByDirectorate"] == {str(directorate.pk): 2}

    # `[СБС-23]`: выделенный человек из отдела приписан к своему управлению.
    manager.post(f"{base}forces/allocation/{row['id']}/notify/")
    make_assignment_status_type()
    added = manager.post(
        f"{base}forces/allocation/{row['id']}/members/",
        {"employeeId": str(first.pk)},
        format="json",
    )
    assert added.status_code == 200, added.content
    detail = officer.get(f"{LIST}{row['id']}/").json()
    assert detail["memberDirectorateById"] == {str(first.pk): str(directorate.pk)}
    # Участие в ОМ — не «в строю»: привлечённый вычитается из колонки.
    assert detail["inServiceByDirectorate"] == {str(directorate.pk): 1}


def test_withdrawal_notifies_the_headquarters(manager):  # noqa: F811
    """`[СБС-12]`: штаб уведомляется «при каждом изменении ответа департамента».
    Отзыв присланного списка — изменение, и до сих пор оно проходило молча:
    люди уходили из состава (и из распределения по объектам — до передачи),
    а штаб узнавал об этом только глазами (ревью №825 по №944, 08.09.2026).

    КРАСНАЯ ПРОБА: убери вызов `notify_headquarters_withdrawal` из
    `withdraw_allocation` — уведомления не будет.
    """
    from django.contrib.auth.models import User

    from organization_management.apps.operations.models import OpsNotification
    from organization_management.apps.operations.services import RoleAdminService
    from organization_management.apps.operations.tests.test_bulk_status_api import seed_role

    seed_role("HQ_WITHDRAW", ["forces.command", "event.view"])
    hq_user = User.objects.create_user(username="hq-withdraw", password="x")
    RoleAdminService.assign_role(str(hq_user.pk), "HQ_WITHDRAW", None, actor="test")

    department = make_department()
    base, _total = event_on_demand(manager, "2027-03-01")
    allocation_id, _employee_id, _ = _submit_one(manager, base, department)

    withdrawn = manager.post(f"{base}forces/allocation/{allocation_id}/withdraw/")
    assert withdrawn.status_code == 200, withdrawn.content

    note = OpsNotification.objects.filter(
        kind="FORCES_RESPONSE", recipient=str(hq_user.pk), payload__withdrawn=True
    ).first()
    assert note is not None, "штаб не узнал об отзыве списка"
    assert note.payload["allocationId"] == allocation_id
    assert note.payload["departmentName"] == department.name
