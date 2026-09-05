"""Отказы цепочки «Сбор сил на ОМ» по ЧУЖОЙ области — на уровне API
(Plane №74, шаг «Р-8»).

Разграничение, которое просил заказчик, живёт в двух местах: `require_scoped_
permission` отвечает на вопрос про область (его стерегут пробы
`operations/tests/test_scoped_permission.py`), а ВЬЮХИ решают, какую именно
область спросить у данных. Вторую половину пробы уровня функции не видят
вовсе: подмени вьюха департамент строки раскладки департаментом из тела
запроса — юнит остался бы зелёным, а граница исчезла бы.

Поэтому здесь ходят настоящие запросы:

* оповещение и отправка списка — область берётся из СТРОКИ РАСКЛАДКИ, и роль
  департамента А не трогает заявку департамента Б;
* выделение и снятие человека — область берётся из ШТАТНОЙ ЕДИНИЦЫ сотрудника,
  и начальник управления А-1 не выделяет человека из А-2;
* сотрудник без штатной единицы — область неразрешима: роль С областью
  отбивается (иначе границу обходили бы «удобным» человеком из тела запроса),
  роль БЕЗ области проходит;
* расстановка — её ведёт старший мероприятия; чужому она отказывает, а когда
  старшего не назначено нигде, проверка молчит (осознанное послабление).

Мероприятие во всех пробах готовит `manager` (роль без области, как сегодня
ведут цепочку): предмет проверки — ГЕЙТ действия, и путь к нему не должен
упираться в тот же гейт.
"""
import json

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_forces_gathering import (  # noqa: F401
    allocated_event,
    event_on_demand,
    make_assignment_status_type,
    make_department,
    make_directorate,
)
from .test_ops_security_events_api import (  # noqa: F401
    client_for,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"
CHAIN_PERMISSIONS = (
    "event.view",
    # Заведение и бюллетень — свои права с Plane №382, у ведущего мероприятие
    # они стоят рядом с `event.manage`, и фикстура изображает именно его.
    "event.manage",
    "event.create",
    "event.bulletin",
    "forces.command",
    "forces.allocate",
    "forces.select",
    "placement.manage",
)


def scoped_client(username, role_code, scope_division_id):
    """Человек цепочки с ролью, выданной С ОБЛАСТЬЮ.

    Набор прав тот же, что у `manager`: разграничение проверяется ОБЛАСТЬЮ, а
    не отсутствием кода — иначе проба зеленела бы по причине «права нет
    вовсе» и молчала бы о границе.
    """
    api, _ = client_for(
        username, role_code, perms=CHAIN_PERMISSIONS, scope_division_id=scope_division_id
    )
    return api


def unscoped_client(username, role_code):
    api, _ = client_for(username, role_code, perms=CHAIN_PERMISSIONS)
    return api


def employee_of(division, last_name):
    employee = make_employee(last_name)
    StaffUnit.objects.create(division=division, employee=employee, index=1)
    return employee


# ── Оповещение и отправка: область департамента строки раскладки ────────────


def test_notify_of_a_foreign_department_is_refused(manager):  # noqa: F811
    own = make_department("Департамент А")
    foreign = make_department("Департамент Б")
    make_directorate(foreign, "Управление Б-1")
    base, allocation_id = allocated_event(manager, foreign)
    dept_lead = scoped_client("forces-own-dept", "DEPT_LEAD_A", own.pk)

    # Тело ВРЁТ про область: клиент называет свой департамент, а строка
    # адресована чужому. Область обязана прийти из данных мероприятия —
    # поверь вьюха телу, и граница обходилась бы одним полем (проверено
    # мутацией: с областью из тела эта проба краснеет).
    resp = dept_lead.post(
        f"{base}forces/allocation/{allocation_id}/notify/",
        {"departmentId": str(own.pk)},
        format="json",
    )

    assert resp.status_code == 403


def test_notify_of_own_department_passes(manager):  # noqa: F811
    """Контроль к пробе выше: та же роль, та же ручка, СВОЯ строка — 200.

    Без него отказ выше нельзя отличить от «эта ручка не работает ни у кого».
    """
    own = make_department("Департамент А")
    make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-own-dept-ok", "DEPT_LEAD_A", own.pk)

    resp = dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")

    assert resp.status_code == 200
    assert resp.json()["forceAllocation"][0]["status"] == "NOTIFIED"


def test_submit_of_a_foreign_department_is_refused(manager):  # noqa: F811
    """Отправка списка закрыта той же областью, что и оповещение.

    Проверка прав идёт ДО состояния заявки, поэтому проба не готовит список:
    она стережёт границу, а не порядок шагов.
    """
    own = make_department("Департамент А")
    foreign = make_department("Департамент Б")
    base, allocation_id = allocated_event(manager, foreign)
    dept_lead = scoped_client("forces-submit-foreign", "DEPT_LEAD_A2", own.pk)

    resp = dept_lead.post(
        f"{base}forces/allocation/{allocation_id}/submit/",
        {"departmentId": str(own.pk)},
        format="json",
    )

    assert resp.status_code == 403


def test_directorate_of_own_department_is_not_foreign(manager):  # noqa: F811
    """Область департамента покрывает его управления: строка, адресованная
    департаменту, доступна ответственному, назначенному на этот департамент,
    даже когда сам он сидит в управлении внутри него."""
    department = make_department("Департамент А")
    directorate = make_directorate(department, "Управление А-1")
    base, allocation_id = allocated_event(manager, department)
    # Роль выдана на ДЕПАРТАМЕНТ, а строка адресована ему же.
    lead = scoped_client("forces-subtree", "DEPT_LEAD_A3", department.pk)

    resp = lead.post(f"{base}forces/allocation/{allocation_id}/notify/")

    assert resp.status_code == 200
    assert {row["name"] for row in resp.json()["forceAllocation"][0]["directorates"]} == {
        directorate.name
    }


# ── Выделение людей: область управления СОТРУДНИКА ──────────────────────────


def test_member_add_for_a_foreign_directorate_is_refused(manager):  # noqa: F811
    make_assignment_status_type()
    department = make_department("Департамент А")
    mine = make_directorate(department, "Управление А-1")
    theirs = make_directorate(department, "Управление А-2")
    stranger = employee_of(theirs, "Чужаков")
    base, allocation_id = allocated_event(manager, department)
    chief = scoped_client("forces-dir-lead", "DIR_LEAD_A1", mine.pk)

    # Область в теле — та же ложь: сотрудник из А-2, а клиент называет А-1.
    resp = chief.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(stranger.pk), "divisionId": str(mine.pk)},
        format="json",
    )

    assert resp.status_code == 403


def test_member_add_for_own_directorate_passes(manager):  # noqa: F811
    make_assignment_status_type()
    department = make_department("Департамент А")
    mine = make_directorate(department, "Управление А-1")
    make_directorate(department, "Управление А-2")
    own_person = employee_of(mine, "Своиков")
    base, allocation_id = allocated_event(manager, department)
    chief = scoped_client("forces-dir-lead-ok", "DIR_LEAD_A1b", mine.pk)

    resp = chief.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(own_person.pk)},
        format="json",
    )

    assert resp.status_code == 200
    members = resp.json()["forceAllocation"][0]["members"]
    assert [m["employeeId"] for m in members] == [str(own_person.pk)]


