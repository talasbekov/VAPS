"""Редактор сводки ГВО правит её состав целиком (Plane №964, задача заказчика
07.09.2026).

Заказчик под `acc_dir_head_d2` (роль штаба `HEAD_OPS_UNIT` с `gvo.manage`, без
`event.manage`) четырежды нажимал «выделить машину» на визите иностранного ОЛ
и четырежды получал 403: «этот пользователь должен уметь редактировать или
добавлять какую то информацию в сводные данные».

ЧТО БЫЛО. Панель сводки ГВО рисовала кнопки «Выделить машину» и «Добавить
объект» по слову сервера `canEdit` (право `gvo.manage`, старший ГВО или
создатель ОМ, Plane №947), а ручки, которые эти кнопки зовут, — транспорт на
мероприятие и объекты посещения — жили в карте прав вьюсета ОМ под
`event.manage` с обходом только для создателя (№951). Два правила на одно
действие: кнопка видна, нажатие отбито, а тост звал «попробовать ещё раз».

ЧТО СТАЛО. Действия состава сводки (`_GVO_EDITOR_ACTIONS`) открываются ТЕМ ЖЕ
правилом, что правка самой сводки: `gvo.manage` по коду, старший ГВО и
создатель — по роли в данных. Только у визита иностранного ОЛ: у внутреннего
ОМ сводки нет, и `gvo.manage` там ничего не открывает.

КРАСНАЯ ПРОБА: сними `_GVO_EDITOR_ACTIONS` из `permission_override` — красными
станут пробы штаба и старшего; убери проверку `kind` — красной станет проба
про внутреннее ОМ.
"""
import pytest

from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_vehicle import OpsVehicle
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

from .test_ops_gvo_api import _employee, make_event

pytestmark = pytest.mark.django_db

EVENTS_URL = "/api/ops/security-events/"


def staff(name):
    """Штаб по матрице заказчика (№348): `gvo.manage` есть, `event.manage` нет."""
    return client_for(name, "STAFF_GVO", ["event.view", "gvo.manage", "catalog.view"])


def make_object(code="OBJ-964"):
    return OpsSecurityObject.objects.create(
        name="Резиденция",
        code=code,
        object_type="Госучреждение",
        region="г. Астана",
        address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )


def make_car(plate="964 aa 01"):
    return OpsVehicle.objects.create(
        brand="Mercedes-Benz S680", body_class="седан", plate=plate, armor_class="VR7"
    )


def test_gvo_manager_allocates_and_releases_a_vehicle_of_a_foreign_visit():
    api, _ = staff("gvo-staff-vehicle")
    event = make_event("ОМ-Т-964")
    car = make_car()

    r = api.post(
        f"{EVENTS_URL}{event.pk}/vehicles/",
        {"vehicleId": str(car.pk), "callsign": "VIP", "purpose": "основная"},
        format="json",
    )
    assert r.status_code == 201, r.content
    allocation = r.json()["vehicles"][0]
    released = api.delete(f"{EVENTS_URL}{event.pk}/vehicles/{allocation['id']}/")
    assert released.status_code in (200, 204), released.content


def test_gvo_manager_adds_a_visit_object_of_a_foreign_visit():
    api, _ = staff("gvo-staff-object")
    event = make_event("ОМ-Т-965")
    obj = make_object("OBJ-965")

    r = api.post(
        f"{EVENTS_URL}{event.pk}/visit-objects/", {"objectId": str(obj.pk)}, format="json"
    )
    assert r.status_code in (200, 201), r.content


def test_gvo_manager_edits_and_removes_a_visit_object_of_a_foreign_visit():
    """Правка и удаление объекта посещения — тем же правилом (`visit_object_detail`).

    Именно на правке дня объекта заказчик получал один из 403 (№964); проба
    добавлена по ревью №825: без неё мутация «убрать `visit_object_detail`
    из `_GVO_EDITOR_ACTIONS`» оставалась зелёной.
    """
    api, _ = staff("gvo-staff-object-edit")
    event = make_event("ОМ-Т-966")
    obj = make_object("OBJ-966")
    created = api.post(
        f"{EVENTS_URL}{event.pk}/visit-objects/", {"objectId": str(obj.pk)}, format="json"
    )
    assert created.status_code == 201, created.content
    # Ручка отвечает целым мероприятием; объект посещения — в его списке.
    visit = next(
        row for row in created.json()["visitObjects"] if str(row["objectId"]) == str(obj.pk)
    )
    visit_id = visit["id"]

    edited = api.patch(
        f"{EVENTS_URL}{event.pk}/visit-objects/{visit_id}/",
        {"note": "Проверить въезд"},
        format="json",
    )
    assert edited.status_code == 200, edited.content

    removed = api.delete(f"{EVENTS_URL}{event.pk}/visit-objects/{visit_id}/")
    assert removed.status_code in (200, 204), removed.content


def test_gvo_manage_opens_nothing_on_an_internal_event():
    """У внутреннего ОМ сводки ГВО нет — право на сводку туда не переносится."""
    api, _ = staff("gvo-staff-internal")
    event = make_event("ОМ-Т-966")
    event.kind = "INTERNAL"
    event.save(update_fields=["kind"])
    car = make_car("966 aa 01")

    r = api.post(
        f"{EVENTS_URL}{event.pk}/vehicles/", {"vehicleId": str(car.pk)}, format="json"
    )
    assert r.status_code == 403, r.content


def test_event_chief_allocates_a_vehicle_of_own_visit_only():
    """Старший ГВО — по роли в данных, без кода права; чужой визит закрыт."""
    chief = _employee()
    mine = make_event("ОМ-Т-967")
    mine.chief_employee_id = chief.pk
    mine.save(update_fields=["chief_employee_id"])
    foreign = make_event("ОМ-Т-968")

    api, user = client_for("gvo-chief-vehicle", "VIEWER", ["event.view"])
    chief.user = user
    chief.save(update_fields=["user"])

    ok = api.post(
        f"{EVENTS_URL}{mine.pk}/vehicles/", {"vehicleId": str(make_car("967 aa 01").pk)},
        format="json",
    )
    assert ok.status_code == 201, ok.content
    denied = api.post(
        f"{EVENTS_URL}{foreign.pk}/vehicles/", {"vehicleId": str(make_car("968 aa 01").pk)},
        format="json",
    )
    assert denied.status_code == 403, denied.content


def test_plain_viewer_is_still_denied():
    api, _ = client_for("gvo-viewer-964", "VIEWER", ["event.view"])
    event = make_event("ОМ-Т-969")
    r = api.post(
        f"{EVENTS_URL}{event.pk}/vehicles/", {"vehicleId": str(make_car("969 aa 01").pk)},
        format="json",
    )
    assert r.status_code == 403, r.content
