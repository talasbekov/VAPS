"""Штаб второго департамента — права по всей цепочке одним сидом (Plane №421).

Ш-5 плана P2: аудит ОМ №384 нашёл отсутствие прав у `HEAD_OPS_UNIT` в четырёх
местах — заведение ОМ и бюллетень (`[БЛН-10]`), расстановка на любом объекте
(`[РАС-08]` «штаб — всё»), сводка визита (`[ГВО-09]` «штаб правит,
утверждает»), заявки (`[СБС-10]`). Причина одна — сид ролей — и шаг один.

Роль берётся из НАСТОЯЩЕГО каталога (`seed_operations`), а не собирается в
фикстуре: проба отвечает «персона заказчика умеет ровно это», и мутация
раскладки в сиде обязана её красить.

`forces.command` штабу НЕ выдан: матрица заказчика №348 назвала «Сбор сил»
недоступным начальнику второго департамента, а спецификация `[СБС-10]` отдаёт
заявки ему — конфликт двух решений задан вопросом в карточке. Проба это
стережёт: появится право без ответа заказчика — красна.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_gvo_api import (
    GVO_URL,
    make_event as make_gvo_event,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)
from organization_management.apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def staff():
    call_command("seed_operations")
    api, _ = client_for("d2-staff", "HEAD_OPS_UNIT")
    return api


def test_the_staff_creates_an_event_and_fills_the_bulletin(staff):
    created = staff.post(
        URL,
        {"title": "Визит делегации", "businessDate": "2026-09-12", "kind": "INTERNAL"},
        format="json",
    )
    assert created.status_code == 201, created.content
    base = f"{URL}{created.json()['id']}/"
    filled = staff.patch(
        f"{base}bulletin/",
        {"briefDescription": "Штаб завёл", "initialTasks": "—"},
        format="json",
    )
    assert filled.status_code == 200, filled.content


def test_the_staff_places_people_on_an_object_it_does_not_lead(manager, staff):  # noqa: F811
    """`[РАС-08]`: старший объекта — всё, штаб — всё. Старший здесь ДРУГОЙ
    человек, и без `placement.command` штаб отбивался бы проверкой «своё ли»."""
    obj = make_object(with_passport=True)
    chief = make_employee(last_name="Старшов")
    assignee = make_employee(last_name="Назначаемый")
    data = create_event(manager, obj).json()
    base = f"{URL}{data['id']}/"
    visit_id = data["visitObjects"][0]["id"]
    manager.post(
        f"{base}visit-objects/{visit_id}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    post_id = manager.post(f"{base}recon/import-from-passport/").json()[
        "reconSectorPosts"
    ][0]["id"]

    ok = staff.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(assignee.pk)},
        format="json",
    )
    assert ok.status_code == 200, ok.content

    # Тот, кто умеет расставлять, но не штаб и не старший, — по-прежнему 403:
    # `placement.command` — отдельный код, а не ослабление проверки для всех.
    lead, _ = client_for("other-lead", "PATROL_LEAD")
    denied = lead.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(assignee.pk)},
        format="json",
    )
    assert denied.status_code == 403, denied.content


def test_the_staff_edits_the_visit_summary_of_any_event(staff):
    make_gvo_event("ОМ-Т-31")
    r = staff.patch(
        f"{GVO_URL}ОМ-Т-31/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert r.status_code == 200, r.content
    assert r.json()["patch"]["country"] == "Черногория"


def test_forces_command_is_not_granted_until_the_customer_answers(staff):
    codes = set(RoleAdminService.role_permission_codes("HEAD_OPS_UNIT"))
    assert {"event.create", "event.bulletin", "placement.manage",
            "placement.command", "gvo.manage"} <= codes
    assert not codes & {"forces.command", "forces.allocate", "forces.select"}, (
        "«Сбор сил» штабу — открытый вопрос заказчику (№421), право не выдаётся молча"
    )
