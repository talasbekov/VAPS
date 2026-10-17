"""Раскладка документа расхода — общая для ВСЕХ форматов выгрузки (порт
констант и _member_line из apps/documents/generators/expense_docx.py
Backend/VAPS).

Один владелец на шапку, подписи колонок, лейбл итога и формат строки члена.
Свои константы в каждом рендерере разошлись бы молча: .csv назвал бы колонку
одним словом, .xlsx другим, и две выгрузки одного дня перестали бы
сличаться — а сличают их как раз тогда, когда что-то пошло не так.

ПОРЯДОК И СОСТАВ КОЛОНОК ЗАДАЁТ СПРАВОЧНИК, а не этот модуль (отличие от
источника с его фиксированной 17-колоночной шапкой донора): типы статусов
здесь заводит администратор, и прибитый список либо потерял бы новую колонку,
либо печатал бы пустую отменённую. Здесь только ПОДПИСИ — и подпись для
незнакомого кода не выдумывается, а печатается самим кодом: пустая ячейка
шапки скрыла бы от читателя, что колонка вообще есть.
"""
# Подписи известных колонок. Словарь неполон по построению — справочник
# открыт, и код колонки без подписи это норма, а не дефект данных.
COLUMN_LABELS = {
    "IN_SERVICE": "В строю",
    "ON_DUTY": "На дежурстве",
    "AFTER_DUTY": "После дежурства",
    "BEFORE_DUTY": "Перед дежурством",
    "COMMAND": "В командировке",
    "TRAINING": "Учёба/соревнования/конференция",
    "VACATION": "В отпуске",
    "SICK": "На больничном",
    "ATTACHED": "Прикомандирован",
    "DETACHED": "Откомандирован",
    "OTHER": "Иное",
    "PENDING": "Уточняется",
}

# Неизменная часть шапки: номер, подразделение и знаменатель.
FIXED_HEAD = ("№", "Управление", "По штату", "По списку", "Вакансии")
# Приданные стоят ПОСЛЕ колонок списка и подписаны отдельно: они не столбец
# списка, а «сверх него», и внутри колонок сумма перестала бы сходиться.
ATTACHED_LABEL = "Придано (+N)"
#: Занятость мероприятиями — СПРАВОЧНАЯ колонка документа (Plane №243).
#: Стоит ПОСЛЕ «+N», в самом конце: эти люди уже посчитаны в «В строю», и
#: место среди колонок расхода предложило бы сложить их со всеми остальными.
#: Печатается «всего (группы/наряд)» одной клеткой — три колонки ради двух
#: слагаемых растянули бы и без того широкий лист.
EVENT_LABEL = "На ОМ (гр./нар.)"


def event_cell(event):
    """Клетка занятости: «2 (1/1)»; ноль — прочерк.

    Прочерк, а не ноль: «никого не привлекли» и «колонка пустая» читаются
    по-разному, а в подписанном документе это разница между фактом и
    пропуском.
    """
    total = (event or {}).get("total", 0)
    if not total:
        return "—"
    return f"{total} ({(event or {}).get('group', 0)}/{(event or {}).get('squad', 0)})"
TOTALS_LABEL = "ИТОГО"
DATE_FORMAT = "%d.%m.%Y"

# Retained for old callers; personnel output is no longer truncated.
CELL_MAX_MEMBERS = 20

PERSONNEL_HEAD = ("ФИО", "Звание", "Должность", "Статус", "Период отсутствия", "Место убытия")


def absence_period(start, end):
    """Display the last absent day inclusively; storage remains [start, end)."""
    from datetime import timedelta
    if start is None or end is None:
        return ""
    last = end - timedelta(days=1)
    if start == last:
        return start.strftime(DATE_FORMAT)
    return f"{start.strftime(DATE_FORMAT)}–{last.strftime(DATE_FORMAT)}"


def personnel_values(person):
    return (person.full_name, person.rank, person.position_name, person.status_name,
            absence_period(person.date_start, person.date_end), person.destination)

FONT_NAME = "Times New Roman"
TITLE_SIZE_PT = 16
TABLE_SIZE_PT = 12
# Состав печатается мельче числа — но только там, где формат разрешает два
# размера в одной ячейке (.docx). У .xlsx шрифт один на ячейку, и размер
# состава там просто не к чему применить.
MEMBER_SIZE_PT = 8


def column_label(column):
    """Подпись колонки; незнакомый код печатается как есть."""
    return COLUMN_LABELS.get(column, column)


def header_row(columns):
    """Шапка таблицы под конкретный порядок колонок справочника."""
    return [
        *FIXED_HEAD,
        *(column_label(column) for column in columns),
        ATTACHED_LABEL,
        EVENT_LABEL,
    ]


def document_title(data):
    """Титул: подразделение и дата документа."""
    return (
        f"Расход личного состава — {data.division_title} на "
        f"{data.business_date.strftime(DATE_FORMAT)}"
    )


def member_line(member):
    """«звание ФИО — ДД.ММ.ГГГГ–ДД.ММ.ГГГГ»; без звания — без лишнего пробела."""
    name = " ".join(part for part in (member.rank, member.full_name) if part)
    return (
        f"{name} — {absence_period(member.date_start, member.date_end)}"
    )


def member_lines(members):
    """Every member is visible, including rosters longer than a page."""
    return [member_line(member) for member in members]
