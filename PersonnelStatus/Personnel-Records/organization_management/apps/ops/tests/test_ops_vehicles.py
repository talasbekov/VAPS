"""Реестр транспорта ГОН: модель (Plane №215).

Проверяется НЕ «поле существует» — это утверждала бы сама миграция, — а два
правила, которые модель обязана держать САМА: ГРНЗ не повторяется у живых
машин, и повторяется у снятых.
"""
import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_vehicle import OpsVehicle

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
    _car()
    _car(plate="333 cc 03", armor_class="VR9")
    _car(plate="444 dd 04", armor_class="VR9", is_active=False)
    _car(plate="555 ee 05", armor_class="")

    classes = _viewer().get(f"{URL}armor-classes/").json()["results"]

    assert classes == ["VR7", "VR9"]
