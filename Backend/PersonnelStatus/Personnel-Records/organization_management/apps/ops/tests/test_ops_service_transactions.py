"""Сервисные операции, берущие замок строки, обязаны быть в транзакции.

🔴 ЗАЧЕМ ЭТА ПРОБА (Plane №477, разбор живого 500 на стенде). `select_for_update`
вне транзакции — не медленнее, а НЕВОЗМОЖЕН: Django поднимает
`TransactionManagementError`, и ручка отвечает 500.

Поймать это обычной пробой нельзя. `pytest.mark.django_db` заворачивает КАЖДЫЙ
тест в транзакцию, поэтому `select_for_update` в тестах работает всегда, а на
стенде — только у функции, которая транзакцию открыла сама. Ровно так и вышло:
полный прогон 4576 passed был зелёным, а `approval/send/` на стенде отвечал 500.

ПРИЧИНА ОДНА И ОНА МЕХАНИЧЕСКАЯ: помощник, вставленный между декоратором и
функцией, УНОСИТ декоратор себе. Строка `@transaction.atomic` осталась на
месте, глазами дифф выглядит невинно, а функция ниже стала не транзакционной.
Так потерял декоратор `add_journal_entry` (помощник `_incident_moment`, №766) и
так же чуть не уехал `send_for_approval` (№477).

🔴 ПРОБА СТЕРЕГЛА ТОЛЬКО `security_events.py` (Plane №797). Своих `lock_*` и
своих `select_for_update` хватает и у соседей — расход, статусы, дежурства,
рейтинги, отчёты, справочники, техника, — и та же вставка помощника уносит
декоратор там точно так же. Замерено при расширении: 84 функции берут замок
прямо или через помощника, и все они сегодня в транзакции; проба закрепляет
это, а не чинит найденное.

КАК СЧИТАЕТСЯ «В ТРАНЗАКЦИИ» — двумя способами, потому что в коде их два:
`@transaction.atomic` над функцией И `with transaction.atomic():` в теле.
Считать только декоратор значило бы объявить виновными шесть функций рейтингов
и отчётов, которые открывают транзакцию блоком, — проба врала бы, а её вывод
приучали бы пропускать.

ПОМОЩНИК, БЕРУЩИЙ ЗАМОК, СВОЕЙ ТРАНЗАКЦИИ НЕ ОТКРЫВАЕТ — И ЭТО ЗАКОННО:
`lock_event`, `_lock_employee`, `_lock_shift` и им подобные живут внутри
транзакции ВЫЗЫВАЮЩЕГО, и замок обязан пережить их возврат. Поэтому правило
для них другое и оно-то и есть предмет №477: **транзакционным обязан быть
каждый, кто такого помощника зовёт**. Именно это сломалось у
`send_for_approval` — помощник остался прежним, а вызывающий перестал быть
атомарным.

Проба читает ИСХОДНИКИ разбором, а не зовёт функции: список тех, кто берёт
замок, меняется, и перечислять их руками значило бы завести второй список,
который разойдётся с первым.
"""
import ast
import pathlib

APPS = pathlib.Path(__file__).resolve().parents[2]

#: Разделы, чьи сервисы читаются. Не весь проект: у моделей, миграций и
#: сериализаторов замков нет, а обход всего дерева стоил бы секунд на каждом
#: прогоне ради тех же файлов.
SERVICE_PACKAGES = ("ops", "operations", "statuses", "employees")

#: Как в коде берут построчный замок. `pg_advisory_xact_lock` — второй способ
#: (`operations/locks.py`), и он тоже живёт ровно до конца транзакции.
LOCK_CALLS = ("select_for_update", "pg_advisory_xact_lock")


def _service_sources():
    for package in SERVICE_PACKAGES:
        root = APPS / package
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            if "tests" in path.parts or "migrations" in path.parts:
                continue
            yield path


def _calls(node):
    return {
        ast.unparse(call.func).split(".")[-1]
        for call in ast.walk(node)
        if isinstance(call, ast.Call)
    }


def _opens_a_transaction(node):
    """Функция открыла транзакцию сама — декоратором ИЛИ блоком `with`."""
    decorators = [ast.unparse(d) for d in node.decorator_list]
    if decorators.count("transaction.atomic") == 1:
        return True
    for inner in ast.walk(node):
        if not isinstance(inner, (ast.With, ast.AsyncWith)):
            continue
        for item in inner.items:
            expression = ast.unparse(item.context_expr)
            if expression in ("transaction.atomic()", "atomic()"):
                return True
    return False


def _module_functions(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]


