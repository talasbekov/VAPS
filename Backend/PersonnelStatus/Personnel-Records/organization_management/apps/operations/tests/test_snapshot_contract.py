"""Раскладка снимка и её история — под замком.

За одну партию схема снимка прошла с 2 до 8, и каждое повышение закрывало
УТЕЧКУ ЖИВЫХ ДАННЫХ в подписанный день: справочник (3), подписи статусов (4),
название подразделения (5), знаменатель по штату (6), «+N» приданных (7), вид
участия в мероприятии (8).
Ошибка в этой цепочке дорогая: снимок читают документы, которые подписывают, а
поле, добавленное без повышения версии, делает две версии с одним номером
неразличимыми — и читатель, который «поддерживает версию 7», получает то одну
раскладку, то другую.

Здесь замок на всю цепочку сразу:

- НАБОР КЛЮЧЕЙ КАЖДОЙ ВЕРСИИ перечислен буквально. Добавь кто-нибудь поле, не
  тронув SCHEMA_VERSION, — тест краснеет и называет разницу. Это единственный
  способ поймать такое: версия сама по себе не знает, что в неё положили;
- ВЕРСИИ РАСТУТ ТОЛЬКО ВВЕРХ и никакая не пропущена;
- КАЖДАЯ ПРЕЖНЯЯ ВЕРСИЯ ОСТАЁТСЯ ПОДДЕРЖАННОЙ. Выпади средняя — перестали бы
  выгружаться все дни, сданные между двумя срезами, и обнаружилось бы это у
  человека, который пришёл за старым днём;
- ПОЛЯ ТОЛЬКО ДОБАВЛЯЮТСЯ. Снять поле в новой версии значит сделать старые
  снимки нечитаемыми теми же читателями — а читатель у них общий.

Таблица ниже — не пересказ кода, а ДОГОВОР: она пишется руками при каждом
повышении, и в этом весь смысл.
"""
import pytest

