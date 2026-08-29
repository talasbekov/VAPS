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
    "event.manage",
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
    assert event.chief_employee_id is None, "фикстура уже назвала старшего — проверять нечего"
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
            status_type_code="EVENT_ASSIGNMENT",
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