def test_member_remove_is_checked_by_the_same_employee(manager):  # noqa: F811
    """Снятие спрашивает область ТОГО ЖЕ человека: иначе своего выделяло бы
    своё управление, а снимало бы любое."""
    make_assignment_status_type()
    department = make_department("Департамент А")
    mine = make_directorate(department, "Управление А-1")
    theirs = make_directorate(department, "Управление А-2")
    stranger = employee_of(theirs, "Чужаков")
    # Дата в будущем: снять выделенного можно только до начала мероприятия.
    base, allocation_id = allocated_event(manager, department, business_date="2027-06-01")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(stranger.pk)},
        format="json",
    )
    chief = scoped_client("forces-remove-foreign", "DIR_LEAD_A1c", mine.pk)

    resp = chief.delete(
        f"{base}forces/allocation/{allocation_id}/members/{stranger.pk}/"
    )

    assert resp.status_code == 403


def test_employee_without_a_staff_unit_is_refused_for_a_scoped_role(manager):  # noqa: F811
    """Область неразрешима — роль С областью отбивается.

    Идентификатор сотрудника приходит ИЗ ТЕЛА ЗАПРОСА: пропусти проверка
    человека без штатной единицы, и начальник управления А-1 выделял бы кого
    угодно, подобрав «удобного» — граница обходилась бы телом запроса.
    """
    make_assignment_status_type()
    department = make_department("Департамент А")
    mine = make_directorate(department, "Управление А-1")
    homeless = make_employee("Безштатов")  # штатной единицы нет вовсе
    base, allocation_id = allocated_event(manager, department)
    chief = scoped_client("forces-homeless-scoped", "DIR_LEAD_A1d", mine.pk)

    resp = chief.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(homeless.pk)},
        format="json",
    )

    assert resp.status_code == 403


def test_employee_without_a_staff_unit_passes_for_a_role_without_scope(manager):  # noqa: F811
    """Роль БЕЗ области неразрешимой областью не сужается: сузить её нечем ни
    в одном подразделении, и отказ запер бы ровно тех, кто ведёт цепочку
    сегодня, ничего не защитив."""
    make_assignment_status_type()
    department = make_department("Департамент А")
    homeless = make_employee("Безштатов")
    base, allocation_id = allocated_event(manager, department)
    lead = unscoped_client("forces-homeless-global", "GLOBAL_LEAD_F")

    resp = lead.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(homeless.pk)},
        format="json",
    )

    assert resp.status_code == 200


# ── Расстановка: её ведёт старший мероприятия ───────────────────────────────


def test_placement_assign_is_refused_to_a_stranger_when_a_chief_is_named(manager):  # noqa: F811
    """Право `placement.manage` отвечает «может ли вообще», а старший — «его ли
    это мероприятие». У мероприятия со старшим чужой не расставляет."""
    department = make_department("Департамент А")
    base, _allocation_id = allocated_event(manager, department)
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    chief_employee = make_employee("Старшинов")
    event.chief_employee_id = chief_employee.pk
    event.save(update_fields=["chief_employee_id"])
    post_id = event.recon_sector_posts[0]["id"]
    worker = employee_of(make_directorate(department, "Управление А-1"), "Постовой")
    stranger = scoped_client("placement-stranger", "PLACE_LEAD", department.pk)

    resp = stranger.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(worker.pk)},
        format="json",
    )

    assert resp.status_code == 403


def test_placement_assign_passes_when_no_chief_is_named_anywhere(manager):  # noqa: F811
    """Старшего не назначили — проверка МОЛЧИТ: запирать расстановку
    мероприятия, которому забыли назвать старшего, значит устраивать простой
    вместо разграничения. Право при этом всё равно требуется.

    Отклонение осознанное и записано в `Frontend/Decisions`; захочет заказчик
    строгости — эта проба и укажет, где её включать.
    """
    department = make_department("Департамент А")
    base, _allocation_id = allocated_event(manager, department)
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    # Фикстура даёт старшего по умолчанию (`[РЕК-02]`, №424: без него не пройти
    # рекогносцировку) — снимаем его ПОСЛЕ прохода, предмет пробы — расстановка
    # у ОМ, где старшего не назвали нигде.
    OpsSecurityEvent.objects.filter(pk=event_id).update(chief_employee_id=None, chief_name="")
    event.visit_objects.update(chief_employee_id=None, chief_name="")
    event.refresh_from_db()
    assert event.chief_employee_id is None
    post_id = event.recon_sector_posts[0]["id"]
    worker = employee_of(make_directorate(department, "Управление А-1"), "Постовой")
    lead = scoped_client("placement-no-chief", "PLACE_LEAD2", department.pk)

    resp = lead.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(worker.pk)},
        format="json",
    )

    assert resp.status_code == 200


def test_placement_assign_is_refused_without_the_permission(manager):  # noqa: F811
    """Старшинство НЕ выдаёт права: у кого нет `placement.manage`, тому и своё
    мероприятие не помогает."""
    department = make_department("Департамент А")
    base, _allocation_id = allocated_event(manager, department)
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    post_id = OpsSecurityEvent.objects.get(pk=event_id).recon_sector_posts[0]["id"]
    worker = employee_of(make_directorate(department, "Управление А-1"), "Постовой")
    api, _user = client_for("placement-noperm", "PLACE_VIEWER", perms=("event.view",))

    resp = api.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(worker.pk)},
        format="json",
    )

    assert resp.status_code == 403


# ── №272 Ш-3: «что просят у МЕНЯ» — область на списке заявок ────────────────

REQUESTS_URL = f"{URL}forces/requests/"


def test_the_requests_list_shows_only_my_department(manager):  # noqa: F811
    """Заявка ЧУЖОГО департамента не приезжает вовсе.

    Не «не показывается на клиенте», а не приезжает: прислать строку браузеру
    и понадеяться, что он её скроет, — это не область видимости.

    Стережёт мутацию: отдать `department_requests_view(None)` всем.
    """
    mine = make_department("Департамент А")
    theirs = make_department("Департамент Б")
    base, _ = allocated_event(manager, mine)
    # Вторая заявка ТОМУ ЖЕ мероприятию, но чужому департаменту: без неё проба
    # не отличила бы «сузили по адресу» от «в базе одна строка».
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(mine.pk), "need": 1},
                {"departmentId": str(theirs.pk), "need": 1},
            ]
        },
        format="json",
    )

    api = scoped_client("dep-a-requests", "DEP_A_REQ", mine.pk)
    response = api.get(REQUESTS_URL)

    assert response.status_code == 200, response.data
    names = {row["departmentName"] for row in response.data["results"]}
    assert names == {"Департамент А"}, response.data["results"]
    assert all(row["code"] == event.code for row in response.data["results"])


def test_an_unscoped_operator_sees_every_request(manager):  # noqa: F811
    """Роль БЕЗ области видит все заявки.

    `None` («область не сужена») и пустое множество («видеть нечего») — разные
    заявления, и путать их нельзя: администратор увидел бы пустой экран.
    """
    first = make_department("Департамент А")
    second = make_department("Департамент Б")
    base, _ = allocated_event(manager, first)
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

    api = unscoped_client("no-scope-requests", "NO_SCOPE_REQ")
    response = api.get(REQUESTS_URL)

    assert response.status_code == 200, response.data
    assert {row["departmentName"] for row in response.data["results"]} == {
        "Департамент А",
        "Департамент Б",
    }