from organization_management.apps.operations.personal_export_service import (
    SUPPORTED_SCHEMA_VERSIONS,
)
from organization_management.apps.operations.snapshot import (
    SCHEMA_VERSION,
    build_division_snapshot,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

BASE = frozenset({"schema_version", "roster", "rows"})

# {версия: ключи верхнего уровня}. Заполняется РУКАМИ при повышении схемы.
KEYS_BY_VERSION = {
    1: BASE,
    2: BASE,  # position_level добавлен ВНУТРЬ записи состава, не наверх
    3: BASE | {"catalog"},
    4: BASE | {"catalog"},  # name добавлен ВНУТРЬ строки каталога
    5: BASE | {"catalog", "division_title"},
    6: BASE | {"catalog", "division_title", "staff_total", "vacancies"},
    7: BASE | {"catalog", "division_title", "staff_total", "vacancies", "attached"},
    # participations добавлены ВНУТРЬ строки фактов, не наверх
    8: BASE | {"catalog", "division_title", "staff_total", "vacancies", "attached"},
}

# Поля ВНУТРИ вложенных структур — их номер версии тоже отражает.
ROSTER_KEYS_BY_VERSION = {
    1: frozenset({"employee_id", "full_name", "rank"}),
    2: frozenset({"employee_id", "full_name", "rank", "position_level"}),
}
CATALOG_KEYS_BY_VERSION = {
    3: frozenset({"code", "priority", "report_column_code", "counts_in_staff"}),
    4: frozenset(
        {"code", "name", "priority", "report_column_code", "counts_in_staff"}
    ),
}
# Строка ФАКТА. Своей таблицы у неё не было до №751 — и это была дыра ровно
# того размера, в которую дефект и провалился: расширение `rows` не краснило
# здесь ничем, а именно `rows` читает документ расхода.
ROW_KEYS_BY_VERSION = {
    1: frozenset(
        {"employee_id", "status_type_code", "status_id", "date_start",
         "date_end", "source"}
    ),
    8: frozenset(
        {"employee_id", "status_type_code", "status_id", "date_start",
         "date_end", "source", "participations"}
    ),
}


@pytest.fixture
def snapshot(types):  # noqa: F811
    """Непустой снимок: и состав, и факты, и каталог — иначе набор ключей
    вложенных структур проверять было бы не на чем."""
    from organization_management.apps.divisions.models import Division

    division = Division.objects.create(name="Управление 1")
    fact(in_slot(division, last_name="Дежурный"), code="DUTY")
    return build_division_snapshot(division.id, TODAY)


# ── Раскладка текущей версии ─────────────────────────────────────────────


def test_the_current_version_is_described_in_the_table(snapshot):
    """Несущий тест: поле, добавленное без повышения версии, здесь и краснеет.

    Сообщение называет разницу — иначе правящий увидел бы «наборы не равны» и
    полез бы сравнивать глазами.
    """
    assert SCHEMA_VERSION in KEYS_BY_VERSION, (
        f"схема {SCHEMA_VERSION} не описана в договоре раскладок"
    )
    expected = KEYS_BY_VERSION[SCHEMA_VERSION]
    actual = set(snapshot)

    assert actual == expected, (
        f"раскладка разошлась с договором: лишние {sorted(actual - expected)}, "
        f"недостающие {sorted(expected - actual)}"
    )


def test_the_snapshot_says_its_own_version(snapshot):
    assert snapshot["schema_version"] == SCHEMA_VERSION


def test_the_roster_entry_matches_the_table(snapshot):
    latest = max(ROSTER_KEYS_BY_VERSION)
    assert set(snapshot["roster"][0]) == ROSTER_KEYS_BY_VERSION[latest]


def test_the_catalog_row_matches_the_table(snapshot):
    latest = max(CATALOG_KEYS_BY_VERSION)
    assert set(snapshot["catalog"][0]) == CATALOG_KEYS_BY_VERSION[latest]


def test_the_fact_row_matches_the_table(snapshot):
    """Строка факта — та самая, которую читает документ расхода.

    Без этого замка расширение `rows` проходило молча: договор описывал состав
    и каталог, а факты — нет. Дефект №751 жил в противоположную сторону (поля
    НЕ хватало), но обнаружился бы здесь так же — набор ключей разошёлся бы с
    таблицей.
    """
    latest = max(ROW_KEYS_BY_VERSION)
    assert set(snapshot["rows"][0]) == ROW_KEYS_BY_VERSION[latest]


# ── История версий ───────────────────────────────────────────────────────


def test_the_versions_are_a_run_without_gaps():
    """Пропущенный номер означал бы снимки, о которых договор молчит."""
    assert sorted(KEYS_BY_VERSION) == list(range(1, SCHEMA_VERSION + 1))


def test_fields_are_only_ever_added():
    """Снять поле в новой версии значит сделать старые снимки нечитаемыми теми
    же читателями — а читатель у них общий."""
    for version in range(2, SCHEMA_VERSION + 1):
        assert KEYS_BY_VERSION[version - 1] <= KEYS_BY_VERSION[version], (
            f"версия {version} потеряла поля "
            f"{sorted(KEYS_BY_VERSION[version - 1] - KEYS_BY_VERSION[version])}"
        )


def test_every_past_version_is_still_supported():
    """Выпади средняя версия — перестали бы выгружаться все дни, сданные между
    двумя срезами, и обнаружилось бы это у человека, пришедшего за старым днём.
    """
    assert set(KEYS_BY_VERSION) <= SUPPORTED_SCHEMA_VERSIONS


def test_no_unknown_version_is_declared_supported():
    """Обратная сторона: обещать поддержку версии, которой раздел не описывает,
    значит обещать прочитать неизвестно что."""
    assert SUPPORTED_SCHEMA_VERSIONS <= set(KEYS_BY_VERSION)
