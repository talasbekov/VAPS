"""Справочник типов статусов стоит в реестре «Система → Справочники» (№344).

ЧТО БЫЛО. Заказчик завёл тип статуса в админке и написал «не отображается».
№342 починил ИСТОЧНИК каталога для окон и подписей, но сам справочник в
реестре не появился: реестр перечислял только generic-справочники
(`OpsDictionaryEntry`), а типы статусов живут своей таблицей. На вопрос «какие
у нас справочники» экран отвечал неправдой.

Пробы держат три конца:
  1) реестр перечисляет справочник типов и считает его строки ПО ЕГО таблице,
     а не по generic-реестру (иначе счётчик был бы нулём при полном каталоге);
  2) generic-ручка значений его по-прежнему НЕ обслуживает — код не попал в
     `DEFINITIONS`, иначе `create_entry` полез бы заводить `OpsDictionaryEntry`
     с чужим `dictionary_code`, и отбивал бы это CHECK-constraint базы, то есть
     ошибка приходила бы из базы, а не из проверки;
  3) администратор справочников (`dictionary.view`, без `status.view`) каталог
     ЧИТАЕТ: строку в реестре ему показал тот же сервер, и звать туда, куда сам
     не пускает, он не должен.
"""
import pytest

from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

DICTS = "/api/ops/dictionaries/"
STATUS_TYPES = "/api/operations/status-types/"


@pytest.fixture
def catalogue():
    """Три типа, один выключенный: активных должно быть меньше, чем всего,
    иначе проба не отличит «посчитал активные» от «посчитал все»."""
    for code, active in (("DUTY", True), ("VACATION", True), ("OLD", False)):
        StatusType.objects.create(
            code=code, name=code, priority=10, report_column_code="OTHER",
            is_active=active,
        )


def registry_row(payload, code):
    return next(
        (row for row in payload["results"] if row["code"] == code), None
    )


def test_the_registry_lists_the_status_types_dictionary(catalogue):
    api, _ = client_for("dict-reader", "READER", ["dictionary.view"])

    response = api.get(DICTS)

    assert response.status_code == 200, response.data
    row = registry_row(response.data, "STATUS_TYPES")
    assert row is not None, (
        "справочник типов статусов не назван в реестре — заказчик снова не "
        "найдёт заведённый тип"
    )
    # Счёт по СВОЕЙ таблице: generic-реестр про эти строки не знает вовсе.
    assert (row["totalCount"], row["activeCount"]) == (3, 2)
    # Значения открываются своим экраном, а не generic-адресом по коду.
    assert row["screen"] == "status-types"
    assert row["readOnly"] is True


def test_the_generic_rows_say_they_have_no_screen_of_their_own(catalogue):
    api, _ = client_for("dict-reader-2", "READER", ["dictionary.view"])

    row = registry_row(api.get(DICTS).data, "RETURN_REASONS")

    # `null`, а не отсутствие ключа: undefined на клиенте читается как «поле
    # забыли», и разбирающемуся пришлось бы гадать.
    assert row["screen"] is None
    assert row["readOnly"] is False


def test_the_generic_entries_handle_still_refuses_that_code(catalogue):
    """Код НЕ попал в `DEFINITIONS` — и это проверяется, а не подразумевается."""
    api, _ = client_for("dict-reader-3", "READER", ["dictionary.view"])

    response = api.get(f"{DICTS}STATUS_TYPES/entries")

    assert response.status_code == 404, response.data


def test_the_dictionary_admin_reads_the_catalogue_without_status_view(catalogue):
    api, _ = client_for("ref-admin", "REFERENCE_ADMIN", ["dictionary.view"])

    response = api.get(STATUS_TYPES)

    assert response.status_code == 200, response.data
    assert response.data["count"] == 3


def test_a_stranger_still_gets_nothing(catalogue):
    api, _ = client_for("stranger", "NOBODY", ["object.view"])

    assert api.get(STATUS_TYPES).status_code == 403
