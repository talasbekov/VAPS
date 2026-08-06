"""Выгрузка периода: рендерер сам по себе, без базы и маршрута.

На живом маршруте справочник статусов один на весь запрос, поэтому через HTTP
недостижим ровно тот случай, ради которого рендерер и написан осторожно:
СПРАВОЧНИК, ДОПОЛНЕННЫЙ ПОСРЕДИ ПЕРИОДА. Страницы тогда приходят с разным
набором колонок, и у рендерера про это два отдельных решения — порядок колонок
берётся у первой страницы, а недостающая колонка печатается нулём. Оба записаны
в коде как обоснование и до сих пор ничем не проверялись.

Опасность у них общая и тихая: файл, у которого столбцы разъехались
относительно шапки, выглядит ЗАПОЛНЕННЫМ. Никакая проверка ниже по течению его
не поймает — числа на месте, строк столько же, — и «в отпуске» будет читаться
как «на дежурстве» ровно до тех пор, пока кто-нибудь не сверит файл с днём
вручную.

Рендерер чистый: страницы собираются здесь руками, ORM не нужна.
"""
import csv
import io

from organization_management.apps.operations.expense_layout import (
    ATTACHED_LABEL,
    column_label,
)
from organization_management.apps.operations.expense_period_csv import (
    DATE_HEAD,
    generate_period_csv,
)


def page(business_date, columns, *, staff=10, listed=8, vacancies=2, attached=1):
    return {
        "business_date": business_date,
        "totals": {
            "staff_total": staff,
            "list_total": listed,
            "vacancies": vacancies,
            "columns": dict(columns),
            "attached": attached,
        },
    }


def rows_of(pages):
    text = generate_period_csv(pages).decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text), delimiter=";"))


def header_of(rows):
    """Шапка — строка, начинающаяся с «Дата»; над ней стоит титул."""
    return next(row for row in rows if row and row[0] == DATE_HEAD)


def body_of(rows):
    header_index = rows.index(header_of(rows))
    return [row for row in rows[header_index + 1 :] if row]


# ── Справочник, дополненный посреди периода ──────────────────────────────

# Колонка ON_DUTY есть у обеих страниц, VACATION появляется только со второй.
# Порядок в словаре второй страницы намеренно НЕ такой, как в первой: совпади
# он — тест не отличал бы «порядок взят у первой страницы» от «повезло».
FIRST = page("2026-08-01", [("ON_DUTY", 3)])
SECOND = page("2026-08-02", [("VACATION", 5), ("ON_DUTY", 4)])


def test_the_column_order_comes_from_the_first_page():
    """Иначе строка второй страницы встала бы под чужую шапку.

    Столбцы разъехались бы, а файл остался бы заполненным — «в отпуске»
    прочиталось бы как «на дежурстве».
    """
    rows = rows_of([FIRST, SECOND])

    header = header_of(rows)
    assert header[4:] == [column_label("ON_DUTY"), ATTACHED_LABEL]


def test_a_column_that_appears_mid_period_does_not_widen_the_table():
    """Ширина строк обязана совпадать с шапкой — у ВСЕХ страниц.

    Проверяется буквально: длина каждой строки против длины шапки. Добавь
    рендерер колонку второй страницы — строка стала бы длиннее шапки, и
    последний столбец («Придано») сдвинулся бы у половины файла.
    """
    rows = rows_of([FIRST, SECOND])

    width = len(header_of(rows))
    assert [len(row) for row in body_of(rows)] == [width, width]


def test_a_column_missing_from_an_early_page_prints_as_zero():
    """Отсутствие колонки у ранней страницы — это ноль, а не обрыв выгрузки.

    Порядок берётся у ПЕРВОЙ страницы, поэтому недостающей оказывается колонка
    у той, что идёт следом за самой широкой.
    """
    rows = rows_of([SECOND, FIRST])

    header = header_of(rows)
    vacation = header.index(column_label("VACATION"))
    assert [row[vacation] for row in body_of(rows)] == ["5", "0"]


def test_a_column_only_the_later_page_has_is_dropped_not_appended():
    """Молча уронить колонку — плохо, но предсказуемо и заметно по шапке.
    Дописать её В КОНЕЦ строки — хуже: файл выглядел бы полным, а «Придано»
    у части строк оказалось бы не «Приданым».
    """
    rows = rows_of([FIRST, SECOND])

    assert column_label("VACATION") not in header_of(rows)
    # Последняя ячейка каждой строки — по-прежнему «Придано», а не приблудная
    # колонка отпуска.
    assert [row[-1] for row in body_of(rows)] == ["1", "1"]


# ── Титул ────────────────────────────────────────────────────────────────


def test_one_day_is_named_a_day_and_not_a_period():
    """«Период 01.08 — 01.08» читается как ошибка выгрузки."""
    rows = rows_of([FIRST])

    assert rows[0][0] == "Расход личного состава за 2026-08-01"


def test_several_days_are_named_by_their_edges():
    rows = rows_of([FIRST, SECOND])

    assert rows[0][0] == "Расход личного состава за период 2026-08-01 — 2026-08-02"


# ── Крайние случаи ───────────────────────────────────────────────────────


def test_an_empty_period_is_a_header_and_not_a_refusal():
    """Пустого периода не бывает (границы включительны), но рендерер об этом не
    знает и знать не должен: он печатает то, что дали, и падать на пустом входе
    ему незачем."""
    rows = rows_of([])

    assert len(rows) == 1
    assert rows[0][0] == DATE_HEAD


def test_no_totals_row_is_added():
    """Сложить расходы разных дней не во что: человек в отпуске три дня дал бы
    «три отпуска». Строка «ИТОГО» выглядела бы осмысленной и была бы неверной.

    Проверяется на ПУРЕ, а не только через маршрут: строку итогов легко
    дописать сюда, не тронув ни одного вида.
    """
    rows = rows_of([FIRST, SECOND])

    assert len(body_of(rows)) == 2
    assert all("ИТОГО" not in ";".join(row).upper() for row in rows)


def test_the_dialect_is_pinned_to_what_excel_opens():
    """Тот же диалект, что у дневного .csv: файлы открывает тот же человек в том
    же Excel. BOM проверяется по СЫРЫМ байтам — в декодированной строке его уже
    нет."""
    payload = generate_period_csv([FIRST, SECOND])

    assert payload.startswith(b"\xef\xbb\xbf")
    assert b";" in payload