def test_the_requests_list_is_closed_without_the_permission():
    """Список закрыт правом департамента, а не «видно всем читающим»."""
    api, _user = client_for("requests-noperm", "REQ_VIEWER", perms=("event.view",))

    assert api.get(REQUESTS_URL).status_code == 403


def test_a_request_row_carries_what_the_table_shows(manager):  # noqa: F811
    """Строка несёт ровно то, из чего собрана таблица.

    Пробa стережёт контракт: экран не должен добирать эти поля вторым
    запросом на каждую строку — ради этого ручка и заведена отдельно от
    реестра ОМ.
    """
    department = make_department("Департамент А")
    base, allocation_id = allocated_event(manager, department)

    row = manager.get(REQUESTS_URL).data["results"][0]

    assert row["allocationId"] == allocation_id
    assert row["departmentName"] == "Департамент А"
    assert row["need"] >= 1
    assert row["assigned"] == 0
    assert row["status"] == "DRAFT"
    assert row["code"] and row["title"] and row["businessDate"]


# ── №272 Ш-4: карточка ОДНОЙ заявки ────────────────────────────────────────


def request_url(allocation_id):
    from urllib.parse import quote

    return f"{URL}forces/requests/{quote(allocation_id, safe='')}/"


def test_the_request_card_carries_directorates_and_members(manager):  # noqa: F811
    """Карточка несёт управления с квотами и выделенных — состав эталона."""
    make_assignment_status_type()
    department = make_department("Департамент А")
    directorate = make_directorate(department, "Управление А-1")
    employee = employee_of(directorate, "Карточкин")
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": 1}]},
        format="json",
    )
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/", {}, format="json")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    response = manager.get(request_url(allocation_id))

    assert response.status_code == 200, response.data
    allocation = response.data["allocation"]
    row = next(
        item
        for item in allocation["directorates"]
        if item["divisionId"] == str(directorate.pk)
    )
    assert row["need"] == 1
    assert row["assigned"] == 1
    assert [m["employeeId"] for m in allocation["members"]] == [str(employee.pk)]


def test_a_status_member_is_named_by_division(manager):  # noqa: F811
    """У попавшего в список СТАТУСОМ подразделение названо, а не прочерк.

    Первая версия оставляла имя пустым: сервер знал id и не знал названия, и
    в карточке у всех таких строк стоял прочерк.

    Стережёт мутацию: вернуть `"divisionName": ""`.
    """
    from organization_management.apps.operations import clock, status_service
    import datetime as dt

    make_assignment_status_type()
    department = make_department("Департамент А")
    directorate = make_directorate(department, "Управление А-1")
    employee = employee_of(directorate, "Статусов")
    base, allocation_id = allocated_event(manager, department)
    event_id = int(base.rstrip("/").rsplit("/", 1)[-1])

    with clock.override(dt.date(2026, 8, 10)):
        status_service.create_status(
            employee_id=employee.pk,
            status_type_code="IN_EVENT",  # слияние статусов, Plane №486
            date_start=dt.date(2026, 8, 10),
            date_end=dt.date(2026, 8, 11),
            actor="user:chief",
            participations=[{"event_id": event_id, "kind_code": "PHYSICAL_SQUAD"}],
            system_participations=True,
        )

    members = manager.get(request_url(allocation_id)).data["allocation"]["members"]
    mine = next(m for m in members if m["employeeId"] == str(employee.pk))
    assert mine["source"] == "STATUS"
    assert mine["divisionName"] == "Управление А-1"


def test_a_foreign_request_card_is_not_found(manager):  # noqa: F811
    """Чужая заявка — 404, а не 403.

    Существование чужой строки не подтверждается перебором идентификаторов:
    403 на чужой и 404 на несуществующей различали бы их для того, кто
    подбирает адреса.
    """
    mine = make_department("Департамент А")
    theirs = make_department("Департамент Б")
    base, _ = allocated_event(manager, mine)
    data = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(mine.pk), "need": 1},
                {"departmentId": str(theirs.pk), "need": 1},
            ]
        },
        format="json",
    ).json()
    foreign = next(
        row["id"]
        for row in data["forceAllocation"]
        if row["departmentId"] == str(theirs.pk)
    )

    api = scoped_client("dep-a-card", "DEP_A_CARD", mine.pk)

    assert api.get(request_url(foreign)).status_code == 404


# ── №272 Ш-5: область на ДЕЙСТВИИ, а не только на чтении ───────────────────


def test_splitting_a_foreign_department_quota_is_refused(manager):  # noqa: F811
    """Разложить квоту ЧУЖОГО департамента нельзя.

    Ш-1 добавил действие, Ш-3 и Ш-4 сузили чтение — но чтение и действие
    закрываются по отдельности: суженный на чтении экран не мешает послать
    запрос прямым адресом. Проба стоит на действии.

    Стережёт мутацию: снять `allocation_scope_division` у `forces_split`.
    """
    own = make_department("Департамент А")
    foreign = make_department("Департамент Б")
    directorate = make_directorate(foreign, "Управление Б-1")
    base, _ = allocated_event(manager, own)
    data = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(own.pk), "need": 1},
                {"departmentId": str(foreign.pk), "need": 1},
            ]
        },
        format="json",
    ).json()
    foreign_allocation = next(
        row["id"]
        for row in data["forceAllocation"]
        if row["departmentId"] == str(foreign.pk)
    )

    api = scoped_client("dep-a-split", "DEP_A_SPLIT", own.pk)
    response = api.post(
        f"{base}forces/allocation/{foreign_allocation}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": 1}]},
        format="json",
    )

    assert response.status_code == 403, response.data


def test_splitting_my_own_department_quota_is_allowed(manager):  # noqa: F811
    """Контрольная половина: своё разложить можно.

    Без неё проба выше зеленела бы и на «действие запрещено всем», то есть
    молчала бы о границе вместо того, чтобы её стеречь.
    """
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)

    api = scoped_client("dep-a-split-ok", "DEP_A_SPLIT_OK", own.pk)
    response = api.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": 1}]},
        format="json",
    )

    assert response.status_code == 200, response.data


# ── №271 Ш-1: сборы глазами ШТАБА ──────────────────────────────────────────

COLLECTIONS_URL = f"{URL}forces/collections/"


def test_the_collections_list_sums_every_department(manager):  # noqa: F811
    """«Собрано» по мероприятию — сумма ПО ВСЕМ департаментам.

    Без второго департамента проба не отличила бы «сложили всех» от «взяли
    первую строку раскладки».
    """
    make_assignment_status_type()
    first = make_department("Департамент А")
    second = make_department("Департамент Б")
    mine = employee_of(make_directorate(first, "Управление А-1"), "Первый")
    theirs = employee_of(make_directorate(second, "Управление Б-1"), "Второй")
    base, _ = allocated_event(manager, first)
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
    for row, employee in zip(rows, (mine, theirs)):
        manager.post(
            f"{base}forces/allocation/{row['id']}/members/",
            {"employeeId": str(employee.pk)},
            format="json",
        )

    code = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1]).code
    row = next(
        item
        for item in manager.get(COLLECTIONS_URL).data["results"]
        if item["code"] == code
    )

    assert row["gathered"] == 2
    assert row["departments"] == 2
    assert row["need"] >= 1


def test_the_collections_list_is_closed_without_the_staff_permission():
    """Список закрыт правом ШТАБА, а не «видно всем читающим»."""
    api, _user = client_for("collections-noperm", "COLL_VIEWER", perms=("event.view",))

    assert api.get(COLLECTIONS_URL).status_code == 403


