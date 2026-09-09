"""Восьмая персона (Plane №382): весь раздел ОМ на чтение + свой бюллетень.

Заказчик 02.09.2026: «У него права обычного сотрудника и еще все что касается
ОМ тоже видны, но без возможности редактирования или удаление. Но у него
должна быть возможность создавать бюллетень.»

До этой задачи заведение карточки, бюллетень и ВСЯ правка мероприятия жили под
одним `event.manage`, и такая персона не выражалась ничем. Пробы стерегут обе
половины требования на живых ручках, а не на списке кодов:

  1) под ролью каталога `EMPLOYEE_OPS_D2` POST реестра проходит и этап
     открывается (текст бюллетеня снят с проекта целиком, Plane №943/№950 —
     редактировать в нём больше нечего);
  2) правка мероприятия и удаление той же роли ОТБИВАЮТСЯ 403 — мутация
     «вернуть роли `event.manage`» краснит вторую пробу.
"""
import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_vehicle import OpsVehicle
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    make_employee,
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


def test_the_second_department_employee_creates_a_bulletin(employee_d2):
    resp = create_event(employee_d2)
    assert resp.status_code == 201, resp.content
    event = resp.json()
    assert event["stage"] == "BULLETIN"

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

    # Свой бюллетень: сведения можно. Объектами по последнему `[ОМ-РШ-06]`
    # управляет назначенный старший мероприятия, а не его создатель.
    assert employee_d2.patch(
        f"{base}details/", {"title": "Другое имя"}, format="json"
    ).status_code == 200
    assert employee_d2.post(
        f"{base}visit-objects/", {"objectId": str(obj.pk)}, format="json"
    ).status_code == 403
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


