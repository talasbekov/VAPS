"""Реестр транспорта ГОН: модель (Plane №215).

Проверяется НЕ «поле существует» — это утверждала бы сама миграция, — а два
правила, которые модель обязана держать САМА: ГРНЗ не повторяется у живых
машин, и повторяется у снятых.
"""
import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_vehicle import (
    OpsEventVehicle,
    OpsVehicle,
)

pytestmark = pytest.mark.django_db


def _car(**over):
    data = {
        "brand": "Mercedes-Benz S680 Maybach 4 М (брон.)",
        "body_class": "седан (223)",
        "production_year": 2023,
        "plate": "111 aa 01",
        "armor_class": "VR7",
        "deployment": "Астана",
        "note": "Автохозяйство",
    }
    data.update(over)
    return OpsVehicle.objects.create(**data)


def test_the_registry_keeps_every_column_of_the_sample():
    """Поля образца доезжают до базы неискажёнными.

    Красная на мутации: срежь `body_class` до 10 символов — «седан (223)»
    перестанет помещаться, и строка не сохранится.
    """
    car = _car()
    car.refresh_from_db()
    assert car.brand == "Mercedes-Benz S680 Maybach 4 М (брон.)"
    assert car.body_class == "седан (223)"
    assert car.production_year == 2023
    assert car.plate == "111 aa 01"
    assert car.armor_class == "VR7"
    assert car.deployment == "Астана"
    assert car.note == "Автохозяйство"
    assert car.is_active is True


def test_two_live_cars_cannot_share_a_plate():
    """Одинаковый ГРНЗ у двух ДЕЙСТВУЮЩИХ машин — опечатка, а не парк.

    Красная на мутации: убери условие `is_active=True` из ограничения — и
    следующий тест (снятая машина отдаёт номер) начнёт падать; убери
    ограничение целиком — падает этот.
    """
    _car()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _car(brand="Другая машина")


def test_a_retired_car_gives_its_plate_back():
    """Снятая машина номер не держит: ГРНЗ переходит к другой машине, а
    история прежней при этом не стирается."""
    retired = _car()
    retired.is_active = False
    retired.save(update_fields=["is_active"])

    fresh = _car(brand="Новая машина на том же номере")

    assert fresh.plate == retired.plate
    assert OpsVehicle.objects.filter(plate="111 aa 01").count() == 2
    assert OpsVehicle.objects.filter(plate="111 aa 01", is_active=True).count() == 1


# ── API реестра (Plane №215) ────────────────────────────────────────────────

from organization_management.apps.operations.tests.test_rbac_admin_api import (  # noqa: E402
    client_for,
)

URL = "/api/ops/vehicles/"


def _viewer():
    api, _ = client_for("veh-viewer", "VEH_VIEWER", perms=("event.view",))
    return api


def test_the_registry_is_closed_without_the_permission():
    """Без права раздела реестр не отдаётся вовсе — гейт, а не пустой список.

    Пустой список читался бы как «машин нет», и отсутствие права стало бы
    неотличимо от пустого парка.
    """
    api, _ = client_for("veh-nobody", "VEH_NOBODY", perms=())
    assert api.get(URL).status_code == 403


def test_the_row_carries_every_column_of_the_sample():
    """Ответ несёт все колонки образца, год — числом, а не строкой."""
    _car()
    row = _viewer().get(URL).json()["results"][0]

    assert row["brand"] == "Mercedes-Benz S680 Maybach 4 М (брон.)"
    assert row["bodyClass"] == "седан (223)"
    assert row["productionYear"] == 2023
    assert row["plate"] == "111 aa 01"
    assert row["armorClass"] == "VR7"
    assert row["deployment"] == "Астана"
    assert row["note"] == "Автохозяйство"
    assert row["isActive"] is True


def test_a_retired_car_is_out_of_the_registry_but_reachable_on_demand():
    """Снятая машина не предлагается к выделению, но администратор её найдёт.

    Красная на мутации: сделай `include_retired` включённым всегда — первый
    ассерт покажет снятую машину среди действующих.
    """
    _car()
    _car(plate="222 bb 02", is_active=False, brand="Снятая машина")
    api = _viewer()

    live = [row["plate"] for row in api.get(URL).json()["results"]]
    whole = [row["plate"] for row in api.get(f"{URL}?includeRetired=1").json()["results"]]

    assert live == ["111 aa 01"]
    assert sorted(whole) == ["111 aa 01", "222 bb 02"]
    # «Выключено словом» — не то же, что «ключа нет»: `?includeRetired=0`
    # обязан означать «нет», иначе отбор включался бы попыткой его выключить.
    off = [row["plate"] for row in api.get(f"{URL}?includeRetired=0").json()["results"]]
    assert off == ["111 aa 01"]


