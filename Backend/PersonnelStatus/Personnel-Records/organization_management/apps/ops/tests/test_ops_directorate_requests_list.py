"""Начальник управления видит СВОИ запросы списком (Plane №487).

Заказчик: «С модуля не ставятся статус Участие на ОМ». Разбор нашёл не одну
поломку, а отсутствующее звено.

Статус «Участие в ОМ» вручную не заводится вовсе — `_refuse_manual_
participation` отвечает 422 и отсылает к чекбоксам запроса (это решение
заказчика в №427, и оно остаётся в силе). Чекбоксы показывает баннер на
«Статусах сотрудников», а баннер выходит ТОЛЬКО когда в адресе есть
`?forcesRequest=<id>`. Кладёт этот параметр единственная ссылка — из
уведомления. Списка «что просят у МОЕГО управления» не существовало: реестр
заявок `forces/requests` гейтится `forces.allocate` (право ДЕПАРТАМЕНТА), а
начальник управления работает под `status.manage`.

Отсюда наблюдаемое: человек открывает раздел из меню, параметра нет, баннера
нет, руками статус не заводится — поставить его нечем. Уведомление же
доставляется не всегда (см. отдельные карточки про идемпотентность рассылки
по дню и про отсутствие фильтра прав у получателей), и тогда пути нет совсем.

Проба стережёт само звено: ручка списка, доступная по `status.manage`, отдаёт
запросы СВОЕГО управления и не отдаёт чужие.
"""
import pytest

from organization_management.apps.divisions.models import Division

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

#: Имя РАЗВЕДЕНО с `forces/requests/<id>`: иначе путь `forces/requests/
#: directorate/` съедается маршрутом одной заявки (`allocation_id =
#: "directorate"`) и отвечает 403 чужим правом — проверено первым прогоном
#: этой пробы.
LIST_URL = "/api/ops/security-events/forces/directorate-requests/"

#: Ровно право начальника управления и ничего сверх: если проба пройдёт на
#: наборе с `forces.allocate`, она перестанет отвечать на свой вопрос — тот
#: реестр департаменту доступен и без этой ручки.
DIRECTORATE_PERMISSIONS = ("event.view", "status.view", "status.manage")


def directorate_client(username, role_code, division_id):
    api, _ = client_for(
        username,
        role_code,
        perms=DIRECTORATE_PERMISSIONS,
        scope_division_id=division_id,
    )
    return api


def notified_request(manager, department):  # noqa: F811
    """Заявка департаменту, ОПОВЕЩЁННАЯ по управлениям.

    🔴 КВОТА УПРАВЛЕНИЮ ОБЯЗАТЕЛЬНА (Plane №557, найдено ревью №825). Раньше
    фикстура просто нажимала «Отправить в управления» без разбивки, и запрос
    считался разосланным ВСЕМ действующим управлениям — включая те, которым
    письма не уходило. Список запросов отбирает свои строки по `notifiedAt`
    (`_notified_mine`), и на этом «оповещении никого» держались обе пробы
    файла: они проверяли баннер запроса, которого управление не получало.
    Теперь момент ставит только состоявшаяся рассылка, и фикстура обязана
    разложить квоту — иначе просить некого и списку неоткуда взяться.
    """
    base, allocation_id = allocated_event(manager, department)
    mine = list(
        Division.objects.filter(
            parent_id=department.pk,
            division_type=Division.DivisionType.DIRECTORATE,
            is_active=True,
        )
    )
    if mine:
        split = manager.post(
            f"{base}forces/allocation/{allocation_id}/split/",
            {"rows": [{"divisionId": str(mine[0].pk), "need": 1}]},
            format="json",
        )
        assert split.status_code == 200, split.content
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    return allocation_id


def test_directorate_lead_lists_own_request_without_a_notification_link(
    manager,  # noqa: F811
):
    """Свой оповещённый запрос виден списком — без `?forcesRequest` из письма."""
    department = make_department("Департамент А")
    mine = make_directorate(department, "Управление А-1")
    allocation_id = notified_request(manager, department)

    lead = directorate_client("dir-lead-own", "DIR_LEAD_A1", mine.pk)
    resp = lead.get(LIST_URL)

    assert resp.status_code == 200, resp.content
    rows = resp.json()["results"]
    assert [row["allocationId"] for row in rows] == [allocation_id]
    assert [item["name"] for item in rows[0]["directorates"]] == [mine.name]