def test_an_event_without_demand_is_not_a_collection(manager):  # noqa: F811
    """Мероприятие БЕЗ посчитанной потребности в список не попадает.

    Пока числа с рекогносцировки нет, раздавать нечего, и строка означала бы
    работу, которой ещё не существует.

    Стережёт мутацию: убрать `if need <= 0: continue`.
    """
    fresh = manager.post(
        URL,
        {
            "title": "Проба без потребности",
            "businessDate": "2026-08-30",
            "kind": "INTERNAL",
            "location": "Проба",
        },
        format="json",
    ).json()

    codes = {row["code"] for row in manager.get(COLLECTIONS_URL).data["results"]}

    assert fresh["code"] not in codes


def test_the_collection_status_follows_the_whole_split(manager):  # noqa: F811
    """Разнарядка «разослана», только когда сказали ВСЕМ.

    Пока одному департаменту не сказали, разнарядка не разослана: обратное
    читалось бы как «все предупреждены».

    Стережёт мутацию: считать статус по первой строке раскладки.
    """
    first = make_department("Департамент А")
    make_directorate(first, "Управление А-1")
    second = make_department("Департамент Б")
    make_directorate(second, "Управление Б-1")
    base, _ = allocated_event(manager, first)
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
    code = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1]).code

    def status_now():
        return next(
            item
            for item in manager.get(COLLECTIONS_URL).data["results"]
            if item["code"] == code
        )["collectionStatus"]

    assert status_now() == "NEW"
    manager.post(f"{base}forces/allocation/{rows[0]['id']}/notify/", {}, format="json")
    assert status_now() == "NEW", "разнарядка одному департаменту — ещё не «разослана»"
    manager.post(f"{base}forces/allocation/{rows[1]['id']}/notify/", {}, format="json")
    assert status_now() == "NOTIFIED"


# ── №271 Ш-2: карточка сбора ───────────────────────────────────────────────


def collection_url(event_base):
    return f"{event_base}force-collection/"


def test_the_collection_card_counts_the_tiles(manager):  # noqa: F811
    """Плитки считает СЕРВЕР, а не клиент.

    «Осталось собрать» — это правило («требуется минус собрано»), и второй
    счёт на клиенте разошёлся бы с сервером при первой же правке правила.

    Стережёт мутацию: считать `remaining` как `need - allocated`.
    """
    make_assignment_status_type()
    department = make_department("Департамент А")
    employee = employee_of(make_directorate(department, "Управление А-1"), "Сборов")
    base, allocation_id = allocated_event(manager, department)
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    data = manager.get(collection_url(base)).data

    assert data["gathered"] == 1
    assert data["remaining"] == data["need"] - 1
    assert data["allocated"] >= 1


def test_the_collection_card_carries_every_department_with_people(manager):  # noqa: F811
    """Карточка несёт ВСЕ департаменты и людей внутри каждого.

    Раскрытие строки — не украшение: без поимённого списка «5 из 46»
    остаётся числом, за которым нельзя проверить, тех ли людей прислали.
    """
    make_assignment_status_type()
    first = make_department("Департамент А")
    second = make_department("Департамент Б")
    mine = employee_of(make_directorate(first, "Управление А-1"), "Первый")
    base, _ = allocated_event(manager, first)
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
    own = next(r for r in rows if r["departmentId"] == str(first.pk))
    manager.post(
        f"{base}forces/allocation/{own['id']}/members/",
        {"employeeId": str(mine.pk)},
        format="json",
    )

    allocations = manager.get(collection_url(base)).data["allocations"]

    assert {row["departmentName"] for row in allocations} == {
        "Департамент А",
        "Департамент Б",
    }
    with_people = next(r for r in allocations if r["departmentId"] == str(first.pk))
    assert [m["employeeId"] for m in with_people["members"]] == [str(mine.pk)]
    empty = next(r for r in allocations if r["departmentId"] == str(second.pk))
    assert empty["members"] == []


def test_the_collection_card_is_closed_without_the_staff_permission(manager):  # noqa: F811
    """Карточка закрыта правом ШТАБА."""
    department = make_department("Департамент А")
    base, _ = allocated_event(manager, department)
    api, _user = client_for("card-noperm", "CARD_VIEWER", perms=("event.view",))

    assert api.get(collection_url(base)).status_code == 403


# ── Ответ департамента «Выделяем: X» (Plane №391, `[СБС-21]`) ────────────────


def _respond(client, base, allocation_id, allocating, comment=""):
    return client.post(
        f"{base}forces/allocation/{allocation_id}/respond/",
        {"allocating": allocating, "comment": comment},
        format="json",
    )


def _allocation(resp):
    return resp.json()["forceAllocation"][0]


def test_the_department_answers_with_its_own_number_and_a_comment(manager):  # noqa: F811
    """«Выделяем» и комментарий ложатся в строку раскладки; цифра — любая.

    Красная на мутации: убери ключ `allocating` из `_update_allocation` — ответ
    не сохранится.
    """
    own = make_department("Департамент А")
    make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-respond-own", "DEPT_LEAD_R1", own.pk)

    resp = _respond(dept_lead, base, allocation_id, 2, "Двое в отпуске")

    assert resp.status_code == 200, resp.data
    row = _allocation(resp)
    assert row["allocating"] == 2
    assert row["answerComment"] == "Двое в отпуске"
    assert row["status"] == "DRAFT"


def test_zero_closes_the_request_as_declined_and_a_number_reopens_it(manager):  # noqa: F811
    """«0» закрывает запрос статусом «Отказ»; ненулевая цифра его снимает.

    Снятый отказ возвращает статус ПО ФАКТУ оповещения, а не «как было»: этого
    сервер не помнит и помнить не должен.
    """
    own = make_department("Департамент А")
    make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-respond-zero", "DEPT_LEAD_R2", own.pk)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")

    declined = _allocation(_respond(dept_lead, base, allocation_id, 0, "Все на объекте"))
    assert declined["status"] == "DECLINED"
    assert declined["declinedAt"] is not None

    reopened = _allocation(_respond(dept_lead, base, allocation_id, 1))
    assert reopened["status"] == "NOTIFIED"
    assert reopened["declinedAt"] is None
    assert reopened["allocating"] == 1


def test_the_answer_is_locked_once_the_list_is_with_the_staff(manager):  # noqa: F811
    """После отправки списка цифра «Выделяем» не правится — штаб уже решает
    по присланному, и менять условия под ним значило бы менять их задним
    числом."""
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-respond-locked", "DEPT_LEAD_R3", own.pk)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")
    person = employee_of(directorate, "Выделенов")
    make_assignment_status_type()
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(person.pk)},
        format="json",
    )
    assert dept_lead.post(f"{base}forces/allocation/{allocation_id}/submit/").status_code == 200

    resp = _respond(dept_lead, base, allocation_id, 5)

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_ANSWER_LOCKED"


def test_the_answer_of_a_foreign_department_is_refused(manager):  # noqa: F811
    """Цифру ставит ТОЛЬКО ответственный своего департамента — штаб читает."""
    own = make_department("Департамент А")
    foreign = make_department("Департамент Б")
    base, allocation_id = allocated_event(manager, foreign)
    dept_lead = scoped_client("forces-respond-foreign", "DEPT_LEAD_R4", own.pk)

    assert _respond(dept_lead, base, allocation_id, 3).status_code == 403


