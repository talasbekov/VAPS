"""Закрытый словарь кодов отказа: что он не пропускает.

Код отказа — часть договора с клиентом: по нему ветвится интерфейс. Опечатка в
коде не ломает ничего заметного на сервере (ответ уходит, статус верный), но
клиент такой код не сматчит никогда и молча свалится в ветку «неизвестная
ошибка». Проверка стоит в КОНСТРУКТОРЕ, а не только в тесте покрытия, по той же
причине, по которой словарь событий журнала проверяется на записи: тест видит
лишь те пути, по которым прошёл, конструктор — все.

Базы здесь нет: и словарь, и DomainError чисты.
"""
import pytest

from organization_management.apps.operations.error_codes import CODES, assert_known
from organization_management.apps.operations.exceptions import DomainError


# ── Конструктор сверяется со словарём ────────────────────────────────────


def test_a_declared_code_builds():
    error = DomainError("ENTITY_NOT_FOUND", 404)

    assert error.code == "ENTITY_NOT_FOUND"


def test_an_unknown_code_is_refused_at_construction():
    """Опечатка обязана падать здесь, а не уезжать клиенту в виде кода,
    который тот никогда не сматчит."""
    with pytest.raises(ValueError) as exc:
        DomainError("ENTITY_NOT_FUOND", 404)

    assert "ENTITY_NOT_FUOND" in str(exc.value)


def test_the_refusal_is_a_programming_error_and_not_a_domain_one():
    """ValueError, а не DomainError: незнакомый код — дефект вызывающего кода,
    и превратить его в ответ значило бы ответить опечаткой на осмысленный
    запрос."""
    with pytest.raises(ValueError):
        DomainError("НЕТ_ТАКОГО", 400)


def test_a_declared_code_with_a_foreign_status_is_refused():
    """Клиент ветвится по КОДУ. Один и тот же код, приходящий то 404, то 400,
    заставил бы его ветвиться ещё и по статусу — договор перестал бы быть
    договором."""
    with pytest.raises(ValueError) as exc:
        DomainError("ENTITY_NOT_FOUND", 400)

    assert "404" in str(exc.value)


def test_the_generic_code_may_carry_both_of_its_declared_statuses():
    """Единственное объявленное исключение: VALIDATION_ERROR покрывает и
    неверную нагрузку (400), и состояние, при котором операция невозможна (422).

    Оба статуса перечислены в словаре ЯВНО — чтобы это было решением, а не
    случайностью.
    """
    assert DomainError("VALIDATION_ERROR", 400).http_status == 400
    assert DomainError("VALIDATION_ERROR", 422).http_status == 422


def test_even_the_generic_code_has_a_boundary():
    """«Общий» не значит «любой»: 404 у VALIDATION_ERROR был бы не общностью,
    а ошибкой."""
    with pytest.raises(ValueError):
        DomainError("VALIDATION_ERROR", 404)


# ── Форма самого словаря ─────────────────────────────────────────────────


def test_every_code_declares_at_least_one_status():
    empty = [code for code, statuses in CODES.items() if not statuses]

    assert empty == []


def test_every_code_is_upper_snake_case():
    """Код уезжает в интерфейс и в переписку: разнобой в написании превратил бы
    сравнение строк в угадывание."""
    odd = [code for code in CODES if not code.replace("_", "").isupper()]

    assert odd == []


def test_only_one_code_is_allowed_to_be_ambiguous():
    """Расширение исключения должно быть ЗАМЕТНЫМ.

    Второй код с двумя статусами — это, скорее всего, не решение, а недосмотр:
    он проходит конструктор и не проходит здесь.
    """
    ambiguous = sorted(code for code, statuses in CODES.items() if len(statuses) > 1)

    assert ambiguous == ["VALIDATION_ERROR"]


def test_assert_known_names_the_offending_code():
    """Сообщение обязано называть виновника: «неизвестный код» без кода
    заставляет искать его глазами по стеку."""
    with pytest.raises(ValueError) as exc:
        assert_known("SOMETHING_ELSE", 400)

    assert "SOMETHING_ELSE" in str(exc.value)
    assert "CODES" in str(exc.value)


def test_no_code_is_declared_twice():
    """Ни один код не объявлен в словаре дважды (Plane №793).

    🔴 ЗАЧЕМ СТОРОЖ, ЕСЛИ ПОВЕДЕНИЕ НЕ СТРАДАЛО. `PLACEMENT_EMPTY` стоял ДВА
    раза — в блоке уведомлений о заступлении и в блоке согласования, — с
    одинаковым значением, поэтому второе объявление молча перекрывало первое и
    всё работало. Но словарь это закрытый договор с клиентом, и его читают
    ГЛАЗАМИ: правка одного из двух объявлений останется перекрытой вторым, и
    узнать об этом будет неоткуда. Ровно тот класс ошибки, который словарь и
    заведён предотвращать.

    Проверяется ИСХОДНИК, а не сам словарь: в словаре дубля уже нет по
    построению — Python оставляет последнее значение, и через `dict` эту
    ошибку не увидеть вовсе. Поэтому читается файл.
    """
    import ast
    import inspect

    from organization_management.apps.operations import error_codes

    source = inspect.getsource(error_codes)
    tree = ast.parse(source)
    seen, duplicated = set(), []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key in node.keys:
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                if key.value in seen:
                    duplicated.append(key.value)
                seen.add(key.value)

    assert duplicated == [], (
        "коды объявлены дважды: %s — второе объявление молча перекрывает "
        "первое, и правка одного из них потеряется беззвучно"
        % ", ".join(sorted(set(duplicated)))
    )
