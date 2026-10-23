"""Каталог кадровых типов статусов — СПРАВОЧНИК, а не список в коде (Plane №354).

ЖАЛОБА ЗАКАЗЧИКА ДОСЛОВНО: «в админке добавил новый статус, там она не
появилась» — про окно планирования статуса на экране «Статусы сотрудников».

ПОЧЕМУ НЕ ПОЯВЛЯЛАСЬ, и почему подменить источник списка на клиенте было бы
обманом. Каталог был зашит ДВАЖДЫ: `EmployeeStatus.StatusType` (TextChoices из
13 значений) на сервере и его зеркало в `entities/status/model.ts` на клиенте.
Пока у поля модели стоят `choices`, заведённый в админке тип не мог ни попасть
в список, ни СОХРАНИТЬСЯ — сервер отбил бы его валидацией поля. Показать его в
выпадающем списке, не сняв `choices`, значило бы предложить выбор, который
ломается при нажатии «Сохранить».

ОТКУДА БЕРЁТСЯ КАТАЛОГ ТЕПЕРЬ. Из справочника раздела ОМ (`ops_status_types`) —
того самого, который заказчик и правит в админке, и который уже стал
источником для окон раздела (Plane №342). Второй справочник рядом с ним был бы
третьей копией того же словаря.

КАКОЙ КОД ХРАНИТСЯ В СТАТУСЕ. `legacy_code`, если он у типа есть, иначе
собственный код типа. Это и есть мост: тринадцать старых кодов
(`in_service`, `vacation`, …) продолжают лежать в базе как лежали — уже
записанные строки не переписываются, — а новые типы приходят со своими кодами.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.apps import apps
from organization_management.apps.statuses.retirement import is_retired_secondment_code

@dataclass(frozen=True)
class StatusTypeItem:
    """Строка каталога в том виде, в каком её ждёт клиент."""

    code: str
    label: str
    color: str
    report_column_code: str


def _model():
    # Ленивый импорт: `operations` уже импортирует `statuses`, и встречный
    # импорт на уровне модуля замкнул бы кольцо при загрузке приложений.
    return apps.get_model("operations", "StatusType")


def _code_of(row) -> str:
    return row.legacy_code or row.code


def catalog(selectable_only: bool = False) -> list[StatusTypeItem]:
    """Активные типы статусов по возрастанию приоритета.

    `selectable_only` убирает заглушки и прикомандирование — то, что человек не
    выбирает руками.
    """
    rows = _model().objects.filter(is_active=True)
    items = []
    for row in rows:
        if selectable_only:
            if row.is_placeholder:
                continue
            if (is_retired_secondment_code(row.code)
                    or is_retired_secondment_code(row.legacy_code)):
                continue
        items.append(
            StatusTypeItem(
                code=_code_of(row), label=row.name, color=row.color,
                report_column_code=row.report_column_code,
            )
        )
    return items


def known_codes() -> set[str]:
    """Всё, что сервер согласен принять в поле `status_type`.

    Собственный код типа принимается НАРАВНЕ с legacy: тип, заведённый в
    админке, legacy-кода не имеет вовсе, и без этого его нельзя было бы
    сохранить — то есть дефект №354 остался бы наполовину.
    """
    codes: set[str] = set()
    for row in _model().objects.filter(is_active=True):
        codes.add(row.code)
        if row.legacy_code:
            codes.add(row.legacy_code)
    return codes


def label_for(code: str, fallback: str = "") -> str:
    """Подпись типа по коду.

    Нужна потому, что со снятием `choices` метод `get_status_type_display()`
    начал бы возвращать сам код: подписи в ответах API держались на списке в
    коде, а теперь держатся на справочнике.
    """
    if not code:
        return fallback
    row = (
        _model().objects.filter(legacy_code=code).first()
        or _model().objects.filter(code=code).first()
    )
    if row is not None:
        return row.name
    # 🔴 ФОЛБЭК НА СТАРЫЙ СЛОВАРЬ — не «на всякий случай», а по правилу
    # «расширять, не подменять». Тринадцать прежних подписей остаются в силе,
    # пока справочник пуст: так ведёт себя чистая тестовая база, и так же
    # повёл бы себя стенд, на котором справочник не засеян. Без фолбэка
    # сообщение о конфликте статусов сказало бы «vacation» вместо «Отпуск» —
    # именно на этом и покраснела проба test_planned_vacation_still_blocks.
    legacy = _legacy_labels().get(code)
    if legacy is not None:
        return legacy
    return fallback or code


def _legacy_labels() -> dict[str, str]:
    """Тринадцать подписей старого словаря — как ФОЛБЭК, а не как источник."""
    model = apps.get_model("statuses", "EmployeeStatus")
    return {code: label for code, label in model.StatusType.choices}


# Compatibility defaults for imported personnel rows whose dictionary entry is
# absent. Live catalog entries, including inactive ones, override both maps.
LEGACY_REPORT_COLUMN_BY_STATUS = {
    "in_service": "in_service", "vacation": "vacation",
    "leave_by_report": "vacation", "sick_leave": "sick_leave",
    "business_trip": "business_trip", "training": "training",
    "competition": "training", "conference": "training",
    "on_duty": "on_duty", "after_duty": "after_duty",
    "other_absence": "other_absence", "seconded_to": "seconded_out",
    "seconded_from": "seconded_out",
}
LEGACY_STATUS_PRIORITY = {
    "sick_leave": 10, "leave_by_report": 15, "vacation": 20,
    "business_trip": 30, "training": 32, "competition": 34,
    "conference": 36, "other_absence": 38, "seconded_to": 40,
    "seconded_from": 50, "after_duty": 60, "on_duty": 70,
    "in_service": 999,
}
PERSONNEL_REPORT_COLUMNS = (
    ("in_service", "В строю"), ("vacation", "Отпуск"),
    ("sick_leave", "Больничный"), ("business_trip", "Командировка"),
    ("training", "Учёба"), ("on_duty", "На дежурстве"),
    ("after_duty", "После дежурства"), ("other_absence", "Прочие отсутствия"),
    ("seconded_out", "Откомандировано"),
)
_PERSONNEL_COLUMN_BY_CATALOG_COLUMN = {
    "IN_SERVICE": "in_service", "VACATION": "vacation",
    "SICK": "sick_leave", "SICK_LEAVE": "sick_leave",
    "COMMAND": "business_trip", "BUSINESS_TRIP": "business_trip",
    "TRAINING": "training", "ON_DUTY": "on_duty",
    "AFTER_DUTY": "after_duty", "OTHER": "other_absence",
    "OTHER_ABSENCE": "other_absence", "DETACHED": "seconded_out",
    # Personnel rows belong to the employee's home staff slot. Both historical
    # secondment aliases therefore leave that slot's in-service column.
    "ATTACHED": "seconded_out", "SECONDED_OUT": "seconded_out",
}


@dataclass(frozen=True)
class PersonnelReportingCatalog:
    """One catalog projection for date winners, breakdowns and documents."""

    code_by_alias: dict[str, str]
    priority: dict[str, int]
    column: dict[str, str]
    columns: tuple[tuple[str, str], ...]

    def code_for(self, code):
        return self.code_by_alias.get(code, code)

    def aliases_for(self, code):
        normalized = self.code_for(code)
        return tuple(alias for alias, target in self.code_by_alias.items() if target == normalized)

    def column_for(self, code):
        if code is None:
            return "in_service"
        # Missing historical dictionary entries must still conserve headcount.
        return self.column.get(code, "other_absence")


def personnel_reporting_catalog() -> PersonnelReportingCatalog:
    """Read aliases, priorities and report columns once per calculation.

    Inactive types remain readable: deactivation limits new choices, without
    erasing existing facts. The standard document columns retain their keys;
    additional catalog columns get their own printed header and a reserved key
    so a custom column named e.g. ``headcount`` cannot overwrite report totals.
    """
    aliases = {code: code for code in LEGACY_STATUS_PRIORITY}
    priority = dict(LEGACY_STATUS_PRIORITY)
    column = dict(LEGACY_REPORT_COLUMN_BY_STATUS)
    additional_columns = {}
    for row in _model().objects.all():
        normalized = _code_of(row)
        report_column = row.report_column_code
        target = _PERSONNEL_COLUMN_BY_CATALOG_COLUMN.get(report_column.upper())
        if target is None:
            if report_column:
                target = f"report_column:{report_column}"
                additional_columns[target] = report_column
            else:
                target = "other_absence"
        for alias in (row.code, row.legacy_code):
            if alias:
                aliases[alias] = normalized
                priority[alias] = row.priority
                column[alias] = target
    return PersonnelReportingCatalog(
        code_by_alias=aliases, priority=priority, column=column,
        columns=PERSONNEL_REPORT_COLUMNS + tuple(sorted(additional_columns.items())),
    )
