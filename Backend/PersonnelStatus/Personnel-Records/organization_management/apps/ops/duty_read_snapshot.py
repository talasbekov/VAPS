"""Keep multi-query duty reads at one PostgreSQL visibility point."""
from contextlib import contextmanager

from django.db import connection, transaction


@contextmanager
def read_snapshot():
    nested = connection.in_atomic_block
    with transaction.atomic():
        if not nested:
            # This is the first statement of the new read transaction. Nested
            # callers own their isolation; STATUS facts are additionally frozen
            # in the payload, never rejoined after canonical capture.
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        yield
