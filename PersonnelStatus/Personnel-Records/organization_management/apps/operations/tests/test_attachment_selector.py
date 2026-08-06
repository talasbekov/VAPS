"""Чтение вложения по идентификатору из адреса: что селектор НЕ пускает в базу.

Проверяется не «находит строку» — это делает ORM, — а граница: идентификатор
приходит из адреса маршрута строкой произвольного вида, и всё, что не является
целым, обязано вернуть None, а не поднять исключение из драйвера базы. Разница
видна только в ответе прода: None станет 404, исключение — 500.
"""
import pytest

from organization_management.apps.operations.models_document import OpsAttachment
from organization_management.apps.operations.selectors import OpsAttachmentSelector

pytestmark = pytest.mark.django_db


def make():
    return OpsAttachment.objects.create(
        original_name="расход.docx",
        content_type="text/plain",
        size=10,
        sha256="a" * 64,
    )


# ── Находит ──────────────────────────────────────────────────────────────


def test_an_existing_row_is_returned_by_its_integer_id():
    row = make()

    assert OpsAttachmentSelector.get(row.pk) == row


def test_the_same_id_as_a_string_from_the_url_finds_the_same_row():
    """Из адреса идентификатор всегда приходит строкой — это основной путь."""
    row = make()

    assert OpsAttachmentSelector.get(str(row.pk)) == row


def test_surrounding_whitespace_does_not_hide_an_existing_row():
    row = make()

    assert OpsAttachmentSelector.get(f" {row.pk} ") == row


# ── Не находит и не падает ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "junk",
    [
        "abc",
        "",
        "   ",
        "1; DROP TABLE ops_attachments",
        "1.5",
        "0x10",
        None,
        [],
        {},
        object(),
    ],
)
def test_junk_yields_nothing_instead_of_an_error_from_the_database(junk):
    """Каждое из этих значений, уйдя в фильтр как есть, даёт 500 вместо 404.

    Разбор ДО запроса — вся суть селектора; убери его, и половина строк этого
    списка поднимет исключение прямо из ORM.
    """
    make()

    assert OpsAttachmentSelector.get(junk) is None


def test_a_missing_id_is_indistinguishable_from_a_junk_one():
    """Ответы обязаны совпадать: разница рассказывала бы спрашивающему, какие
    идентификаторы бывают."""
    assert OpsAttachmentSelector.get(10**9) is None
    assert OpsAttachmentSelector.get("не-число") is None


def test_a_boolean_does_not_slip_through_as_the_row_with_id_one():
    """bool — подкласс int, и True, поданный в разбор целым, стал бы pk=1.

    Идентификатор здесь задан ЯВНО: без строки с pk=1 в таблице проба вакуумна
    — True вернул бы None просто потому, что искать нечего, и замена разбора на
    int() без str() осталась бы зелёной.
    """
    row = OpsAttachment.objects.create(
        pk=1, original_name="чужой.docx", content_type="text/plain",
        size=10, sha256="b" * 64,
    )

    assert OpsAttachment.objects.filter(pk=1).exists()
    assert OpsAttachmentSelector.get(True) is None
    assert OpsAttachmentSelector.get(1) == row
