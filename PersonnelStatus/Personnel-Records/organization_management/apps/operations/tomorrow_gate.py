"""HTTP-гейт блокировки завтрашнего дня (порт
apps/operations/submissions/services/tomorrow_gate.py из Backend/VAPS).

Вывод блокировки отказов не поднимает — он отвечает на вопрос. Отказ живёт
здесь, между выводом и маршрутом: расход на БУДУЩУЮ дату при живой
блокировке — 422 TOMORROW_BLOCKED со списком отстающих.

Гейт стоит только на БУДУЩИХ датах: за прошедшие и за сегодня расход
формируется всегда. Смысл блокировки — «нельзя планировать завтра, пока не
известно сегодня»; закрыв ею прошлое, раздел запретил бы разбор уже
случившегося ровно тем, кому он нужнее всего.

Часы здесь НЕ читаются: сегодняшняя дата приходит аргументом от маршрута.
Иначе один и тот же вопрос про будущее получал бы разные ответы в
зависимости от того, чьи часы оказались ближе.
"""
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.selectors import DivisionTreeSelector
from organization_management.apps.operations.tomorrow_block import tomorrow_block


def assert_tomorrow_not_blocked(*, business_date, today):
    """Поднять 422 TOMORROW_BLOCKED, если завтрашний расход закрыт.

    Отстающие фильтруются от МУСОРА НАСТРОЙКИ — удалённых и отключённых
    подразделений — и фильтр стоит ДО решения: сдать за удалённое
    подразделение не может никто, поэтому список из одних призраков означал
    бы вечный замок с пустым и необъяснимым перечнем виноватых. Вывод при
    этом призраков не вычёркивает (там они видны как есть) — вычёркивает их
    тот, кто на основании списка ОТКАЗЫВАЕТ.

    Список отдаётся общий по разделу, а не суженный областью спросившего:
    заблокирован день целиком, и оператору, увидевшему в своей области всех
    сдавшими, отказ иначе выглядел бы беспричинным.

    Отличие от источника: id целые и в JSON едут как есть — там отстающие
    были UUID и требовали приведения к строке.
    """
    if business_date <= today:
        return
    block = tomorrow_block(business_date)
    if not block.blocked:
        return
    laggards = sorted(DivisionTreeSelector.active_ids(block.laggards))
    if not laggards:
        return
    raise DomainError(
        "TOMORROW_BLOCKED",
        422,
        detail={"laggards": laggards},
        message="Расход на завтра заблокирован: не все необходимые управления сдали.",
    )
