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
    """Заявка департаменту, ОПОВЕЩЁННАЯ по управлениям."""
    base, allocation_id = allocated_event(manager, department)
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
