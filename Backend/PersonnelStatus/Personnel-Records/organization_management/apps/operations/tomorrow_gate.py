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
from dataclasses import dataclass
from datetime import date

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.selectors import DivisionTreeSelector
from organization_management.apps.operations.tomorrow_block import tomorrow_block


@dataclass(frozen=True)
class ActionableBlock:
    """Блокировка ГЛАЗАМИ ОТВЕЧАЮЩЕГО: то же, что вывод, но без мусора и с
    учётом того, что гейт вообще смотрит только вперёд.

    Отдельный тип, а не второй вызов вывода на месте: отказ и его показ
    обязаны говорить одно и то же. Разбери каждый список отстающих сам — и
    экран рано или поздно объяснил бы отказ не тем перечнем, что стоял в
    отказе, а расхождение никто не заметил бы, пока не начали спрашивать
    людей из списка.
    """

    business_date: date
    blocked: bool
    laggards: list
    overridden: bool


def resolve_block(*, business_date, today) -> ActionableBlock:
    """Состояние блокировки для даты — единственный источник и для отказа,
    и для его показа.

    Прошлое и сегодня не блокируются НИКОГДА: смысл замка — «нельзя
    планировать завтра, пока не известно сегодня», и вывод для них даже не
    спрашивается (лишний запрос на каждом чтении расхода за прошлый день).

    Отстающие чистятся от МУСОРА НАСТРОЙКИ — удалённых и отключённых
    подразделений — и чистятся ДО решения: сдать за удалённое подразделение
    не может никто, поэтому список из одних призраков означал бы вечный
    замок с неисполнимым перечнем виноватых. Вывод призраков не вычёркивает
    (там они видны как есть) — вычёркивает их тот, кто на основании списка
    ОТВЕЧАЕТ.

    Отличие от источника: id целые и в JSON едут как есть — там отстающие
    были UUID и требовали приведения к строке.
    """
    if business_date <= today:
        return ActionableBlock(
            business_date=business_date, blocked=False, laggards=[], overridden=False
        )
    block = tomorrow_block(business_date)
    laggards = sorted(DivisionTreeSelector.active_ids(block.laggards))
    return ActionableBlock(
        business_date=business_date,
        blocked=block.blocked and bool(laggards),
        laggards=laggards,
        # Обход показывается ровно так, как его увидел вывод: снятым он
        # считается только там, где было что снимать.
        overridden=block.overridden,
    )


def assert_tomorrow_not_blocked(*, business_date, today):
    """Поднять 422 TOMORROW_BLOCKED, если завтрашний расход закрыт.

    Список отдаётся общий по разделу, а не суженный областью спросившего:
    заблокирован день целиком, и оператору, увидевшему в своей области всех
    сдавшими, отказ иначе выглядел бы беспричинным.
    """
    state = resolve_block(business_date=business_date, today=today)
    if not state.blocked:
        return
    raise DomainError(
        "TOMORROW_BLOCKED",
        422,
        detail={"laggards": state.laggards},
        message="Расход на завтра заблокирован: не все необходимые управления сдали.",
    )