def test_a_negative_or_garbage_number_is_refused_by_the_field(manager):  # noqa: F811
    """Отказ по ФОРМЕ (400, `VALIDATION_ERROR` с именем поля), а не по правилу
    (422): человек ошибся в поле, и ответ указывает на поле."""
    own = make_department("Департамент А")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-respond-bad", "DEPT_LEAD_R5", own.pk)

    negative = _respond(dept_lead, base, allocation_id, -1)
    garbage = _respond(dept_lead, base, allocation_id, "много")

    assert negative.status_code == 400
    assert "allocating" in negative.json()["details"]
    assert garbage.status_code == 400


def test_the_staff_resaving_the_split_keeps_the_department_answer(manager):  # noqa: F811
    """Пересохранение раскладки штабом НЕ стирает ответ департамента.

    Строка пересобирается явным перечнем ключей (см. `split_force_demand`), и
    забытый ключ — стёртый факт. Красная на мутации: убери `allocating` из
    перечня — ответ пропадёт после `forces/allocation/`.
    """
    own = make_department("Департамент А")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-respond-keep", "DEPT_LEAD_R6", own.pk)
    _respond(dept_lead, base, allocation_id, 2, "Ответ")

    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    need = event.force_allocation[0]["need"]
    resaved = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(own.pk), "need": need}]},
        format="json",
    )

    assert resaved.status_code == 200, resaved.data
    row = _allocation(resaved)
    assert row["allocating"] == 2
    assert row["answerComment"] == "Ответ"


# ── «Отправить в управления» → уведомления, предел от «Выделяем» (Plane №392) ─


def test_notifying_directorates_sends_the_request_to_their_heads(manager, django_user_model):  # noqa: F811
    """`notify_directorates` — не только `notifiedAt`: начальник управления
    получает `FORCES_REQUEST` с цифрой раскладки и заявкой.

    Красная на мутации: убери вызов `notify_directorate_heads` из
    `notify_directorates` — строки не будет.
    """
    from organization_management.apps.operations.models import (
        Permission,
        Role,
        RolePermission,
        UserRole,
    )
    from organization_management.apps.operations.models_notification import OpsNotification
    from organization_management.apps.ops.forces_notify import SELECT_PERMISSION

    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-notify-heads", "DEPT_LEAD_N1", own.pk)
    head = django_user_model.objects.create_user(username="dir-head-n1", password="x")
    # 🔴 РОЛЬ НЕСЁТ ПРАВО ВЫДЕЛЯТЬ (Plane №481): рассылка идёт тем, кто МОЖЕТ
    # выполнить просьбу, а не всем с областью на управление. Раньше роли
    # хватало имени — и проба зеленела бы на дефекте, который №481 чинит.
    head_role = Role.objects.create(code="DIR_HEAD_N1", name="Начальник")
    Permission.objects.get_or_create(
        code=SELECT_PERMISSION, defaults={"name": "Статусы: управление"}
    )
    RolePermission.objects.create(
        role_code=head_role, permission_code_id=SELECT_PERMISSION
    )
    UserRole.objects.create(
        user_id=str(head.pk),
        role_code=head_role,
        scope_division_id=directorate.pk,
    )
    manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": 2}]},
        format="json",
    )

    resp = dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")

    assert resp.status_code == 200, resp.data
    row = OpsNotification.objects.get(recipient=str(head.pk), kind="FORCES_REQUEST")
    assert row.payload["allocationId"] == allocation_id
    assert row.payload["need"] == 2


def test_the_split_is_capped_by_the_department_answer_not_the_staff_request(manager):  # noqa: F811
    """Разбивка по управлениям — от «Выделяем»: ответил «2» при запросе «3» —
    разложить 3 нельзя, 2 можно."""
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-split-cap", "DEPT_LEAD_N2", own.pk)
    total = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1]).force_allocation[0]["need"]
    assert total >= 2, "фикстуре нужен запрос хотя бы на двоих"
    _respond(dept_lead, base, allocation_id, total - 1)

    over = manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": total}]},
        format="json",
    )
    fits = manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": total - 1}]},
        format="json",
    )

    assert over.status_code == 422
    assert over.json()["error_code"] == "DIRECTORATE_QUOTA_OVERFLOW"
    assert "Выделяем" in over.json()["message"]
    assert fits.status_code == 200, fits.data


# ── Запрос сил глазами управления (Plane №394, `[СБС-30]`) ───────────────────


def _split_first(manager, base, allocation_id, directorate, need=2):  # noqa: F811
    return manager.post(
        f"{base}forces/allocation/{allocation_id}/split/",
        {"rows": [{"divisionId": str(directorate.pk), "need": need}]},
        format="json",
    )


def _status_head(username, role_code, division):
    """Начальник управления ГЛАЗАМИ СТАТУСОВ: `status.manage` с областью на
    управление — ровно то, что есть у профилей заказчика (`forces.*` у них нет
    намеренно, и гейт баннера на `forces.select` отвечал бы им 403 — так и
    было на живом стенде)."""
    api, _ = client_for(
        username, role_code, perms=("status.view", "status.manage"), scope_division_id=division.pk
    )
    return api


def test_the_directorate_head_reads_his_own_row_of_the_request(manager):  # noqa: F811
    """Начальник управления (`status.manage` с областью на управление) видит
    СВОЮ строку заявки: цифру раскладки и сколько уже проставлено."""
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    make_directorate(own, "Управление А-2")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    head = _status_head("dir-head-reads", "DIR_HEAD_RQ1", first)

    resp = head.get(f"{URL}forces/requests/{allocation_id}/directorate/")

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["allocationId"] == allocation_id
    assert [row["name"] for row in body["directorates"]] == ["Управление А-1"]
    assert body["directorates"][0]["need"] == 2
    assert body["directorates"][0]["assigned"] == 0


