"""The roster import must also run the shared transaction guard (Plane #1175)."""
from organization_management.apps.ops.tests.test_ops_service_transactions import (
    test_every_caller_of_a_locking_helper_runs_inside_a_transaction,
    test_every_function_taking_a_row_lock_runs_inside_a_transaction,
    test_no_lock_lives_outside_the_packages_the_guard_reads,
    test_the_guard_actually_sees_the_services_it_promises_to_read,
)


def test_roster_import_transaction_guard_is_reachable():
    test_every_function_taking_a_row_lock_runs_inside_a_transaction()
    test_every_caller_of_a_locking_helper_runs_inside_a_transaction()
    test_the_guard_actually_sees_the_services_it_promises_to_read()
    test_no_lock_lives_outside_the_packages_the_guard_reads()
