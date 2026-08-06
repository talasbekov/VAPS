"""Канон порядка личного состава: чем задаётся очередь и что её не сбивает.

Базы здесь нет — канон чист, и это его свойство, а не удобство теста: звать его
будут и построитель снимка, и рендерер документа.

Проверяется каждый ключ ПО ОТДЕЛЬНОСТИ и на фикстурах, где остальные ключи
совпадают. Иначе «сортирует по должности» неотличимо от «сортирует по чему
угодно, что в этих данных совпало с должностью».
"""
from organization_management.apps.operations.roster_order import (
    UNKNOWN_LEVEL,
    RosterGroup,
    order_roster,
    sort_key,
)


def person(employee_id, *, name="Иванов", level=10, group=RosterGroup.OWN):
    return {
        "employee_id": employee_id,
        "full_name": name,
        "position_level": level,
        "group": group,
    }


def names(entries):
    return [entry["full_name"] for entry in entries]


def ids(entries):
    return [entry["employee_id"] for entry in entries]


# ── Должность ────────────────────────────────────────────────────────────


def test_a_higher_position_comes_first_even_against_the_alphabet():
    """Меньше число — выше должность (так объявлено в справочнике), и фамилия
    здесь ВТОРИЧНА.

    Фикстура нарочно противопоставляет два ключа: по алфавиту порядок был бы
    обратным. Совпади они — тест не отличал бы сортировку по должности от
    сортировки по фамилии.
    """
    junior = person(1, name="Абрамов", level=50)
    senior = person(2, name="Яковлев", level=10)

    assert names(order_roster([junior, senior])) == ["Яковлев", "Абрамов"]


def test_three_levels_keep_their_order():
    """Три уровня, а не два: на двух «по возрастанию» неотличимо от «поменял
    местами»."""
    rows = [person(1, level=30), person(2, level=10), person(3, level=20)]

    assert [row["position_level"] for row in order_roster(rows)] == [10, 20, 30]


# ── Неизвестная должность ────────────────────────────────────────────────


def test_an_unknown_position_sinks_to_the_end_of_its_group():
    """Справочник на пилоте неполон, а расход печатают каждый день: падать
    нельзя, ставить такого человека первым — тем более."""
    known = person(1, name="Яковлев", level=90)
    unknown = person(2, name="Абрамов", level=None)

    assert names(order_roster([unknown, known])) == ["Яковлев", "Абрамов"]


def test_an_unknown_position_does_not_leave_its_group():
    """В КОНЕЦ СВОЕЙ ГРУППЫ, а не в конец списка: человек не перестал быть
    своим оттого, что его должность не нашлась."""
    own_unknown = person(1, name="Абрамов", level=None, group=RosterGroup.OWN)
    attached = person(2, name="Яковлев", level=10, group=RosterGroup.ATTACHED)

    assert ids(order_roster([attached, own_unknown])) == [1, 2]


def test_two_unknown_positions_fall_back_to_surname():
    """Провал ключа не должен превращать остаток в произвол: внутри «неизвестных»
    порядок задаёт фамилия."""
    rows = [
        person(1, name="Яковлев", level=None),
        person(2, name="Абрамов", level=None),
    ]

    assert names(order_roster(rows)) == ["Абрамов", "Яковлев"]


def test_the_sentinel_is_larger_than_any_plausible_level():
    assert UNKNOWN_LEVEL > 10_000


# ── Фамилия ──────────────────────────────────────────────────────────────


def test_surname_orders_people_of_one_level():
    rows = [
        person(1, name="Яковлев"),
        person(2, name="Абрамов"),
        person(3, name="Мельник"),
    ]

    assert names(order_roster(rows)) == ["Абрамов", "Мельник", "Яковлев"]


def test_yo_sorts_where_ye_sorts_and_not_before_the_alphabet():
    """«Ё» стоит в кодировке РАНЬШЕ «А», и наивное сравнение уводит Ёлкина в
    самое начало — перед Абрамовым.

    Одна такая фамилия ломает алфавит на глазах у того, кто документ
    подписывает. Проба ставит Ёлкина между Дроздовым и Жуковым — туда, где его
    ищет читатель.
    """
    rows = [
        person(1, name="Абрамов"),
        person(2, name="Ёлкин"),
        person(3, name="Дроздов"),
        person(4, name="Жуков"),
    ]

    assert names(order_roster(rows)) == ["Абрамов", "Дроздов", "Ёлкин", "Жуков"]


def test_case_does_not_split_one_surname_into_two():
    rows = [
        person(1, name="фон Дер"),
        person(2, name="Абрамов"),
        person(3, name="Фон дер"),
    ]

    ordered = names(order_roster(rows))
    assert ordered[0] == "Абрамов"
    assert set(ordered[1:]) == {"фон Дер", "Фон дер"}


def test_surrounding_spaces_do_not_move_a_person():
    rows = [person(1, name="  Яковлев "), person(2, name="Абрамов")]

    assert names(order_roster(rows)) == ["Абрамов", "  Яковлев "]


def test_a_missing_name_does_not_crash_the_order():
    """Пустое имя — плохие данные, но не повод не напечатать расход."""
    rows = [person(1, name=""), person(2, name="Абрамов")]

    assert ids(order_roster(rows)) == [1, 2]


# ── Блоки ────────────────────────────────────────────────────────────────


def test_own_then_attached_then_detached():
    """Порядок блоков — значение самого перечисления."""
    rows = [
        person(1, group=RosterGroup.DETACHED),
        person(2, group=RosterGroup.ATTACHED),
        person(3, group=RosterGroup.OWN),
    ]

    assert ids(order_roster(rows)) == [3, 2, 1]


def test_the_block_outranks_the_position():
    """Приданный генерал не встаёт над своим рядовым: блок — старший ключ.

    Иначе читателю пришлось бы выяснять принадлежность по каждой строке.
    """
    own_junior = person(1, name="Абрамов", level=90, group=RosterGroup.OWN)
    attached_senior = person(2, name="Яковлев", level=1, group=RosterGroup.ATTACHED)

    assert ids(order_roster([attached_senior, own_junior])) == [1, 2]


def test_the_group_defaults_to_own_when_not_supplied():
    """Запись без группы — свой: это самый частый случай, и требовать поле от
    каждого вызывающего значило бы плодить его повсюду."""
    assert sort_key({"employee_id": 1, "full_name": "Иванов"})[0] == int(
        RosterGroup.OWN
    )


# ── Устойчивость ─────────────────────────────────────────────────────────


def test_the_order_is_total_and_repeatable():
    """Полные однофамильцы на одном уровне: без последнего ключа документ,
    собранный дважды из одних данных, выходил бы разным — а его сравнивают с
    вчерашним, чтобы увидеть, что изменилось."""
    twins = [
        person(3, name="Иванов"),
        person(1, name="Иванов"),
        person(2, name="Иванов"),
    ]

    assert ids(order_roster(twins)) == [1, 2, 3]
    assert ids(order_roster(list(reversed(twins)))) == [1, 2, 3]


def test_the_input_is_not_mutated():
    """Канон зовут из построителя снимка: перетасуй он вход — снимок и документ
    разошлись бы порядком, каждый по-своему."""
    rows = [person(2), person(1)]
    before = list(rows)

    order_roster(rows)

    assert rows == before
