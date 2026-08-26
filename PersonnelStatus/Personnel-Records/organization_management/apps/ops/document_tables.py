"""Размножение строк таблицы в шаблоне документа (Plane №156, шаги «ПД-4»…«ПД-6»).

ЗАЧЕМ ОТДЕЛЬНО ОТ `documents.py`. Тот подставляет значения в места
`{{ключ}}` — этого хватает документу с фиксированной формой (сводные данные:
одна страна, одно лицо). Но бюллетень, графики прибытия и убытия и расстановка
— СПИСКИ: строк столько, сколько мероприятий, бортов или постов. Шаблон при
этом держит ОДНУ строку-образец, и её надо повторить, сохранив её оформление:
рамки, шрифты, ширины колонок и объединения.

ПОЧЕМУ КОПИРУЕТСЯ XML, а не собирается новая строка. Строка `.docx` несёт своё
форматирование внутри себя (`<w:trPr>`, свойства ячеек, стили прогонов).
Новая строка, собранная `table.add_row()`, берёт оформление у стиля таблицы —
и в документе, который обязан выглядеть «в точности как ворд», это видно сразу:
пропадают рамки и заливка, разъезжаются ширины. Копия узла даёт ту же строку с
другим текстом, а это ровно то, что нужно.

ЧТО ДЕЛАЕТСЯ С ОБРАЗЦОМ. Строка-образец после размножения УДАЛЯЕТСЯ: иначе в
документ уезжает лишняя строка с `{{date}}` внутри, и `documents.py` честно
отобьёт его как недозаполненный. Пустой список строк — не ошибка: остаётся
заголовок таблицы, и документ честно говорит «на этот момент записей нет».
"""
import copy
import re

from docx.table import _Row

from organization_management.apps.operations.exceptions import DomainError

#: То же правило мест подстановки, что и в `documents.py`: двойные фигурные
#: скобки. Держится копией намеренно — модуль не должен зависеть от порядка
#: импорта соседа; расхождение стережёт проба.
PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def _set_cell_text(cell, text):
    """Положить текст в ячейку, сохранив оформление её первого прогона.

    Word режет текст на прогоны по границам форматирования непредсказуемо:
    `{{person}}` легко лежит как `{{per` + `son}}`. Поэтому текст собирается
    целиком, кладётся в ПЕРВЫЙ прогон, остальные очищаются — так оформление
    ячейки (шрифт, размер, курсив) остаётся её собственным, а не подставным.
    """
    value = "" if text is None else str(text)
    paragraphs = cell.paragraphs
    first = paragraphs[0]
    if first.runs:
        first.runs[0].text = value
        for run in first.runs[1:]:
            run.text = ""
    else:
        first.add_run(value)
    # Лишние параграфы ячейки-образца очищаются: в образцах внутри ячейки
    # бывает по две-три строки, и оставленный хвост читался бы как данные.
    for paragraph in paragraphs[1:]:
        for run in paragraph.runs:
            run.text = ""


def fill_table_rows(table, rows, *, template_row_index=1):
    """Размножить строку-образец по данным.

    `rows` — список списков (значения по колонкам) ЛИБО список словарей
    {имя_места: значение}. Первый вид проще для таблиц по позициям, второй —
    когда в ячейках стоят именованные места `{{...}}` и порядок колонок в
    шаблоне может измениться.

    Число значений сверяется с числом ячеек: молча обрезанная строка означала
    бы документ, в котором часть данных не показана, — а это хуже отказа.
    """
    if template_row_index >= len(table.rows):
        raise DomainError(
            "DOCUMENT_TEMPLATE_BROKEN",
            500,
            detail={"table": ["в таблице шаблона нет строки-образца"]},
            message="Шаблон документа повреждён: нет строки для размножения.",
        )
    template_row = table.rows[template_row_index]
    template_xml = template_row._element
    anchor = template_xml
    cells_count = len(template_row.cells)

    for values in rows:
        new_element = copy.deepcopy(template_xml)
        anchor.addnext(new_element)
        anchor = new_element
        # Ячейки берём у ТОЛЬКО ЧТО вставленного узла, а не по индексу в
        # `table.rows`: этот список пересобирается на каждой вставке, и
        # индексная арифметика здесь — верный способ попасть не в ту строку.
        row = _Row(new_element, table)
        if isinstance(values, dict):
            for cell in row.cells:
                text = cell.text
                names = PLACEHOLDER.findall(text)
                if not names:
                    continue
                filled = PLACEHOLDER.sub(
                    lambda match: "" if values.get(match.group(1)) is None
                    else str(values[match.group(1)]),
                    text,
                )
                _set_cell_text(cell, filled)
        else:
            if len(values) != cells_count:
                raise DomainError(
                    "DOCUMENT_ROW_SHAPE",
                    500,
                    detail={"row": [f"значений {len(values)}, ячеек {cells_count}"]},
                    message="Строка документа не совпала с формой таблицы шаблона.",
                )
            for cell, value in zip(row.cells, values):
                _set_cell_text(cell, value)

    # Образец уходит ПОСЛЕ размножения: он несёт места подстановки, и
    # оставленный превратил бы документ в недозаполненный.
    template_xml.getparent().remove(template_xml)
