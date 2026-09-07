"""Сводные данные ГВО: страна из карточки ОЛ, старший ГВО отдельно от
ответственного (Plane №952, задача заказчика 07.09.2026).

Заказчик: «Страна должна подтягиваться с данных ОЛ … ОЛ должен иметь все
данные, которые я предоставил. … нет возможности назначить старшего ГВО …
после ответственного за ГВО сделать старший ГВО, и обе должны выбираться со
списка сотрудников».

ЧТО БЫЛО. У записи справочника лиц были имя, позывной, категория, биография и
снимок — ни страны, ни должности, ни данных образца («Группа крови = …»);
всё это набиралось текстом в карточке сводки при каждом ОМ, а «Страна»
сводки вписывалась руками отдельно. В сводке был один человек —
`responsible` из ведущего бюллетеня, подписанный в обязательных полях как
«Старший ГВО»: назначить старшего было негде.

ЧТО СТАЛО. (1) `OpsProtectedPerson.country/position/facts`; каталог и
`POST /protected-persons/` их несут. (2) База сводки: `country` — из главного
лица, карточка лица — с должностью и данными записи; лицо из патча без
должности/данных получает их из записи. (3) `senior` — отдельный ключ патча
и обязательное поле «Старший ГВО»; база — старший мероприятия из бюллетеня;
выбор старшего с `employeeId` переписывает `chief_employee_id` мероприятия
(права старшего на сводку считаются по нему).

КРАСНАЯ ПРОБА: верни `"country": ""` в `derive_summary` — красной станет
проба про страну; сними `_sync_senior_to_event` — красной станет проба про
`chief_employee_id`; верни `("responsible", "Старший ГВО")` — красной станет
проба про подписи обязательных полей.
"""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.ops import gvo as gvo_service

from .test_ops_gvo_api import GVO_URL, PERSONS_URL, _employee as make_employee, make_event, manager, viewer

pytestmark = pytest.mark.django_db

FACTS = [
    {"key": "Группа крови", "value": "А (II) Rh +"},
    {"key": "Рост", "value": "185 см"},
]


def person(**extra):
    return OpsProtectedPerson.objects.create(
        name="Яков Милатович",
        category="FOREIGN",
        country="Черногория",
        position="Президент Черногории",
        facts=FACTS,
        **extra,
    )


# ── Справочник несёт данные образца ─────────────────────────────────────────


def test_catalog_row_carries_country_position_and_facts():
    api = viewer("sc-catalog")
    record = person()
    row = {p["id"]: p for p in api.get(PERSONS_URL).json()["results"]}[str(record.pk)]
    assert row["country"] == "Черногория"
    assert row["position"] == "Президент Черногории"
    assert row["facts"] == FACTS


