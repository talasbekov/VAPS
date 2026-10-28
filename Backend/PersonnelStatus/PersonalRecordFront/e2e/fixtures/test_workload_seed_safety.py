"""Exercise the real fixture module with inert ORM adapters, never a database."""
import builtins
from datetime import date
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).with_name('seed-workload-acceptance.py')
MODELS = ('User', 'Employee', 'Division', 'StaffUnit', 'OpsDutyLogEntry',
    'OpsDutyRecordSupplement', 'OpsEmployeeStatus', 'OpsStatusParticipation')


class ReachedSeeding(Exception):
    pass


def execute(*, database='sj_coverage_acceptance_safety', host='db', occupied=None, optimize=0):
    class Manager:
        def __init__(self, name):
            self.name = name

        def exists(self):
            return self.name == occupied

    models = {name: SimpleNamespace(objects=Manager(name)) for name in MODELS}
    class Atomic:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def reached(*_, **__):
        raise ReachedSeeding('Fixture reached its first write operation')

    def importing(name, globals=None, locals=None, fromlist=(), level=0):
        if name == 'django':
            return SimpleNamespace(setup=lambda: None)
        if name == 'django.conf':
            return SimpleNamespace(settings=SimpleNamespace(DATABASES={'default': {'NAME': database, 'HOST': host}}))
        if name == 'django.core.management':
            return SimpleNamespace(call_command=reached)
        if name == 'django.db':
            return SimpleNamespace(transaction=SimpleNamespace(atomic=Atomic))
        if name == 'organization_management.apps.operations.clock':
            return SimpleNamespace(Clock=SimpleNamespace(today_local=lambda: date(2026, 10, 27)))
        if name == 'organization_management.apps.operations.management.commands.seed_operations':
            return SimpleNamespace(PERMISSIONS=[], Command=lambda: SimpleNamespace(_seed_analytics=reached))
        if name.startswith(('django.contrib.auth.', 'organization_management.apps.')):
            return SimpleNamespace(**{symbol: models.get(symbol, SimpleNamespace()) for symbol in fromlist})
        return builtins.__import__(name, globals, locals, fromlist, level)

    original_path = sys.path[:]
    try:
        namespace = {'__builtins__': {**vars(builtins), '__import__': importing}}
        exec(compile(SOURCE.read_text(encoding='utf8'), str(SOURCE), 'exec', optimize=optimize), namespace)
    finally:
        sys.path[:] = original_path


class WorkloadSeedSafety(unittest.TestCase):
    def test_wrong_database_and_host_refuse_before_seeding(self):
        for optimize in (0, 1):
            for patch in ({'database': 'working_database'}, {'host': 'working-host'}):
                with self.subTest(optimize=optimize, patch=patch):
                    with self.assertRaises(RuntimeError):
                        execute(optimize=optimize, **patch)

    def test_existing_source_rows_refuse_even_without_employee_or_user(self):
        for optimize in (0, 1):
            for model in MODELS:
                with self.subTest(optimize=optimize, occupied=model):
                    with self.assertRaises(RuntimeError):
                        execute(occupied=model, optimize=optimize)

    def test_empty_isolated_database_can_reach_seeding(self):
        for optimize in (0, 1):
            with self.subTest(optimize=optimize):
                with self.assertRaises(ReachedSeeding):
                    execute(optimize=optimize)


if __name__ == '__main__':
    unittest.main()
