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

#: Типы, которые НЕ предлагаются в окне планирования. Прикомандирование и
#: откомандирование заводятся своим процессом (заявка и её согласование), и
#: выбор их руками в списке статусов создал бы вторую дверь в тот же факт.
NOT_SELECTABLE_LEGACY_CODES = frozenset({"seconded_from", "seconded_to"})


@dataclass(frozen=True)
class StatusTypeItem:
    """Строка каталога в том виде, в каком её ждёт клиент."""

    code: str
    label: str
    color: str


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
            if (row.legacy_code or "") in NOT_SELECTABLE_LEGACY_CODES:
                continue
        items.append(
            StatusTypeItem(code=_code_of(row), label=row.name, color=row.color)
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