def test_a_request_of_a_foreign_directorate_is_not_found(manager):  # noqa: F811
    """Чужая заявка — 404, не 403: существование чужой строки не
    подтверждается перебором идентификаторов."""
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    foreign_dep = make_department("Департамент Б")
    foreign_dir = make_directorate(foreign_dep, "Управление Б-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    stranger = _status_head("dir-head-foreign", "DIR_HEAD_RQ2", foreign_dir)

    assert stranger.get(f"{URL}forces/requests/{allocation_id}/directorate/").status_code == 404


def test_the_directorate_request_is_closed_without_status_manage():
    """`forces.select` БЕЗ `status.manage` — не пропуск: баннер про статусы."""
    api, _ = client_for("dir-head-noperm", "DIR_HEAD_RQ3", perms=("event.view", "forces.select"))

    assert api.get(f"{URL}forces/requests/whatever/directorate/").status_code == 403


# ── Выделение по запросу: чекбоксы → «Участие в ОМ» (Plane №395, `[СБС-31]`) ─


def test_the_head_selects_people_and_the_status_is_created_from_the_request(manager):  # noqa: F811
    """Начальник управления отмечает людей — статус привлечения ставится ИЗ
    ЗАЯВКИ (мероприятие и даты), человек становится выделенным.

    Красная на мутации: замени `add_allocation_member` на запись без статуса —
    статуса у сотрудника не будет.
    """
    from organization_management.apps.operations.models_status import OpsEmployeeStatus

    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Выделяемов")
    make_assignment_status_type()
    head = _status_head("dir-head-select", "DIR_HEAD_SEL1", first)

    resp = head.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(person.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["selected"] == [str(person.pk)]
    assert body["refused"] == []
    assert body["request"]["directorates"][0]["assigned"] == 1
    assert OpsEmployeeStatus.objects.filter(employee_id=person.pk).exists()


def test_selecting_builds_the_full_request_view_exactly_once(manager, monkeypatch):  # noqa: F811
    """Полный вид заявки собирается ОДИН раз на выделение (Plane №548).

    🔴 ЧТО СТЕРЕЖЁТСЯ. `select_for_request` звала `directorate_request_view`
    дважды: в начале — ради `eventId` и проверки области, в конце — ради
    свежей строки в ответе. Первый вызов собирал полный вид заявки (сведение
    людей из статусов и участий, живые подразделения через `StaffUnit` и
    `Division`, счёт «выделено N из M» по поддеревьям) ради ОДНОГО поля — и
    выбрасывал собранное: к моменту второго вызова состав уже другой, и
    сохранять первый ответ было бы нельзя даже при желании.

    Считается не время и не число запросов, а вызовы САМОЙ ДОРОГОЙ функции —
    `allocation_members_view`. Число запросов зависит от кэшей и состава
    стенда, а этот счётчик отвечает ровно на вопрос карточки: сколько раз мы
    собрали то, что нужно один раз.

    Красная на мутации «вернуть `directorate_request_view` в начало функции»:
    счётчик станет 2.
    """
    from organization_management.apps.ops import forces_requests, security_events

    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Считаемов")
    make_assignment_status_type()
    head = _status_head("dir-head-cost", "DIR_HEAD_COST", first)

    calls = []
    original = security_events.allocation_members_view
    monkeypatch.setattr(
        forces_requests,
        "allocation_members_view",
        lambda event: (calls.append(event.pk), original(event))[1],
    )

    resp = head.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(person.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    assert resp.json()["selected"] == [str(person.pk)]
    assert len(calls) == 1, (
        "полный вид заявки собран %d раз(а) вместо одного" % len(calls)
    )


def _soft_conflicting_status(employee, business_date="2026-08-10"):
    """Мягко конфликтующий статус на дату мероприятия.

    Тип НЕ из `HARD_STATUS_TYPE_CODES`: жёсткий отдал бы 422, который не
    обходится никогда, и проба проверяла бы не то. Дата — прошедшая
    относительно сегодня, чтобы пересечение не понизилось до необязывающего
    предупреждения правилом «PLANNED → warning».
    """
    from organization_management.apps.operations.models import StatusType
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
    )

    StatusType.objects.get_or_create(
        code="DUTY",
        defaults={"name": "Дежурство", "priority": 20, "report_column_code": "DUTY"},
    )
    # `date_end` СТРОГО больше `date_start` — этого требует `chk_status_dates`;
    # однодневный статус выражается следующим днём в конце.
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="DUTY",
        date_start=business_date,
        date_end="2026-08-12",
    )


def test_soft_conflict_at_selection_is_marked_overridable_and_passes_with_a_reason(
    manager,  # noqa: F811
):
    """Мягкий конфликт при выделении — не тупик (Plane №545).

    🔴 ЧТО БЫЛО. Докстринг обещал «обход по причине — тем же полем `override`,
    что у штаба», а ручка `override`/`override_reason` не принимала и в
    `add_allocation_member` не передавала. В `refused[]` не было признака
    «обходимо», поэтому экран не отличал мягкий конфликт от жёсткого.
    Начальник управления читал «не выделены: Иванов — статус пересекается» и
    не мог ни подтвердить, ни понять, подтверждаемо ли это вообще. Второго
    пути у него нет: ручной статус «Участие в ОМ» запрещён решением заказчика
    (№427), — то есть тупик был окончательным.

    Проба ведёт ровно этот путь: отказ, потом повтор с обоснованием.

    Красная на мутации «не передавать override в `add_allocation_member`»:
    второй вызов отобьётся тем же отказом.
    """
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Занятов")
    make_assignment_status_type()
    _soft_conflicting_status(person)
    head = _status_head("dir-head-soft", "DIR_HEAD_SOFT", first)
    url = f"{URL}forces/requests/{allocation_id}/directorate/select/"

    refused = head.post(url, {"employeeIds": [str(person.pk)]}, format="json")

    assert refused.status_code == 200, refused.data
    body = refused.json()
    assert body["selected"] == []
    assert len(body["refused"]) == 1, body
    row = body["refused"][0]
    assert row["code"] == "STATUS_OVERLAP_WARNING", row
    # 🔴 БЕЗ ЭТОГО ПОЛЯ экран не отличит мягкий отказ от жёсткого и предложит
    # обход либо всем, либо никому.
    assert row["overridable"] is True, row

    passed = head.post(
        url,
        {
            "employeeIds": [str(person.pk)],
            "override": True,
            "override_reason": "беру, несмотря на дежурство",
        },
        format="json",
    )

    assert passed.status_code == 200, passed.data
    assert passed.json()["selected"] == [str(person.pk)], passed.json()
    assert passed.json()["refused"] == []


def test_hard_conflict_at_selection_is_not_offered_an_override(manager):  # noqa: F811
    """Жёсткий отказ обходом НЕ помечается — обещать нечего (Plane №545).

    Признак `overridable` берётся у самого отказа, а не проставляется всем
    подряд: пометить жёсткий конфликт обходимым значило бы предложить человеку
    кнопку, после которой сервер откажет во второй раз с тем же текстом.
    """
    from organization_management.apps.operations.models import StatusType
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
    )

    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Отпускников")
    make_assignment_status_type()
    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"},
    )
    OpsEmployeeStatus.objects.create(
        employee_id=person.pk,
        status_type_code="VACATION",
        date_start="2026-08-10",
        date_end="2026-08-12",
    )
    head = _status_head("dir-head-hard", "DIR_HEAD_HARD", first)

    resp = head.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(person.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    row = resp.json()["refused"][0]
    assert row["code"] == "OVERLAPPING_HARD_STATUS", row
    assert row["overridable"] is False, row


def test_selection_refuses_a_person_no_directorate_row_will_ever_count(
    manager,  # noqa: F811
):
    """Выделять можно только тех, кого посчитает управление заявки (№550).

    🔴 ЧТО БЫЛО. Проверка области смотрела поддерево `status.manage`
    действующего и не сверялась со строками разнарядки. Действующий с областью
    на ДЕПАРТАМЕНТ проходил её на любом своём сотруднике — включая тех, кто
    не лежит НИ ПОД ОДНИМ управлением. Статус «Участие в ОМ» заводился
    настоящий, а `_with_directorate_progress` такого человека не считает
    никогда, и сам это оговаривает: «выдумывать ему управление значило бы
    записать его чужой квоте». Отчёт говорил «Выделено: 1», а прогресс
    управлений не двигался — и объяснить расхождение было нечем.

    🔴 ПОЧЕМУ ФИКСТУРА ИМЕННО ТАКАЯ (стоило одного прогона). Первая редакция
    брала СОСЕДНЕЕ управление того же департамента и была вакуумной: `split`
    заводит строку КАЖДОМУ действующему управлению департамента, в том числе с
    нулевой квотой, — такой человек как раз посчитается, просто в своей
    строке. По-настоящему невидим тот, кто числится в отделе, подчинённом
    департаменту НАПРЯМУЮ, минуя управления. Он и взят.

    Красная на снятии сверки: `selected` станет непустым, а прогресс
    управления останется нулевым.
    """
    from organization_management.apps.divisions.models import Division

    own = make_department("Департамент А")
    asked = make_directorate(own, "Управление А-1")
    # Отдел ПОД ДЕПАРТАМЕНТОМ, минуя управления: строки разнарядки ему не
    # достанется никогда — `split` заводит их только управлениям.
    aside = Division.objects.create(
        name="Отдел при департаменте",
        division_type=Division.DivisionType.DIVISION,
        parent=own,
    )
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, asked)
    outsider = employee_of(aside, "Мимокадров")
    make_assignment_status_type()
    # Область действующего — ДЕПАРТАМЕНТ: он видит и этот отдел, и старая
    # проверка на нём молчала.
    api, _ = client_for(
        "dept-head-select",
        "DEPT_HEAD_SEL",
        perms=("status.view", "status.manage"),
        scope_division_id=own.pk,
    )

    resp = api.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(outsider.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["selected"] == [], "выделен человек, которого прогресс не посчитает"
    assert len(body["refused"]) == 1, body
    assert body["refused"][0]["code"] == "PERMISSION_DENIED", body["refused"][0]
    # Обходом такое не лечится: заявка адресована управлениям, а он не под ними.
    assert body["refused"][0]["overridable"] is False, body["refused"][0]
    # Прогресс управления не сдвинулся — ровно то, ради чего гард и заведён.
    assert body["request"]["directorates"][0]["assigned"] == 0, body["request"]


def test_selection_still_passes_for_a_person_of_the_requested_directorate(
    manager,  # noqa: F811
):
    """Человек управления заявки по-прежнему выделяется — гард не запер работу.

    Без этой половины предыдущая проба доказывала бы лишь, что выделение
    сломано вообще, а не что сверка различает видимых прогрессу и невидимых.
    """
    own = make_department("Департамент А")
    asked = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, asked)
    insider = employee_of(asked, "Своев")
    make_assignment_status_type()
    api, _ = client_for(
        "dept-head-select-ok",
        "DEPT_HEAD_SEL_OK",
        perms=("status.view", "status.manage"),
        scope_division_id=own.pk,
    )

    resp = api.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(insider.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["selected"] == [str(insider.pk)], body
    assert body["request"]["directorates"][0]["assigned"] == 1, body["request"]


def test_a_stranger_in_the_list_is_refused_without_naming_him(manager):  # noqa: F811
    """Чужой сотрудник — отказ по строке, БЕЗ его фамилии; свои выделяются.

    🔴 ИМЯ ПРОБЫ ИЗМЕНЕНО ВМЕСТЕ С ПОВЕДЕНИЕМ (Plane №543). Раньше она
    называлась «…refused_by_name», и отказ действительно нёс фамилию — ровно
    обратное инварианту `employee_scope_division`: «существование сотрудника
    сознательно не подтверждается, иначе это перебор по кадрам». Начальнику
    управления довольно было прислать список идентификаторов, чтобы получить
    фамилии сотрудников чужих департаментов и узнать, какие идентификаторы
    существуют. Отказ по-прежнему адресный (по строке чекбокса), но человека
    не называет.
    """
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    second = make_directorate(own, "Управление А-2")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    mine = employee_of(first, "Свойов")
    stranger = employee_of(second, "Чужойов")
    make_assignment_status_type()
    head = _status_head("dir-head-select-2", "DIR_HEAD_SEL2", first)

    resp = head.post(
        f"{URL}forces/requests/{allocation_id}/directorate/select/",
        {"employeeIds": [str(mine.pk), str(stranger.pk)]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["selected"] == [str(mine.pk)]
    assert [r["employeeId"] for r in body["refused"]] == [str(stranger.pk)]
    assert body["refused"][0]["code"] == "PERMISSION_DENIED"
    # Фамилии чужого в ответе нет НИГДЕ — ни в подписи строки, ни в тексте.
    assert stranger.last_name not in json.dumps(body, ensure_ascii=False)
    assert body["refused"][0]["name"] == str(stranger.pk)


def test_employee_ids_must_be_a_list_of_scalars(manager):  # noqa: F811
    """Тело проверяется ДО работы: строка и словарь — 400 (Plane №544).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `employeeIds` уходил в цикл как есть, а строка `"18"`
    — это последовательность: цикл шёл ПО СИМВОЛАМ и выделял сотрудников 1 и
    8; словарь перебирался по ключам. Попади получившиеся идентификаторы в
    область актора — и сервер РЕАЛЬНО заводил статусы участия не тем людям,
    молча и без единого отказа в ответе.
    """
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Скалярнов")
    make_assignment_status_type()
    head = _status_head("dir-head-types", "DIR_HEAD_TYPES", first)
    url = f"{URL}forces/requests/{allocation_id}/directorate/select/"

    for payload in ({"employeeIds": "18"}, {"employeeIds": {"a": 1}},
                    {"employeeIds": [["18"]]}, {"employeeIds": [{"id": "18"}]}):
        refused = head.post(url, payload, format="json")
        assert refused.status_code == 400, (payload, refused.data)
        assert refused.json()["error_code"] == "VALIDATION_ERROR"

    # Пустое тело и пустой список — по-прежнему НЕ ошибка: «никого не отметил»
    # это законное состояние формы, а не опечатка в типе.
    for payload in ({}, {"employeeIds": []}, {"employeeIds": None}):
        empty = head.post(url, payload, format="json")
        assert empty.status_code == 200, (payload, empty.data)
        assert empty.json()["selected"] == []

    # И нормальный список работает как работал.
    ok = head.post(url, {"employeeIds": [str(person.pk)]}, format="json")
    assert ok.status_code == 200 and ok.json()["selected"] == [str(person.pk)]


def test_selecting_twice_reports_the_double_assignment_instead_of_failing(manager):  # noqa: F811
    """Повторное выделение того же человека — отказ по нему с причиной сервера
    (`DOUBLE_ASSIGNMENT`), а не 422 на весь запрос."""
    own = make_department("Департамент А")
    first = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    _split_first(manager, base, allocation_id, first)
    person = employee_of(first, "Дваждыов")
    make_assignment_status_type()
    head = _status_head("dir-head-select-3", "DIR_HEAD_SEL3", first)
    url = f"{URL}forces/requests/{allocation_id}/directorate/select/"
    head.post(url, {"employeeIds": [str(person.pk)]}, format="json")

    again = head.post(url, {"employeeIds": [str(person.pk)]}, format="json")

    assert again.status_code == 200
    assert again.json()["selected"] == []
    assert again.json()["refused"][0]["code"] == "DOUBLE_ASSIGNMENT"


def test_the_requests_list_carries_the_department_answer(manager):  # noqa: F811
    """Строка заявки несёт «выделяем» — ответ департамента (`[СБС-20]`,
    Plane №444): `None`, пока ответа нет, и цифру после него. Колонка
    «выделяем» экрана читает это поле, а не «собрано».

    Красная на мутации: убери ключ `allocating` из `department_requests_view`.
    """
    own = make_department("Департамент А")
    base, _ = allocated_event(manager, own)
    api = scoped_client("dep-a-answer", "DEP_A_ANS", own.pk)

    before = api.get(REQUESTS_URL).json()["results"]
    assert before, "заявки нет — проверять нечего"
    assert before[0]["allocating"] is None

    allocation_id = before[0]["allocationId"]
    assert _respond(manager, base, allocation_id, 3).status_code == 200

    after = api.get(REQUESTS_URL).json()["results"]
    assert after[0]["allocating"] == 3
    assert after[0]["assigned"] == 0, "«выделяем» и «собрано» — разные числа"


# ── Ревью a5348abf: отказ, возврат и разбивка (Plane №551, №552, №554) ──────


def _collection_status_of(manager, base):  # noqa: F811
    code = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1]).code
    return next(
        item
        for item in manager.get(COLLECTIONS_URL).data["results"]
        if item["code"] == code
    )["collectionStatus"]


def test_a_decline_on_a_never_dispatched_row_is_not_a_dispatch(manager):  # noqa: F811
    """🔴 Plane №551: доска штаба не рапортует о рассылке, которой не было.

    `_collection_status` считала разосланной ЛЮБУЮ строку не в черновике — в
    том числе отказ. А департамент видит в своём списке и черновые строки
    (`department_requests_view` фильтрует по области, а не по статусу) и,
    ответив «0» на нерассылавшуюся строку, переводил её в `DECLINED`. Доска
    сбора сил после этого утверждала «разнарядка разослана» о мероприятии,
    где рассылки не было вовсе.

    Мутация: вернуть условие `status != DRAFT` — статус станет `NOTIFIED`.
    """
    own = make_department("Департамент А")
    make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-decline-draft", "DEPT_LEAD_D1", own.pk)
    assert _collection_status_of(manager, base) == "NEW"

    declined = _respond(dept_lead, base, allocation_id, 0, "Все на объекте")

    assert _allocation(declined)["status"] == "DECLINED"
    assert _allocation(declined)["notifiedAt"] is None, (
        "рассылки не было — момента оповещения быть не должно"
    )
    assert _collection_status_of(manager, base) == "NEW", (
        "штабу доложили о разосланной разнарядке, которой не рассылали"
    )


def test_the_returned_state_survives_a_decline_and_a_change_of_mind(manager):  # noqa: F811
    """🔴 Plane №552: отзыв отказа возвращает то, что было, а не «оповещено».

    Штаб вернул сданный список с причиной (`RETURNED`) → департамент ответил
    «0» → передумал и ответил «2». Прежняя ветка восстанавливала статус «по
    факту оповещения» и теряла возврат НАВСЕГДА: баннер «Возвращено штабом»
    исчезал (хотя причина хранилась), реестр штаба переподписывал строку
    «Управления оповещены», а главное — строка теряла освобождение от
    просрочки и начинала копить `overdueCount` за задержку, которой
    департамент не делал.

    Мутация: убрать чтение `statusBeforeDecline` — статус вернётся `NOTIFIED`.
    """
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-decline-returned", "DEPT_LEAD_D2", own.pk)
    _split_first(manager, base, allocation_id, directorate, need=1)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")
    person = employee_of(directorate, "Возвращенов")
    make_assignment_status_type()
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(person.pk)},
        format="json",
    )
    assert dept_lead.post(f"{base}forces/allocation/{allocation_id}/submit/").status_code == 200
    returned = manager.post(
        f"{base}forces/allocation/{allocation_id}/return/",
        {"reason": "Не хватает одного"},
        format="json",
    )
    assert returned.status_code == 200, returned.content
    assert _allocation(returned)["status"] == "RETURNED"

    declined = _respond(dept_lead, base, allocation_id, 0, "Передумали")
    assert _allocation(declined)["status"] == "DECLINED"

    reopened = _respond(dept_lead, base, allocation_id, 2)

    row = _allocation(reopened)
    assert row["status"] == "RETURNED", "возврат штаба стёрт отзывом отказа"
    assert row["declinedAt"] is None
    assert row["decisionComment"] == "Не хватает одного"
    # Освобождение от просрочки держится статусом — и оно вернулось вместе с ним.
    assert row["overdue"] is False