def test_foreign_directorate_request_does_not_arrive(manager):  # noqa: F811
    """Запрос ЧУЖОГО департамента не приезжает вовсе, а не прячется на клиенте."""
    foreign = make_department("Департамент Б")
    make_directorate(foreign, "Управление Б-1")
    notified_request(manager, foreign)

    own = make_department("Департамент А")
    mine = make_directorate(own, "Управление А-1")
    lead = directorate_client("dir-lead-foreign", "DIR_LEAD_A2", mine.pk)

    resp = lead.get(LIST_URL)

    assert resp.status_code == 200, resp.content
    assert resp.json()["results"] == []


def _allocated_event(code, department, directorate, business_date="2026-08-10"):
    """ОМ с ОПОВЕЩЁННОЙ заявкой одному департаменту — прямо в базу.

    Через ручки такое мероприятие не завести пачкой: `event_on_demand` создаёт
    объект с фиксированным кодом `OBJ-1` и второй вызов падает на уникальном
    ключе. Здесь предмет пробы — ЦЕНА ЧТЕНИЯ по числу мероприятий, поэтому
    заявка кладётся тем же составом ключей, который пишет
    `save_force_allocation` + `notify`.
    """
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )

    return OpsSecurityEvent.objects.create(
        code=code,
        title="Визит",
        object_name="Объект",
        business_date=business_date,
        stage=OpsSecurityEvent.Stage.PLACEMENT,
        readiness_percent=0,
        force_need=4,
        conflicts_count=0,
        owner_name="Тест",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=True,
        force_requests=[],
        force_allocation=[
            {
                "id": f"alloc-{code}",
                "departmentId": str(department.pk),
                "departmentName": department.name,
                "need": 4,
                "status": "NOTIFIED",
                "comment": "",
                "dueAt": "2026-08-09T12:00:00+00:00",
                "notifiedAt": "2026-08-08T12:00:00+00:00",
                "submittedAt": None,
                "submittedLate": False,
                "decidedAt": None,
                "decisionComment": "",
                "directorates": [
                    {
                        "divisionId": str(directorate.pk),
                        "name": directorate.name,
                        "need": 4,
                        "notifiedAt": "2026-08-08T12:00:00+00:00",
                    }
                ],
                "members": [],
                "allocating": None,
                "answerComment": "",
                "declinedAt": None,
            }
        ],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def test_foreign_events_do_not_cost_a_query_each():
    """Чужие мероприятия не оплачиваются запросами (Plane №756).

    🔴 ЧТО СТЕРЕЖЁТ ПРОБА. Ручка перебирала ВСЕ мероприятия с разнарядкой и на
    каждом собирала полный вид заявки — со сведением людей из статусов и
    участий, походом в `StaffUnit` и `Division` за живыми подразделениями и
    счётом «выделено N из M» по поддеревьям. Пока список выходил только по
    `?forcesRequest=` из письма, это платилось изредка; с №487 он платится на
    ЛЮБОМ открытии «Статусов сотрудников» — одного из самых частых экранов.

    Мероприятие чужого департамента отбрасывается по сырому JSON: `divisionId`
    и `notifiedAt` строки управления сведение со статусами не меняет и новых
    строк управлений не добавляет. Значит цена ответа не должна расти с числом
    ЧУЖИХ мероприятий вовсе.

    Сравниваются два одинаковых вопроса — при одном чужом ОМ и при пяти: число
    запросов ОБЯЗАНО совпасть. На мутации «убрать дешёвый отбор» каждое
    следующее чужое мероприятие снова стоит запросов, и равенство ломается.
    """
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from organization_management.apps.ops.forces_requests import (
        directorate_requests_view,
    )

    own = make_department("Департамент А")
    mine = make_directorate(own, "Управление А-1")
    _allocated_event("ОМ-Ц-1", own, mine)

    foreign = make_department("Департамент Б")
    theirs = make_directorate(foreign, "Управление Б-1")
    _allocated_event("ОМ-Ц-2", foreign, theirs)

    scope = {mine.pk}
    with CaptureQueriesContext(connection) as few:
        assert len(directorate_requests_view(scope)) == 1

    for index in range(3, 7):
        _allocated_event(f"ОМ-Ц-{index}", foreign, theirs)

    with CaptureQueriesContext(connection) as many:
        assert len(directorate_requests_view(scope)) == 1

    assert len(many) == len(few), (
        "цена ответа выросла с числом ЧУЖИХ мероприятий: "
        f"{len(few)} → {len(many)} запросов"
    )
