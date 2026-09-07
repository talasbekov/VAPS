"""Сводные данные ГВО — из справочников (Plane №951, задача заказчика
07.09.2026).

Заказчик: «Состав ГВО должен выбираться из списка сотрудников. Машины тоже
должны подтягиваться со справочника транспортов. … Как добавить фото ОЛ? …
со справочника ОЛ нужно подтягивать ОЛ и здесь же должна быть кнопка добавить
ОЛ», и первым пунктом — «редактировать Бюллетень тем, у кого есть возможность
создавать бюллетень».

ЧТО БЫЛО. Лица и состав ГВО жили в сводке ТЕКСТОМ: «Фамилия | позывной |
роль», без ссылки на кадровую запись; лицо — снимком имени из бюллетеня, без
кода и фотографии (поля не было вовсе); справочник лиц правился только в
Django Admin. Сведения бюллетеня (`PATCH …/details/`), объекты посещения и
транспорт из реестра были закрыты правом `event.manage` — создатель бюллетеня
(`event.create`, `[БЛН-10]`) свой же бюллетень править не мог.

ЧТО СТАЛО. (1) У `OpsProtectedPerson` есть `photo`; `POST /protected-persons/`
заводит лицо с экрана, `POST /protected-persons/{id}/photo/` кладёт снимок;
каталог несёт `photoUrl`. (2) Участник состава с `employeeId` и лицо с
`personId` берут подпись из справочника при каждой сборке сводки. (3) База
сводки строит лица карточками справочника — главное первым. (4) Создатель ОМ
правит сведения бюллетеня, объекты и транспорт своего ОМ по роли в данных;
ответ мероприятия несёт `canEditBulletin` тем же правилом.

КРАСНАЯ ПРОБА: сними `_resolve_member` — красной станет проба про позывной из
кадров; сними `_CREATOR_ACTIONS` — красными станут пробы создателя; верни
`canEditBulletin` в «только право» — красной станет проба про флаг.
"""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventPerson,
)
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_vehicle import OpsVehicle
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

from .test_ops_gvo_api import GVO_URL, PERSONS_URL, _employee as make_employee, make_event

pytestmark = pytest.mark.django_db

EVENTS_URL = "/api/ops/security-events/"


@pytest.fixture(autouse=True)
def _media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


def creator(name="refs-creator"):
    """Персона `[БЛН-10]`: заводит бюллетень; `gvo.manage` и `event.manage`
    у неё нет."""
    return client_for(name, "BULLETIN_CREATOR", ["event.view", "event.create", "event.bulletin", "catalog.view"])


def staff(name="refs-staff"):
    api, _ = client_for(name, "STAFF", ["event.view", "gvo.manage", "catalog.view"])
    return api


def viewer(name="refs-viewer"):
    api, _ = client_for(name, "VIEWER", ["event.view", "catalog.view"])
    return api


def png(name="face.png"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 100, 50)).save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def own_event(user, code="ОМ-Т-951"):
    event = make_event(code)
    event.owner_actor_id = str(user.pk)
    event.save(update_fields=["owner_actor_id"])
    return event


# ── Справочник лиц: заведение и снимок ──────────────────────────────────────


def test_creating_a_person_from_the_screen():
    api, _ = creator()
    r = api.post(
        PERSONS_URL,
        {"name": "Яков Милатович", "category": "FOREIGN", "callsign": "", "bio": "Президент"},
        format="json",
    )
    assert r.status_code == 201, r.content
    row = r.json()
    assert row["name"] == "Яков Милатович"
    assert row["category"] == "FOREIGN"
    assert row["code"] == f"OL-{row['id']}"
    assert row["photoUrl"] is None
    listed = api.get(PERSONS_URL).json()["results"]
    assert any(p["id"] == row["id"] for p in listed)


