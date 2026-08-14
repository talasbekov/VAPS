"""Раскладка сводной таблицы расхода — одна на все форматы.

Заголовки и ячейки собираются из `data["columns"]`, который отдаёт
DataAggregator. Раньше каждый генератор перечислял двенадцать колонок
собственным списком, и колонка, добавленная в сборке данных, попадала в
документ только после правки трёх файлов — а до неё документ молча печатал
неполный расход.
"""
from typing import Any, Dict, List, Sequence, Tuple

# Колонки слева от разбивки по статусам.
LEADING = (("division_name", "Подразделение"), ("staff_unit", "Штатная"))
# Колонки справа. «Прикомандировано» стоит вне разбивки: эти люди не из штата
# подразделения, их не раскладывают по его колонкам.
TRAILING = (
    ("seconded_in", "Прикомандировано"),
    ("present_total", "Итого налич."),
    ("presence_pct", "% налич."),
)


def _columns(data: Dict[str, Any]) -> Sequence[Tuple[str, str]]:
    return [tuple(pair) for pair in data.get("columns", ())]


def headers(data: Dict[str, Any]) -> List[str]:
    return [label for _key, label in (*LEADING, *_columns(data), *TRAILING)]


def cells(data: Dict[str, Any], row: Dict[str, Any]) -> List[Any]:
    return [row[key] for key, _label in (*LEADING, *_columns(data), *TRAILING)]