def test_creating_a_person_with_sample_data():
    # Заводит лицо тот, кто заполняет сводку; каталог читается под `catalog.view`.
    api, _ = manager("sc-create")
    r = api.post(
        PERSONS_URL,
        {
            "name": "Милена Милатович",
            "category": "FOREIGN",
            "country": "Черногория",
            "position": "Супруга Президента Черногории",
            "facts": [{"key": "Размер обуви", "value": "39"}, {"key": "", "value": ""}],
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    assert r.json()["country"] == "Черногория"
    assert r.json()["position"] == "Супруга Президента Черногории"
    # Пустая строка данных отброшена, а не сохранена мусором.
    assert r.json()["facts"] == [{"key": "Размер обуви", "value": "39"}]
    # Строка без названия параметра — отказ по полю, а не молчаливая запись.
    bad = api.post(
        PERSONS_URL,
        {"name": "X", "category": "OURS", "facts": [{"key": "", "value": "что-то"}]},
        format="json",
    )
    assert bad.status_code == 400
    assert "facts" in str(bad.json())


# ── База сводки: страна и данные из карточки лица ───────────────────────────


def test_summary_country_and_person_data_come_from_the_main_person():
    api, _ = manager("sc-derived")
    record = person()
    event = make_event("ОМ-Т-9520")
    event.protected_person = record
    event.save(update_fields=["protected_person"])
    summary = api.get(f"{GVO_URL}ОМ-Т-9520/").json()["summary"]
    assert summary["country"] == "Черногория"
    card = summary["persons"][0]
    assert card["role"] == "Президент Черногории"
    assert card["facts"] == FACTS
    # Страна из карточки — база, а не приговор: правка руками её перекрывает.
    r = api.patch(
        f"{GVO_URL}ОМ-Т-9520/",
        {"section": "head", "values": {"country": "Сербия"}},
        format="json",
    )
    assert r.status_code == 200, r.content
    assert api.get(f"{GVO_URL}ОМ-Т-9520/").json()["summary"]["country"] == "Сербия"


def test_person_from_patch_without_role_takes_position_and_facts_from_record():
    api, _ = manager("sc-patch")
    record = person()
    make_event("ОМ-Т-9521")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-9521/",
        {
            "section": "persons",
            "values": {"persons": [{"personId": str(record.pk), "name": "", "role": "", "facts": []}]},
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    card = api.get(f"{GVO_URL}ОМ-Т-9521/").json()["summary"]["persons"][0]
    assert card["role"] == "Президент Черногории"
    assert card["facts"] == FACTS


# ── Старший ГВО отдельно от ответственного ──────────────────────────────────


def test_senior_is_derived_from_the_event_chief_with_callsign():
    api, _ = manager("sc-senior")
    chief = make_employee("Мамаев", "Бауыржан")
    chief.callsign = "1-30"
    chief.save(update_fields=["callsign"])
    event = make_event("ОМ-Т-9522")
    event.chief_employee_id = chief.pk
    event.chief_name = "Мамаев Б."
    event.save(update_fields=["chief_employee_id", "chief_name"])
    summary = api.get(f"{GVO_URL}ОМ-Т-9522/").json()["summary"]
    assert summary["senior"] == {
        "employeeId": str(chief.pk),
        "name": "Мамаев Б.",
        "callsign": "1-30",
        "role": "старший ГВО",
    }
    # Ответственный — по-прежнему ведущий бюллетеня, и это ДРУГОЙ человек.
    assert summary["responsible"]["name"] == "Тест"


def test_required_fields_name_both_people():
    labels = [label for _path, label in gvo_service.REQUIRED_VISIT_FIELDS]
    assert "Ответственный за ГВО" in labels
    assert "Старший ГВО" in labels
    assert dict(gvo_service.REQUIRED_VISIT_FIELDS)["senior"] == "Старший ГВО"
    # Ключ раздела: «Вернуть исходные» снимает старшего вместе с ответственным.
    assert "senior" in gvo_service.SECTION_PATCH_KEYS["resp"]
    assert "senior" in gvo_service.SECTION_PATCH_KEYS["groups"]


def test_choosing_a_senior_in_the_summary_updates_the_event_chief():
    api, _ = manager("sc-sync")
    new_chief = make_employee("Жетписбаев", "Даурен")
    new_chief.callsign = "6-201"
    new_chief.save(update_fields=["callsign"])
    event = make_event("ОМ-Т-9523")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-9523/",
        {
            "section": "resp",
            "values": {
                "senior": {"employeeId": str(new_chief.pk), "name": "х", "callsign": "", "role": "старший ГВО"},
            },
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    event = OpsSecurityEvent.objects.get(pk=event.pk)
    assert event.chief_employee_id == new_chief.pk
    assert event.chief_name == "Жетписбаев Д."
    senior = api.get(f"{GVO_URL}ОМ-Т-9523/").json()["summary"]["senior"]
    assert senior["name"] == "Жетписбаев Д." and senior["callsign"] == "6-201"
    # Старший текстом (без ссылки) мероприятие не трогает: права по тексту не выдаются.
    api.patch(
        f"{GVO_URL}ОМ-Т-9523/",
        {"section": "resp", "values": {"senior": {"name": "Кто-то", "callsign": "", "role": "старший ГВО"}}},
        format="json",
    )
    assert OpsSecurityEvent.objects.get(pk=event.pk).chief_employee_id == new_chief.pk
