"""Восьмая персона (Plane №382): весь раздел ОМ на чтение + свой бюллетень.

Заказчик 02.09.2026: «У него права обычного сотрудника и еще все что касается
ОМ тоже видны, но без возможности редактирования или удаление. Но у него
должна быть возможность создавать бюллетень.»

До этой задачи заведение карточки, бюллетень и ВСЯ правка мероприятия жили под
одним `event.manage`, и такая персона не выражалась ничем. Пробы стерегут обе
половины требования на живых ручках, а не на списке кодов:

  1) под ролью каталога `EMPLOYEE_OPS_D2` POST реестра проходит, бюллетень
     правится и этап открывается;
  2) правка мероприятия и удаление той же роли ОТБИВАЮТСЯ 403 — мутация
     «вернуть роли `event.manage`» краснит вторую пробу;
  3) ведущий мероприятие (`EVENT_OFFICER` из каталога) ничего не потерял —
     разделение прав не должно было отнять у него заведение бюллетеня.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def make_object(code="OBJ-D2", name="Резиденция"):
    return OpsSecurityObject.objects.create(
        name=name,
        code=code,
        object_type="Госучреждение",
        region="г. Астана",
        address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )


def create_event(api, title="Визит делегации", object_id=None):
    """ОМ БЕЗ объекта: с объектом карточка сразу уезжает на рекогносцировку
    (Plane «Реестр ОМ-5»), а проверять надо именно стадию «Бюллетень»."""
    payload = {"title": title, "businessDate": "2026-09-10", "kind": "INTERNAL"}
    if object_id is not None:
        payload["objectId"] = str(object_id)
    return api.post(URL, payload, format="json")


@pytest.fixture
def catalog():
    """Роли берутся из НАСТОЯЩЕГО каталога, а не собираются в фикстуре.

    Смысл пробы — «персона заказчика умеет ровно это»; синтетическая роль
    отвечала бы на другой вопрос и осталась бы зелёной, даже если раскладку в
    `seed_operations` испортить.
    """
    call_command("seed_operations")


@pytest.fixture
def employee_d2(catalog):
    api, _ = client_for("d2-employee", "EMPLOYEE_OPS_D2")
    return api


@pytest.fixture
def event_officer(catalog):
    api, _ = client_for("d2-officer", "EVENT_OFFICER")
    return api


def test_the_second_department_employee_creates_and_fills_a_bulletin(employee_d2):
    resp = create_event(employee_d2)
    assert resp.status_code == 201, resp.content
    event = resp.json()
    assert event["stage"] == "BULLETIN"

    base = f"{URL}{event['id']}/"
    filled = employee_d2.patch(
        f"{base}bulletin/",
        {"briefDescription": "Прибытие делегации", "initialTasks": "Осмотр"},
        format="json",
    )
    assert filled.status_code == 200, filled.content
    assert filled.json()["briefDescription"] == "Прибытие делегации"

    # Реестр он тоже видит — это и есть «всё что касается ОМ видно».
    assert employee_d2.get(URL).status_code == 200


def test_the_same_employee_may_not_edit_or_delete_the_event(employee_d2):
    """🔴 Красная половина: верните роли `event.manage` — и она покраснеет.

    Проверяются РАЗНЫЕ виды правки, а не одна ручка: заказчик запретил
    редактирование и удаление целиком, и каждая из этих ручек вернула бы
    запрет с другой стороны.

    УТОЧНЕНО 07.09.2026 (Plane №951): «добавить возможность редактировать
    Бюллетень тем, у кого есть возможность создавать бюллетень». Сведения
    бюллетеня и объекты посещения СВОЕГО ОМ создатель теперь правит по роли
    в данных — здесь это ветка «свой ОМ» ниже; чужой ОМ, переходы этапов,
    закрытие и удаление остаются под запретом, и их пробы не менялись.
    """
    event_id = create_event(employee_d2).json()["id"]
    base = f"{URL}{event_id}/"
    obj = make_object()

    # Свой бюллетень (Plane №951): сведения и объект посещения — можно.
    assert employee_d2.patch(
        f"{base}details/", {"title": "Другое имя"}, format="json"
    ).status_code == 200
    assert employee_d2.post(
        f"{base}visit-objects/", {"objectId": str(obj.pk)}, format="json"
    ).status_code in (200, 201)
    # Чужой ОМ — по-прежнему 403: «я где-то создатель» права на соседний не даёт.
    other = create_event(employee_d2, title="Чужое ОМ").json()["id"]
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    OpsSecurityEvent.objects.filter(pk=other).update(owner_actor_id="someone-else")
    assert employee_d2.patch(
        f"{URL}{other}/details/", {"title": "Другое имя"}, format="json"
    ).status_code == 403
    assert employee_d2.post(f"{base}placement/complete/").status_code == 403
    assert employee_d2.post(f"{base}approval/send/").status_code == 403
    assert employee_d2.post(f"{base}close/").status_code == 403
    assert employee_d2.delete(base).status_code == 403


def test_the_event_officer_kept_what_he_could_do_before(event_officer):
    """Разделение прав — расширение, а не отъём: ведущий мероприятие заводил
    и заполнял бюллетень одним `event.manage`, и обязан уметь это дальше."""
    resp = create_event(event_officer, title="ОМ офицера")
    assert resp.status_code == 201, resp.content

    base = f"{URL}{resp.json()['id']}/"
    assert event_officer.patch(
        f"{base}bulletin/",
        {"briefDescription": "текст", "initialTasks": "задачи"},
        format="json",
    ).status_code == 200
