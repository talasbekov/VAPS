"""Сервисные операции ОМ, берущие замок строки, обязаны быть в транзакции.

🔴 ЗАЧЕМ ЭТА ПРОБА (Plane №477, разбор живого 500 на стенде). `lock_event`
берёт `select_for_update`, а он вне транзакции — не медленнее, а НЕВОЗМОЖЕН:
Django поднимает `TransactionManagementError`, и ручка отвечает 500.

Поймать это обычной пробой нельзя. `pytest.mark.django_db` заворачивает КАЖДЫЙ
тест в транзакцию, поэтому `select_for_update` в тестах работает всегда, а на
стенде — только у функции с `@transaction.atomic`. Ровно так и вышло: полный
прогон 4576 passed был зелёным, а `approval/send/` на стенде отвечал 500.

ПРИЧИНА ОДНА И ОНА МЕХАНИЧЕСКАЯ: помощник, вставленный между декоратором и
функцией, УНОСИТ декоратор себе. Строка `@transaction.atomic` осталась на
месте, глазами дифф выглядит невинно, а функция ниже стала не транзакционной.
Так потерял декоратор `add_journal_entry` (помощник `_incident_moment`, №766) и
так же чуть не уехал `send_for_approval`.

Проба читает ИСХОДНИК разбором, а не зовёт функции: список тех, кто берёт
замок, меняется, и перечислять их руками значило бы завести второй список,
который разойдётся с первым.
"""
import ast
import pathlib

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "security_events.py"


def _functions_taking_the_lock():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        calls = {
            ast.unparse(call.func)
            for call in ast.walk(node)
            if isinstance(call, ast.Call)
        }
        if "lock_event" in calls:
            yield node


def test_every_locking_operation_is_atomic():
    guilty = {
        node.name: [ast.unparse(d) for d in node.decorator_list]
        for node in _functions_taking_the_lock()
        if [ast.unparse(d) for d in node.decorator_list].count("transaction.atomic") != 1
    }
    assert guilty == {}, (
        "функции берут замок строки без ровно одного @transaction.atomic: "
        f"{guilty}. Вне транзакции `select_for_update` даёт 500 на стенде, "
        "а в тестах не падает — django_db сам заворачивает тест в транзакцию. "
        "Чаще всего декоратор увёл помощник, вставленный сразу под ним."
    )