def bulletin_tree():
    department = Division.objects.create(
        name="Второй департамент",
        code="DEP-BULLETIN-SCOPE",
        division_type=Division.DivisionType.DEPARTMENT,
    )
    own = Division.objects.create(
        name="Первое управление",
        code="DIR-BULLETIN-OWN",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    sibling = Division.objects.create(
        name="Второе управление",
        code="DIR-BULLETIN-SIBLING",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    return department, own, sibling


def test_a_plain_bulletin_holder_cannot_complete_another_creators_bulletin():
    """Ломается, если переход к рекогносцировке остаётся обходом матрицы:
    это отдельная mutation-ручка, а не следствие запрета PATCH."""
    _, own, _ = bulletin_tree()
    creator, _ = client_for(
        "bulletin-complete-owner",
        "EMPLOYEE_OPS_D2",
        perms=("event.view", "event.create", "event.bulletin"),
        scope_division_id=own.pk,
    )
    another, _ = client_for(
        "bulletin-complete-other",
        "EMPLOYEE_OPS_D2",
        perms=("event.view", "event.create", "event.bulletin"),
        scope_division_id=own.pk,
    )
    event_id = create_event(creator, title="Чужое завершение").json()["id"]

    denied = another.post(f"{URL}{event_id}/bulletin/complete/", {}, format="json")

    assert denied.status_code == 403, denied.content


def test_ownership_does_not_replace_the_separate_bulletin_permission():
    """Ломается, если роль создателя обходит отзыв/отсутствие специально
    выделенного `event.bulletin` и тем самым склеивает его с `event.create`."""
    creator, _ = client_for(
        "bulletin-owner-without-editor",
        "EVENT_CREATOR_ONLY",
        perms=("event.view", "event.create"),
    )
    event_id = create_event(creator, title="Создано без права правки").json()["id"]

    denied = creator.patch(
        f"{URL}{event_id}/details/", {"title": "Обход права"}, format="json"
    )

    assert denied.status_code == 403, denied.content


def test_heads_edit_bulletins_only_inside_their_organizational_scope():
    """Ломается, если начальник не получает целевую правку `details` либо
    область его гранта перестаёт ограничивать чужое управление."""
    department, own, sibling = bulletin_tree()
    creator, _ = client_for(
        "bulletin-owner-for-head",
        "EMPLOYEE_OPS_D2",
        perms=("event.view", "event.create", "event.bulletin"),
        scope_division_id=own.pk,
    )
    event_id = create_event(creator, title="Бюллетень в области").json()["id"]
    own_head, _ = client_for(
        "bulletin-own-head",
        "HEAD_OPS_UNIT",
        perms=("event.view", "event.bulletin"),
        scope_division_id=own.pk,
    )
    department_head, _ = client_for(
        "bulletin-department-head",
        "HEAD_OPS_UNIT",
        perms=("event.view", "event.bulletin"),
        scope_division_id=department.pk,
    )
    sibling_head, _ = client_for(
        "bulletin-sibling-head",
        "HEAD_OPS_UNIT",
        perms=("event.view", "event.bulletin"),
        scope_division_id=sibling.pk,
    )

    for api, title in (
        (own_head, "Правка начальника управления"),
        (department_head, "Правка начальника департамента"),
    ):
        changed = api.patch(
            f"{URL}{event_id}/details/", {"title": title}, format="json"
        )
        assert changed.status_code == 200, changed.content

    denied = sibling_head.patch(
        f"{URL}{event_id}/details/", {"title": "Чужая область"}, format="json"
    )
    assert denied.status_code == 403, denied.content


def test_the_assigned_event_chief_completes_own_bulletin_without_a_bulletin_grant():
    """Ломается, если право старшего снова проверяется только кодом роли,
    хотя назначение старшего хранится в самом мероприятии.

    Правится ЗАВЕРШЕНИЕ бюллетеня (`bulletin/complete/`), а не текст —
    `PATCH .../bulletin/` снят вместе с полями текста (Plane №950), но гейт
    `_require_bulletin_editor` держит оба действия ОДНИМ правилом, и разбор
    старшего без кода роли остаётся актуальным для того, что осталось.
    """
    creator, _ = client_for(
        "bulletin-owner-for-chief",
        "BULLETIN_CREATOR",
        perms=("event.view", "event.create", "event.bulletin"),
    )
    event_id = create_event(creator, title="Бюллетень старшего").json()["id"]
    chief_api, chief_user = client_for(
        "bulletin-assigned-chief", "BULLETIN_READER", perms=("event.view",)
    )
    chief = make_employee(last_name="Старший", first_name="Наряда")
    chief.user = chief_user
    chief.save(update_fields=["user"])
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    OpsSecurityEvent.objects.filter(pk=event_id).update(
        chief_employee_id=chief.pk, chief_name="Старший Н."
    )

    completed = chief_api.post(f"{URL}{event_id}/bulletin/complete/")

    assert completed.status_code == 200, completed.content
    assert completed.json()["canEditBulletin"] is True


def test_scoped_head_registry_bulletin_policy_has_no_query_per_creator():
    """Ломается, если вычисление `canEditBulletin` заново читает роли или
    дерево подразделений для каждого отличающегося создателя строки."""
    department, own, _ = bulletin_tree()
    head, _ = client_for(
        "bulletin-query-head",
        "HEAD_OPS_UNIT",
        perms=("event.view", "event.bulletin"),
        scope_division_id=department.pk,
    )

    def add_event(index):
        creator, _ = client_for(
            f"bulletin-query-owner-{index}",
            "EMPLOYEE_OPS_D2",
            perms=("event.view", "event.create", "event.bulletin"),
            scope_division_id=own.pk,
        )
        response = create_event(creator, title=f"ОМ создателя {index}")
        assert response.status_code == 201, response.content

    def registry_query_count():
        with CaptureQueriesContext(connection) as captured:
            response = head.get(f"{URL}?page_size=50")
            assert response.status_code == 200, response.content
            assert all(row["canEditBulletin"] for row in response.json()["results"])
        return len(captured)

    add_event(1)
    one = registry_query_count()
    add_event(2)
    add_event(3)
    three = registry_query_count()

    assert three <= one, f"число запросов выросло вместе с создателями: {one} → {three}"


def test_create_only_owner_cannot_change_any_part_of_bulletin_composition():
    """Объекты и транспорт не обходят `[БЛН-14]` через старое creator-право."""
    creator, _ = client_for(
        "composition-owner-without-editor",
        "EVENT_CREATOR_ONLY",
        perms=("event.view", "event.create"),
    )
    event_id = create_event(creator, title="Состав без права").json()["id"]
    first_object = make_object(code="OBJ-COMPOSITION-1", name="Первый объект")
    second_object = make_object(code="OBJ-COMPOSITION-2", name="Второй объект")
    from organization_management.apps.ops import security_events as event_service
    from organization_management.apps.ops import vehicles as vehicles_service

    event_service.add_visit_object(event_id, object_id=first_object.pk)
    event = OpsSecurityEvent.objects.get(pk=event_id)
    visit_id = event.visit_objects.get(security_object=first_object).pk
    allocated_car = OpsVehicle.objects.create(
        brand="Toyota Land Cruiser 300",
        plate="980 aa 01",
        body_class="внедорожник",
        armor_class="VR7",
    )
    another_car = OpsVehicle.objects.create(
        brand="Mercedes-Benz S680",
        plate="981 aa 01",
        body_class="седан",
        armor_class="VR7",
    )
    vehicles_service.allocate_vehicle(event_id, vehicle_id=allocated_car.pk)
    allocation_id = event.vehicles.get(vehicle=allocated_car).pk
    base = f"{URL}{event_id}/"

    attempts = (
        creator.post(
            f"{base}visit-objects/",
            {"objectId": str(second_object.pk)},
            format="json",
        ),
        creator.patch(
            f"{base}visit-objects/{visit_id}/", {"note": "обход"}, format="json"
        ),
        creator.delete(f"{base}visit-objects/{visit_id}/"),
        creator.post(
            f"{base}vehicles/", {"vehicleId": str(another_car.pk)}, format="json"
        ),
        creator.delete(f"{base}vehicles/{allocation_id}/"),
    )

    assert [response.status_code for response in attempts] == [403] * 5
    event.refresh_from_db()
    assert event.visit_objects.filter(security_object=first_object, note="").exists()
    assert not event.visit_objects.filter(security_object=second_object).exists()
    assert event.vehicles.filter(pk=allocation_id).exists()
    assert not event.vehicles.filter(vehicle=another_car).exists()


def test_closed_event_reports_no_bulletin_edit_and_keeps_vehicle_history():
    """Закрытый ОМ не показывает возможность правки и не меняет транспорт."""
    manager, _ = client_for(
        "closed-composition-manager",
        "EVENT_MANAGER",
        perms=("event.view", "event.manage", "event.create", "event.bulletin"),
    )
    event_id = create_event(manager, title="Закрытый состав").json()["id"]
    from organization_management.apps.ops import vehicles as vehicles_service

    allocated_car = OpsVehicle.objects.create(
        brand="Toyota Camry",
        plate="982 aa 01",
        body_class="седан",
        armor_class="",
    )
    another_car = OpsVehicle.objects.create(
        brand="Kia Carnival",
        plate="983 aa 01",
        body_class="минивэн",
        armor_class="",
    )
    vehicles_service.allocate_vehicle(event_id, vehicle_id=allocated_car.pk)
    event = OpsSecurityEvent.objects.get(pk=event_id)
    allocation_id = event.vehicles.get(vehicle=allocated_car).pk
    OpsSecurityEvent.objects.filter(pk=event_id).update(stage="CLOSED")
    base = f"{URL}{event_id}/"

    card = manager.get(base)
    allocate = manager.post(
        f"{base}vehicles/", {"vehicleId": str(another_car.pk)}, format="json"
    )
    release = manager.delete(f"{base}vehicles/{allocation_id}/")

    assert card.status_code == 200, card.content
    assert card.json()["canEditBulletin"] is False
    assert allocate.status_code == 422, allocate.content
    assert release.status_code == 422, release.content
    event.refresh_from_db()
    assert event.vehicles.filter(pk=allocation_id).exists()
    assert not event.vehicles.filter(vehicle=another_car).exists()
