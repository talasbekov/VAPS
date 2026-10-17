import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('org_diagnostic', Path(__file__).resolve().parents[1] / 'diagnose-org-structure.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


def node(pk, name, parent=None, tree=1, level=0, left=1, right=2, kind='organization'):
    return dict(id=pk, name=name, parent_id=parent, tree_id=tree, level=level,
                lft=left, rght=right, code='TEST-' + str(pk), division_type=kind, is_active=True)


class OrgDiagnosticTests(unittest.TestCase):
    def test_three_real_organizations_preserve_hospital_ancestry(self):
        rows = [node(1, 'Служба'), node(2, 'Воинская часть', tree=2),
                node(3, 'Госпиталь', tree=3, right=6),
                node(4, '1 управление', parent=3, tree=3, level=1, left=2, right=5, kind='directorate'),
                node(5, '2 отдел', parent=4, tree=3, level=2, left=3, right=4, kind='division')]
        result = diagnostic.analyze(rows)
        self.assertEqual(result['findings'], [])
        self.assertEqual(len(result['roots']), 3)
        self.assertEqual([item['id'] for item in result['divisions'][4]['path']], [3, 4, 5])
        self.assertEqual(result['counts_by_type']['organization'], 3)

    def test_nested_organization_is_not_assumed_invalid(self):
        result = diagnostic.analyze([node(1, 'Служба', right=4),
                                     node(2, 'Госпиталь', parent=1, level=1, left=2, right=3)])
        self.assertEqual(result['findings'], [])
        self.assertEqual([item['id'] for item in result['divisions'][1]['path']], [1, 2])

    def test_parent_cycle_terminates_and_is_explicit(self):
        result = diagnostic.analyze([node(1, 'A', parent=2), node(2, 'B', parent=1)])
        self.assertEqual({row['division_id'] for row in result['findings'] if row['kind'] == 'parent_cycle'}, {1, 2})
        self.assertTrue(all(len(row['path']) == 2 for row in result['divisions']))

    def test_missing_parent_is_reported_without_inventing_one(self):
        result = diagnostic.analyze([node(7, 'Отдел', parent=99, level=1)])
        self.assertEqual(result['roots'], [])
        self.assertEqual(result['findings'], [{'kind': 'missing_parent', 'division_id': 7, 'parent_id': 99}])
        self.assertEqual([row['id'] for row in result['divisions'][0]['path']], [7])

    def test_stale_mptt_does_not_replace_the_explicit_parent(self):
        result = diagnostic.analyze([node(1, 'Служба', right=4),
                                     node(2, 'Отдел', parent=1, tree=2, level=4, left=20, right=21)])
        self.assertEqual({row['kind'] for row in result['findings']}, {'mptt_parent_interval_mismatch', 'mptt_level_mismatch'})
        self.assertEqual(result['divisions'][1]['parent_id'], 1)
        self.assertEqual([row['id'] for row in result['divisions'][1]['path']], [1, 2])

    def test_empty_database_and_unstaffed_organization_are_not_lost(self):
        self.assertEqual(diagnostic.analyze([])['divisions'], [])
        result = diagnostic.analyze([node(9, 'Госпиталь')])
        self.assertEqual(result['division_count'], 1)
        self.assertEqual(result['roots'][0]['name'], 'Госпиталь')
        self.assertEqual(result['findings'], [])


if __name__ == '__main__':
    unittest.main()