def test_the_filters_narrow_by_armor_class_and_search_by_plate_or_brand():
    """Отбор считает СЕРВЕР: класс брони, дислокация и поиск по марке/номеру.

    Красная на мутации: убери `armor_class__iexact` из отбора — первый ассерт
    вернёт обе машины.
    """
    _car()
    _car(plate="333 cc 03", brand="Toyota Land Cruiser 300", armor_class="VR9",
         deployment="Алматы")
    api = _viewer()

    vr7 = [r["plate"] for r in api.get(f"{URL}?armorClass=VR7").json()["results"]]
    almaty = [r["plate"] for r in api.get(f"{URL}?deployment=Алматы").json()["results"]]
    by_brand = [r["plate"] for r in api.get(f"{URL}?search=Toyota").json()["results"]]
    by_plate = [r["plate"] for r in api.get(f"{URL}?search=111 aa").json()["results"]]

    assert vr7 == ["111 aa 01"]
    assert almaty == ["333 cc 03"]
    assert by_brand == ["333 cc 03"]
    assert by_plate == ["111 aa 01"]


def test_armor_classes_come_from_the_fleet_and_not_from_a_hardcoded_list():
    """Значения отбора считаются по парку.

    Красная на мутации: верни вместо запроса список-константу — проба
    покажет класс, которого в парке нет, либо не покажет тот, который есть.
    """
    # ДВЕ машины одного класса — та самая проверка, которой не хватало:
    # с одной машиной на класс список выглядит схлопнутым даже тогда, когда
    # DISTINCT не работает вовсе. Так и проехал дефект: значения повторялись
    # по разу на машину, и увидела это только живая проба экрана.
    _car()
    _car(plate="222 bb 02", armor_class="VR7")
    _car(plate="333 cc 03", armor_class="VR9")
    _car(plate="444 dd 04", armor_class="VR9", is_active=False)
    _car(plate="555 ee 05", armor_class="")

    classes = _viewer().get(f"{URL}armor-classes/").json()["results"]

    assert classes == ["VR7", "VR9"]


# ── Наполнение реестра (Plane №215 / шаг №220) ──────────────────────────────

from io import StringIO  # noqa: E402

from django.core.management import call_command  # noqa: E402


def _seed():
    out = StringIO()
    call_command("seed_vehicles", stdout=out)
    return out.getvalue()


def test_the_seeded_fleet_shows_more_than_one_armor_class():
    """Парк должен ПОКАЗЫВАТЬ отбор, а не просто существовать.

    На парке из одного класса брони отбор экрана не проверяется вовсе — тот
    же класс сторожа, что у фикстур стенда (Plane №196).
    """
    _seed()

    classes = set(
        OpsVehicle.objects.filter(is_active=True)
        .exclude(armor_class="")
        .values_list("armor_class", flat=True)
    )

    assert len(classes) >= 2, classes
    assert OpsVehicle.objects.filter(is_active=True).count() >= 10


def test_seeding_twice_does_not_double_the_fleet():
    """Второй запуск ничего не задваивает: машина ищется по ГРНЗ.

    Красная на мутации: замени `get_or_create` на `create` — второй запуск
    упрётся в уникальность номера либо удвоит парк.
    """
    _seed()
    first = OpsVehicle.objects.count()

    _seed()

    assert OpsVehicle.objects.count() == first


def test_seeding_does_not_overwrite_what_the_admin_fixed_by_hand():
    """Правка руками в Admin переживает пересев.

    Сид наполняет пустой реестр, а не диктует его: затирать дислокацию,
    проставленную администратором, значит терять единственные настоящие
    сведения в таблице.
    """
    _seed()
    car = OpsVehicle.objects.filter(is_active=True).first()
    car.deployment = "Караганда"
    car.save(update_fields=["deployment"])

    _seed()

    car.refresh_from_db()
    assert car.deployment == "Караганда"


# ── Выделение транспорта на мероприятие (Plane №215 / шаг №222) ─────────────

from organization_management.apps.ops.documents_summary import (  # noqa: E402
    document_values,
    summary_for_event,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: E402
    make_object,
    manager,  # noqa: F401 — фикстура
)

EVENTS = "/api/ops/security-events/"


def _event(api):
    obj = make_object()
    return api.post(
        EVENTS,
        {
            "title": "Визит делегации",
            "objectId": str(obj.pk),
            "businessDate": "2026-08-10",
            "kind": "FOREIGN",
        },
        format="json",
    ).json()


def test_an_allocated_car_comes_back_with_its_plate_and_armour(manager):  # noqa: F811
    """Выделенная машина видна в карточке ОМ с ГРНЗ и классом брони.

    Ровно тех сведений и не было у свободного текста «Выделяемый транспорт»,
    ради которых реестр и заводился.
    """
    car = _car()
    event = _event(manager)

    body = manager.post(
        f"{EVENTS}{event['id']}/vehicles/",
        {"vehicleId": str(car.pk), "callsign": "S1", "purpose": "кортеж"},
        format="json",
    )

    assert body.status_code == 201
    row = body.json()["vehicles"][0]
    assert row["label"] == "Mercedes-Benz S680 Maybach 4 М (брон.) (111 aa 01)"
    assert row["callsign"] == "S1"
    assert row["purpose"] == "кортеж"
    assert row["plate"] == "111 aa 01"
    assert row["armorClass"] == "VR7"