def test_person_creation_validates_and_is_gated():
    api, _ = creator("refs-creator-2")
    bad = api.post(PERSONS_URL, {"name": " ", "category": "ALIEN"}, format="json")
    assert bad.status_code == 400
    detail = bad.json()["details"] if "details" in bad.json() else bad.json()
    assert "name" in str(detail) and "category" in str(detail)
    # Читатель справочника лица не заводит: кнопка — у тех, кто заполняет.
    assert viewer().post(PERSONS_URL, {"name": "X", "category": "OURS"}, format="json").status_code == 403


def test_uploading_a_photo_sets_photo_url():
    api, _ = creator("refs-photo")
    person = OpsProtectedPerson.objects.create(name="Оспанов Б.", category="OURS")
    r = api.post(f"{PERSONS_URL}{person.pk}/photo/", {"photo": png()}, format="multipart")
    assert r.status_code == 200, r.content
    url = r.json()["photoUrl"]
    assert url is not None and url.startswith("/media/protected-persons/photos/")
    person.refresh_from_db()
    assert person.photo
    listed = {p["id"]: p for p in api.get(PERSONS_URL).json()["results"]}
    assert listed[str(person.pk)]["photoUrl"] == url
    # Не картинка — отказ словами, а не 500 из Pillow.
    text = SimpleUploadedFile("x.txt", b"hello", content_type="text/plain")
    assert api.post(f"{PERSONS_URL}{person.pk}/photo/", {"photo": text}, format="multipart").status_code == 400
    assert api.post(f"{PERSONS_URL}999999/photo/", {"photo": png()}, format="multipart").status_code == 404


# ── База сводки: лица карточками справочника ────────────────────────────────


def test_derived_persons_come_from_the_catalog_main_first():
    api, user = creator("refs-derived")
    main = OpsProtectedPerson.objects.create(name="Яков Милатович", category="FOREIGN")
    other = OpsProtectedPerson.objects.create(name="Анна Петрова", category="FOREIGN")
    main.photo.save("m.png", png("m.png"), save=True)
    event = own_event(user, "ОМ-Т-952")
    event.protected_person = main
    event.protected_person_name = "Я. Милатович"  # снимок имени из бланка — главнее
    event.save(update_fields=["protected_person", "protected_person_name"])
    OpsSecurityEventPerson.objects.create(event=event, person=other)
    OpsSecurityEventPerson.objects.create(event=event, person=main)

    persons = api.get(f"{GVO_URL}ОМ-Т-952/").json()["summary"]["persons"]
    assert [p["name"] for p in persons] == ["Я. Милатович", "Анна Петрова"]
    assert persons[0]["personId"] == str(main.pk)
    assert persons[0]["code"] == main.display_code
    assert persons[0]["photoUrl"].startswith("/media/protected-persons/photos/")
    assert persons[1]["personId"] == str(other.pk)
    assert persons[1]["photoUrl"] is None