def _may_lean_on_the_caller(name):
    """Кому позволено брать замок без своей транзакции.

    🔴 ЭТО НЕ ПРИДИРКА К ИМЕНАМ, А ЕДИНСТВЕННЫЙ СПОСОБ ОСТАВИТЬ ПРОБУ ЗУБАСТОЙ.
    Если «помощником» считать любую нетранзакционную функцию в цепочке замка,
    то `send_for_approval`, потерявший декоратор, перестанет быть виновным и
    станет… помощником — то есть проба перестанет ловить ровно тот случай,
    ради которого заведена (№477).

    Поэтому опереться на транзакцию вызывающего может ТОЛЬКО служебное имя:
    приватное (`_lock_shift`, `_transition`) или начинающееся с `lock_`
    (`lock_event`). Всё, что названо как операция раздела, обязано открыть
    транзакцию само.
    """
    return name.startswith("_") or name.startswith("lock_")


def _scan():
    """Разбор всех сервисов: кто берёт замок сам, кто зовёт помощника."""
    functions = {}
    for path in _service_sources():
        for node in _module_functions(path):
            calls = _calls(node)
            functions[(path, node.name)] = {
                "node": node,
                "calls": calls,
                "atomic": _opens_a_transaction(node),
                "locks_directly": bool(calls & set(LOCK_CALLS)),
            }
    # Помощник — тот, кто берёт замок (сам или через другого помощника),
    # транзакции НЕ открывает и назван служебно: он рассчитывает на
    # вызывающего. Цепочка считается до неподвижной точки — `_transition`
    # зовёт `_lock_shift`, а замок от этого не перестаёт быть замком.
    helpers = {
        name
        for (_, name), info in functions.items()
        if info["locks_directly"] and not info["atomic"] and _may_lean_on_the_caller(name)
    }
    while True:
        grown = {
            name
            for (_, name), info in functions.items()
            if (info["calls"] & helpers)
            and not info["atomic"]
            and _may_lean_on_the_caller(name)
        }
        if grown <= helpers:
            break
        helpers |= grown
    return functions, helpers


def test_every_function_taking_a_row_lock_runs_inside_a_transaction():
    """Замок берётся сам — транзакция обязана быть своя (декоратор или блок)."""
    functions, helpers = _scan()
    guilty = {
        f"{path.relative_to(APPS)}::{name}": [
            ast.unparse(d) for d in info["node"].decorator_list
        ]
        for (path, name), info in functions.items()
        if info["locks_directly"] and not info["atomic"] and name not in helpers
    }
    assert guilty == {}, (
        "функции берут замок строки вне транзакции: "
        f"{guilty}. Вне транзакции `select_for_update` даёт 500 на стенде, "
        "а в тестах не падает — django_db сам заворачивает тест в транзакцию."
    )


def test_every_caller_of_a_locking_helper_runs_inside_a_transaction():
    """🔴 ПРЕДМЕТ №477 И №797.

    Помощник (`lock_event`, `_lock_employee`, `_lock_shift` …) транзакции не
    открывает намеренно — замок обязан пережить его возврат. Значит открыть её
    обязан ВЫЗЫВАЮЩИЙ. Ровно это и ломает вставленный под декоратор помощник:
    сам он остаётся прежним, а вызывающий перестаёт быть атомарным — и дифф
    выглядит невинно, потому что строка `@transaction.atomic` никуда не делась.
    """
    functions, helpers = _scan()
    guilty = {
        f"{path.relative_to(APPS)}::{name}": sorted(info["calls"] & helpers)
        for (path, name), info in functions.items()
        if (info["calls"] & helpers) and not info["atomic"] and name not in helpers
    }
    assert guilty == {}, (
        "функции зовут помощника, берущего замок, вне транзакции: "
        f"{guilty}. Помощник рассчитывает на транзакцию вызывающего; чаще "
        "всего декоратор увёл другой помощник, вставленный сразу под ним."
    )


def test_the_guard_actually_sees_the_services_it_promises_to_read():
    """🔴 СТОРОЖ, КОТОРЫЙ НИЧЕГО НЕ ЧИТАЕТ, ЗЕЛЁН ВСЕГДА.

    Обе пробы выше сравнивают пустой словарь с пустым, и опечатка в пути или
    в имени раздела сделала бы их вечнозелёными, ничего не проверяющими. Здесь
    названы нижние границы того, что разбор ОБЯЗАН найти: сами модули, помощник
    `lock_event` и заметное число его транзакционных вызывающих.
    """
    functions, helpers = _scan()
    modules = {path.name for path, _ in functions}
    assert {"security_events.py", "status_service.py", "ratings.py"} <= modules
    assert "lock_event" in helpers
    callers = [
        name
        for (_, name), info in functions.items()
        if "lock_event" in info["calls"] and info["atomic"]
    ]
    assert len(callers) > 30, callers
