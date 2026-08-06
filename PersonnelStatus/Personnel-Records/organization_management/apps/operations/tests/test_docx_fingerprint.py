"""Отпечаток .docx: что он обязан игнорировать и что обязан замечать.

Несущее свойство — отпечаток одинаков у ДВУХ РАЗНЫХ по байтам документов,
собранных из одних данных, и различен, как только данные изменились. Первое
делает сравнение вообще возможным (иначе оно краснело бы всегда), второе — не
даёт ему стать бесполезным.

Проба на «разные байты» здесь обязательна: без неё «отпечатки совпали» неотличимо
от «мы дважды прочитали один и тот же файл».
"""
import io
import zipfile
from datetime import date

import pytest

from organization_management.apps.operations.docx_fingerprint import (
    DOCUMENT_PART,
    normalize_document_xml,
)
from organization_management.apps.operations.expense_docx import generate_expense_docx
from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.strength_report import StatusCatalog

DAY = date(2026, 8, 4)


@pytest.fixture
def catalog():
    return StatusCatalog.from_rows(
        [
            {
                "code": "IN_SERVICE",
                "priority": 999,
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
            {
                "code": "DUTY",
                "priority": 10,
                "report_column_code": "ON_DUTY",
                "counts_in_staff": True,
            },
        ]
    )


def member(employee_id, full_name="Иванов Иван"):
    return {"employee_id": employee_id, "full_name": full_name, "rank": "капитан"}


def fact(employee_id, code="DUTY"):
    return {
        "employee_id": employee_id,
        "status_type_code": code,
        "date_start": DAY.isoformat(),
        "date_end": date(2026, 8, 10).isoformat(),
        "source": "USER",
    }


def document(catalog, roster, rows, **overrides):
    kwargs = {
        "catalog": catalog,
        "division_title": "Управление кадров",
        "staff_total": 10,
        "vacancies": 7,
        "attached": 2,
    }
    kwargs.update(overrides)
    return build_expense_document({"roster": roster, "rows": rows}, DAY, **kwargs)


@pytest.fixture
def data(catalog):
    return document(catalog, [member(1), member(2)], [fact(1)])


# ── Игнорирует упаковку ──────────────────────────────────────────────────


def test_two_builds_of_the_same_data_differ_in_bytes(data):
    """Опора всего среза: сырые байты .docx НЕ совпадают.

    Без этой пробы совпадение отпечатков ниже ничего бы не значило — оно
    объяснялось бы тем, что генератор детерминирован и по байтам тоже, и весь
    модуль был бы не нужен.
    """
    first = generate_expense_docx(data)
    second = _rebuilt_with_a_later_timestamp(generate_expense_docx(data))

    assert first != second


def _rebuilt_with_a_later_timestamp(docx_bytes):
    """Пересобрать тот же .docx с другим временем записей zip.

    Ровно то, что делает вызов генератора секундой позже: содержимое то же,
    байты другие. Пересборка здесь надёжнее ожидания реальной секунды —
    прогон не должен зависеть от того, успел ли тикнуть таймер.
    """
    source = zipfile.ZipFile(io.BytesIO(docx_bytes))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            info = zipfile.ZipInfo(item.filename, date_time=(2030, 1, 1, 0, 0, 0))
            target.writestr(info, source.read(item.filename))
    return buffer.getvalue()


def test_the_fingerprint_ignores_the_container_timestamps(data):
    """То, ради чего модуль существует: сравнение байт краснело бы всегда."""
    first = generate_expense_docx(data)
    second = _rebuilt_with_a_later_timestamp(first)

    assert first != second
    assert normalize_document_xml(first) == normalize_document_xml(second)


def test_the_fingerprint_ignores_word_revision_ids(data):
    """`w:rsid*` — идентификаторы сеанса правки Word.

    К содержимому они отношения не имеют, а меняться могут от правки шаблона:
    оставь их — и обновление шаблона выглядело бы изменением документа.
    """
    payload = generate_expense_docx(data)
    tampered = _with_extra_rsid(payload)

    assert normalize_document_xml(payload) == normalize_document_xml(tampered)


def _with_extra_rsid(docx_bytes):
    source = zipfile.ZipFile(io.BytesIO(docx_bytes))
    xml = source.read(DOCUMENT_PART).replace(
        b"<w:body>", b'<w:body w:rsidR="00AB12CD">', 1
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            original = source.read(item.filename)
            payload = xml if item.filename == DOCUMENT_PART else original
            target.writestr(item.filename, payload)
    return buffer.getvalue()


def test_the_fingerprint_is_idempotent(data):
    """Отпечаток отпечатка — тот же отпечаток: иначе сравнивать пришлось бы,
    помня, сколько раз нормализацию уже применяли."""
    once = normalize_document_xml(generate_expense_docx(data))

    assert once == normalize_document_xml(_as_docx(once))


def _as_docx(document_xml):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(DOCUMENT_PART, document_xml)
    return buffer.getvalue()


# ── Замечает содержимое ──────────────────────────────────────────────────


def test_a_changed_number_changes_the_fingerprint(catalog, data):
    other = document(catalog, [member(1), member(2)], [fact(1)], staff_total=11)

    assert normalize_document_xml(generate_expense_docx(data)) != (
        normalize_document_xml(generate_expense_docx(other))
    )


def test_a_changed_name_changes_the_fingerprint(catalog, data):
    other = document(
        catalog, [member(1, full_name="Сидоров Сидор"), member(2)], [fact(1)]
    )

    assert normalize_document_xml(generate_expense_docx(data)) != (
        normalize_document_xml(generate_expense_docx(other))
    )


def test_a_changed_division_title_changes_the_fingerprint(catalog, data):
    other = document(
        catalog, [member(1), member(2)], [fact(1)], division_title="Другое управление"
    )

    assert normalize_document_xml(generate_expense_docx(data)) != (
        normalize_document_xml(generate_expense_docx(other))
    )


def test_the_fingerprint_is_the_document_part_and_not_the_container(data):
    payload = normalize_document_xml(generate_expense_docx(data))

    assert payload.startswith(b"<")
    assert b"w:rsid" not in payload


def test_the_same_markup_written_differently_gives_one_fingerprint():
    """Канонизация: одна и та же разметка, записанная иначе, обязана дать один
    отпечаток.

    Проба идёт МИМО генератора намеренно. python-docx сегодня пишет XML
    единообразно, и на его выходе снятие канонизации не краснит ничего — то
    есть на нём это свойство недоказуемо. Но отпечаток обязан зависеть от
    СОДЕРЖАНИЯ, а не от того, как чужая библиотека сериализовала его в этот
    раз, и здесь оба варианта записи различаются только формой: порядок
    атрибутов и лишнее объявление пространства имён.
    """
    first = _as_docx(
        b'<?xml version="1.0"?>'
        b'<w:body xmlns:w="urn:w" xmlns:x="urn:x" a="1" b="2"><w:p/></w:body>'
    )
    second = _as_docx(
        b'<?xml version="1.0"?>'
        b'<w:body xmlns:x="urn:x" xmlns:w="urn:w" b="2" a="1"><w:p></w:p></w:body>'
    )

    assert first != second
    assert normalize_document_xml(first) == normalize_document_xml(second)