def test_person_in_patch_takes_code_and_photo_from_the_catalog():
    api, user = creator("refs-patch-person")
    person = OpsProtectedPerson.objects.create(name="Hassan Al-Farsi", category="FOREIGN")
    own_event(user, "ОМ-Т-953")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-953/",
        {
            "section": "persons",
            "values": {"persons": [{"personId": str(person.pk), "name": "", "role": "гость", "facts": []}]},
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    row = api.get(f"{GVO_URL}ОМ-Т-953/").json()["summary"]["persons"][0]
    assert row["name"] == "Hassan Al-Farsi"
    assert row["code"] == person.display_code
    assert row["role"] == "гость"


# ── Состав ГВО из кадрового списка ──────────────────────────────────────────


def test_member_with_employee_id_takes_name_and_callsign_from_personnel():
    api, user = creator("refs-member")
    employee = make_employee("Булатаев", "Ерлан")
    employee.callsign = "2-27"
    employee.save(update_fields=["callsign"])
    own_event(user, "ОМ-Т-954")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-954/",
        {
            "section": "groups",
            "values": {
                "groups": [
                    {
                        "name": "ГВО «Черногория»",
                        "members": [
                            {"employeeId": str(employee.pk), "name": "устарело", "callsign": "0-0", "role": "старший ГВО"},
                            {"name": "Байболов", "callsign": "7-41", "role": "прикреплённый"},
                        ],
                    }
                ]
            },
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    members = api.get(f"{GVO_URL}ОМ-Т-954/").json()["summary"]["groups"][0]["members"]
    # Ссылка — источник: фамилия и позывной из кадров, роль — из сводки.
    assert members[0] == {"employeeId": str(employee.pk), "name": "Булатаев Е.", "callsign": "2-27", "role": "старший ГВО"}
    # Строка без ссылки остаётся текстом, как набрана.
    assert members[1] == {"name": "Байболов", "callsign": "7-41", "role": "прикреплённый"}
    # Позывной сменили в кадрах — сводка видит новый без правки патча.
    employee.callsign = "2-28"
    employee.save(update_fields=["callsign"])
    assert api.get(f"{GVO_URL}ОМ-Т-954/").json()["summary"]["groups"][0]["members"][0]["callsign"] == "2-28"


# ── Создатель правит состав своего бюллетеня ────────────────────────────────


def test_creator_edits_bulletin_details_of_own_event_only():
    api, user = creator("refs-details")
    mine = own_event(user, "ОМ-Т-955")
    foreign = make_event("ОМ-Т-956")
    foreign.owner_actor_id = "someone-else"
    foreign.save(update_fields=["owner_actor_id"])

    ok = api.patch(f"{EVENTS_URL}{mine.pk}/details/", {"title": "Визит делегации"}, format="json")
    assert ok.status_code == 200, ok.content
    assert ok.json()["title"] == "Визит делегации"
    assert ok.json()["canEditBulletin"] is True
    assert api.patch(f"{EVENTS_URL}{foreign.pk}/details/", {"title": "Чужое"}, format="json").status_code == 403


def test_creator_allocates_a_vehicle_from_the_registry():
    api, user = creator("refs-vehicle")
    mine = own_event(user, "ОМ-Т-957")
    car = OpsVehicle.objects.create(brand="Mercedes-Benz S680", body_class="седан", plate="111 aa 01", armor_class="VR7")
    r = api.post(f"{EVENTS_URL}{mine.pk}/vehicles/", {"vehicleId": str(car.pk), "callsign": "VIP", "purpose": "основная"}, format="json")
    assert r.status_code == 201, r.content
    allocation = r.json()["vehicles"][0]
    assert allocation["label"].startswith("Mercedes-Benz")
    released = api.delete(f"{EVENTS_URL}{mine.pk}/vehicles/{allocation['id']}/")
    assert released.status_code in (200, 204), released.content


def test_can_edit_bulletin_flag_follows_the_gate():
    api, user = creator("refs-flag")
    mine = own_event(user, "ОМ-Т-958")
    other = make_event("ОМ-Т-959")
    assert api.get(f"{EVENTS_URL}{mine.pk}/").json()["canEditBulletin"] is True
    assert api.get(f"{EVENTS_URL}{other.pk}/").json()["canEditBulletin"] is False
    rows = {row["code"]: row for row in api.get(EVENTS_URL, {"page_size": 100}).json()["results"]}
    assert rows["ОМ-Т-958"]["canEditBulletin"] is True
    assert rows["ОМ-Т-959"]["canEditBulletin"] is False
    # Читатель — ни своего, ни чужого; ведущий — любой.
    assert viewer("refs-flag-viewer").get(f"{EVENTS_URL}{mine.pk}/").json()["canEditBulletin"] is False
    manager, _ = client_for("refs-flag-manager", "MANAGER", ["event.view", "event.manage"])
    assert manager.get(f"{EVENTS_URL}{other.pk}/").json()["canEditBulletin"] is True