def test_the_memory_of_the_state_before_a_decline_survives_a_staff_resave(manager):  # noqa: F811
    """Память о состоянии до отказа переживает пересохранение раскладки штабом.

    Строка раскладки пересобирается ЯВНЫМ перечнем ключей, и забытый ключ
    означает не «поле пустое», а «факт стёрт» — тем же правилом, что уже
    держат `submittedLate` и `allocating`. Без переноса `statusBeforeDecline`
    штаб, пересохранивший раскладку ради чужого `need`, уносил возврат.

    Мутация: убрать ключ `statusBeforeDecline` из `split_force_demand`.
    """
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-decline-resave", "DEPT_LEAD_D3", own.pk)
    _split_first(manager, base, allocation_id, directorate, need=1)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")
    person = employee_of(directorate, "Пересохраненов")
    make_assignment_status_type()
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(person.pk)},
        format="json",
    )
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/submit/")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/return/",
        {"reason": "Не хватает одного"},
        format="json",
    )
    _respond(dept_lead, base, allocation_id, 0, "Передумали")

    # Штаб трогает раскладку ради своего числа — ответ и память департамента
    # это пережить обязаны.
    need = _allocation(manager.get(base))["need"]
    resaved = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(own.pk), "need": need}]},
        format="json",
    )
    assert resaved.status_code == 200, resaved.data

    row = _allocation(_respond(dept_lead, base, allocation_id, 1))
    assert row["status"] == "RETURNED"


