"""Операции, берущие замок строки, живут в транзакции — во ВСЁМ разделе.

🔴 ЗАЧЕМ ЭТА ПРОБА (Plane №477 → №797). `select_for_update` вне транзакции —
не медленнее, а НЕВОЗМОЖЕН: Django поднимает `TransactionManagementError`, и
ручка отвечает 500.

Поймать это обычной пробой нельзя. `pytest.mark.django_db` заворачивает КАЖДЫЙ
тест в транзакцию, поэтому `select_for_update` в тестах работает всегда, а на
стенде — только у функции с `@transaction.atomic`. Ровно так и вышло: полный
прогон 4576 passed был зелёным, а `approval/send/` на стенде отвечал 500.

ПРИЧИНА ОДНА И ОНА МЕХАНИЧЕСКАЯ: помощник, вставленный между декоратором и
функцией, УНОСИТ декоратор себе. Строка `@transaction.atomic` остаётся на
месте, дифф выглядит невинно, а функция ниже перестаёт быть транзакционной. За
один заход 05.09.2026 это случилось ТРИЖДЫ (№477, №510, №490) — значит правило
надо стеречь, а не помнить.

ПОЧЕМУ РАЗБОР ИСХОДНИКА, А НЕ ВЫЗОВ ФУНКЦИЙ. Список тех, кто берёт замок,
меняется каждую неделю; перечислять их руками значило бы завести второй
список, который разойдётся с первым. Здесь он читается из кода.

ПРАВИЛО ТОЧНОЕ, А НЕ «ВСЕМ ПОСТАВИТЬ ДЕКОРАТОР»:

* берущей замок считается функция, чьё имя начинается на `lock`/`_lock` И
  внутри которой есть `select_for_update` — так помощник отличается от
  случайного совпадения имени;
* её ВЫЗЫВАЮЩИЙ обязан быть атомарным — ровно один `@transaction.atomic`
  (двойной декоратор тоже дефект: он след той же вставки, №485);
* ЧАСТНЫЙ ПОМОЩНИК, все вызывающие которого в том же модуле атомарны, не
  обязан: транзакция уже открыта выше, и второй декоратор был бы точкой
  сохранения без нужды;
* исключения объявлены ПОИМЁННО и с причиной — ниже. Молчаливого исключения
  быть не может: правило, у которого есть неназванные дыры, не правило.
"""
import ast
import pathlib

APPS = pathlib.Path(__file__).resolve().parents[2]
SCANNED = ("ops", "operations")

#: Функции, которым транзакция ЗАПРЕЩЕНА, с причиной. Проверяется и обратное:
#: имя из этого списка обязано существовать (иначе исключение переживёт свой
#: предмет и станет молчаливой дырой).
EXEMPT = {
    # Контракт написан в самой функции: номер выдаётся ВНУТРИ транзакции того,
    # кто выпускает документ, и построчный замок держится до ЕГО коммита —
    # тогда откат снимает и инкремент, и следующий выпуск берёт тот же номер.
    # Своя транзакция сломала бы это ровно наоборот: инкремент пережил бы
    # откат вызывающего и оставил дырку в нумерации.
    "allocate_number": "выдаёт номер внутри транзакции вызывающего (contract в докстринге)",
}


def _sources():
    for name in SCANNED:
        for path in (APPS / name).rglob("*.py"):
            if "tests" in path.parts or "migrations" in path.parts:
                continue
            yield path


def _atomic(node):
    return [ast.unparse(d) for d in node.decorator_list].count("transaction.atomic") == 1


def _calls(node):
    return {
        ast.unparse(call.func).split(".")[-1]
        for call in ast.walk(node)
        if isinstance(call, ast.Call)
    }


def test_every_locking_operation_is_atomic():
    lockers, trees = set(), {}
    for path in _sources():
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover — чужая правка на середине
            continue
        trees[path] = tree
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            if node.name.lstrip("_").startswith("lock") and "select_for_update" in ast.unparse(node):
                lockers.add(node.name)
    assert lockers, "не нашлось ни одной функции-замка — разбор сломан"

    guilty, seen_exempt = {}, set()
    for path, tree in trees.items():
        funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, node in funcs.items():
            if name in lockers or not (_calls(node) & lockers) or _atomic(node):
                continue
            if name in EXEMPT:
                seen_exempt.add(name)
                continue
            callers = [
                other
                for other in funcs.values()
                if other is not node and name in _calls(other)
            ]
            if callers and all(_atomic(other) for other in callers):
                continue
            guilty[f"{path.name}:{node.lineno} {name}"] = [
                ast.unparse(d) for d in node.decorator_list
            ]
    assert guilty == {}, (
        "функции берут замок строки вне транзакции: "
        f"{guilty}. Вне транзакции `select_for_update` даёт 500 на стенде, а в "
        "тестах не падает — django_db сам заворачивает тест в транзакцию. Чаще "
        "всего декоратор увёл помощник, вставленный сразу под ним."
    )
    missing = set(EXEMPT) - seen_exempt
    assert missing == set(), (
        f"исключение объявлено, а предмета нет: {sorted(missing)}. Исключение, "
        "пережившее свою функцию, — молчаливая дыра в правиле."
    )
