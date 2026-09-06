"""Сторож транзакций обязан подниматься и гейтом ЭТОГО раздела (Plane №841).

🔴 ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ НА ТРИ СТРОКИ. Сам сторож
(`ops/tests/test_ops_service_transactions.py`) читает сервисы ЧЕТЫРЁХ
приложений — `ops`, `operations`, `statuses`, `employees`, — а лежит в тестах
одного. Правило гейта «pytest по затронутым приложениям» означало, что правка
`operations/status_service.py` с прогоном `pytest apps/operations` сторожа НЕ
ЗАПУСКАЛА вовсе: проверка есть, а не выполняется — тот же класс, что №799
(файл проб не подходил под `python_files` и не собирался никогда) и №319
(сверка покрытия жила вне персон обхода).

Здесь не копия проверки, а её ВЫЗОВ: разойтись двум спискам правил неоткуда.
"""
from organization_management.apps.ops.tests.test_ops_service_transactions import (
    test_every_caller_of_a_locking_helper_runs_inside_a_transaction,
    test_every_function_taking_a_row_lock_runs_inside_a_transaction,
    test_no_lock_lives_outside_the_packages_the_guard_reads,
    test_the_guard_actually_sees_the_services_it_promises_to_read,
)


def test_the_transaction_guard_is_reachable_from_this_package():
    test_every_function_taking_a_row_lock_runs_inside_a_transaction()
    test_every_caller_of_a_locking_helper_runs_inside_a_transaction()
    test_the_guard_actually_sees_the_services_it_promises_to_read()
    test_no_lock_lives_outside_the_packages_the_guard_reads()