def test_a_decline_before_dispatch_keeps_the_directorate_split_editable(manager):  # noqa: F811
    """🔴 Plane №554: отказ до рассылки не запирает разбивку.

    Разбивка по управлениям запиралась условием `status != DRAFT`, и оно
    ловило заодно ОТКАЗ: департамент, ответивший «0» ещё до рассылки, терял
    форму целиком — поля квот гасли, кнопка «Отправить в управления»
    пропадала, а объяснение и на экране, и в ответе сервера называло причиной
    «управления уже запрошены», хотя ни одного не запрашивали.

    Мутация: вернуть условие `status != _ALLOCATION_DRAFT` — первый же `split`
    ниже отобьётся `DIRECTORATE_QUOTAS_LOCKED`.
    """
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("forces-decline-split", "DEPT_LEAD_D4", own.pk)
    assert _allocation(_respond(dept_lead, base, allocation_id, 0, "Пока никого"))["status"] == "DECLINED"

    # 🔴 СЕРДЦЕ ПРОБЫ: раскладка правится ПРЯМО В ОТКАЗЕ. Управлений никто не
    # звал, значит форма обязана быть живой — а прежнее условие гасило её
    # именно здесь, и вернуть её можно было только отзывом собственного
    # отказа, о котором экран не говорил.
    in_decline = _split_first(manager, base, allocation_id, directorate, need=0)
    assert in_decline.status_code == 200, in_decline.data

    # Передумали — форма по-прежнему живая.
    reopened = _respond(dept_lead, base, allocation_id, 1)
    assert _allocation(reopened)["status"] == _ALLOCATION_DRAFT_FOR_TESTS
    ok = _split_first(manager, base, allocation_id, directorate, need=1)
    assert ok.status_code == 200, ok.data

    # А после настоящей рассылки — запрет, как и обещает подпись.
    assert dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/").status_code == 200
    locked = _split_first(manager, base, allocation_id, directorate, need=1)
    assert locked.status_code == 422, locked.data
    assert locked.json()["error_code"] == "DIRECTORATE_QUOTAS_LOCKED"


#: Черновик строки раскладки — тот же литерал, что у сервера. Отдельным именем,
#: чтобы проба выше читалась как правило, а не как сравнение со строкой.
_ALLOCATION_DRAFT_FOR_TESTS = "DRAFT"
