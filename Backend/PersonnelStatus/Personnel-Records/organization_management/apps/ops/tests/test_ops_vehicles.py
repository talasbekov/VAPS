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