def test_the_same_car_cannot_be_allocated_twice(manager):  # noqa: F811
    """Дважды выделенная машина ехала бы двумя позывными сразу.

    Красная на мутации: сними `uniq_ops_event_vehicle` — второй вызов пройдёт
    и счёт машин в документе разойдётся с парком.
    """
    car = _car()
    event = _event(manager)
    url = f"{EVENTS}{event['id']}/vehicles/"
    manager.post(url, {"vehicleId": str(car.pk)}, format="json")

    second = manager.post(url, {"vehicleId": str(car.pk)}, format="json")

    assert second.status_code == 422
    assert second.json()["error_code"] == "VEHICLE_ALREADY_ALLOCATED"


def test_a_retired_car_is_refused_with_a_reason(manager):  # noqa: F811
    """Снятая машина в кортеж не ставится, и отказ назван словами."""
    car = _car(is_active=False)
    event = _event(manager)

    refused = manager.post(
        f"{EVENTS}{event['id']}/vehicles/",
        {"vehicleId": str(car.pk)},
        format="json",
    )

    assert refused.status_code == 422
    assert refused.json()["error_code"] == "VEHICLE_RETIRED"


def test_releasing_a_car_takes_it_off_the_event(manager):  # noqa: F811
    """Снятие с мероприятия убирает машину из карточки."""
    car = _car()
    event = _event(manager)
    allocated = manager.post(
        f"{EVENTS}{event['id']}/vehicles/",
        {"vehicleId": str(car.pk)},
        format="json",
    ).json()["vehicles"][0]

    after = manager.delete(
        f"{EVENTS}{event['id']}/vehicles/{allocated['id']}/"
    )

    assert after.status_code == 200
    assert after.json()["vehicles"] == []


def test_the_summary_shows_allocations_next_to_the_free_text(manager):  # noqa: F811
    """Сводка ГВО показывает ОБА источника, не подменяя один другим.

    Красная на мутации: положи выделения в ключ `transport` вместо своего —
    свободный текст патча затрёт их, и сводка потеряет ГРНЗ.
    """
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )
    from organization_management.apps.operations.models_gvo import (
        OpsGvoSummaryPatch,
    )

    car = _car()
    event = _event(manager)
    manager.post(
        f"{EVENTS}{event['id']}/vehicles/",
        {"vehicleId": str(car.pk), "callsign": "S1", "purpose": "кортеж"},
        format="json",
    )
    row = OpsSecurityEvent.objects.get(pk=event["id"])
    OpsGvoSummaryPatch.objects.create(
        event=row, patch={"transport": [{"code": "S9", "car": "машина руками"}]}
    )

    summary = summary_for_event(row)

    assert summary["transport"] == [{"code": "S9", "car": "машина руками"}]
    assert summary["allocatedTransport"] == [
        {
            "callsign": "S1",
            "label": "Mercedes-Benz S680 Maybach 4 М (брон.) (111 aa 01)",
            "purpose": "кортеж",
            "plate": "111 aa 01",
            "armorClass": "VR7",
        }
    ]
    # Документ печатает СНАЧАЛА выделенную машину, потом набранную руками:
    # точное впереди приблизительного, и ни одна строка не теряется.
    values = document_values(row)
    assert values["transport_1"].startswith("S1 — Mercedes-Benz")
    assert values["transport_2"] == "S9 — машина руками"


@pytest.mark.django_db(transaction=True)
def test_allocation_works_without_an_ambient_transaction():
    """Выделение работает БЕЗ внешней транзакции — как в живом запросе.

    Остальные пробы файла идут внутри транзакции, которую открывает
    `django_db`, и `SELECT … FOR UPDATE` в них проходит всегда. На стенде
    транзакции нет, и ручка отвечала 500 `TransactionManagementError`:
    блокировку брала вьюха, а не сервис. Нашла живая проба экрана (№215).

    Красная на мутации: сними `@transaction.atomic` с `allocate_vehicle` —
    падает именно эта проба, остальные остаются зелёными.
    """
    from organization_management.apps.ops import vehicles as service

    api, _ = client_for(
        "veh-tx",
        "VEH_TX",
        perms=("event.view", "event.manage"),
    )
    car = _car()
    event = _event(api)

    service.allocate_vehicle(event["id"], vehicle_id=str(car.pk), callsign="S1")

    assert (
        OpsEventVehicle.objects.filter(event_id=event["id"], vehicle=car).count() == 1
    )
