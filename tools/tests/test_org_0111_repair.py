import importlib.util
from pathlib import Path
import unittest


def fixture():
    names = {
        690: ('СГО РК', 'organization', None),
        691: ('Воинская часть 0116', 'department', 690),
        716: ('Воинская часть 0111', 'department', 690),
        761: ('1 управление Воинской части 0111', 'directorate', 716),
        762: ('2 управление Воинской части 0111', 'directorate', 716),
        767: ('3 управление Воинской части 0111', 'directorate', 716),
        693: ('Отдел служебно-боевой работы и связи Управление части Воинской части 0111', 'department', 690),
        694: ('Отдел боевой и специальной подготовки Управление части Воинской части 0111', 'department', 690),
        695: ('1 группа 1 отдела 1 управления Воинской части 0111', 'department', 690),
        696: ('2 группа 1 отдела 1 управления Воинской части 0111', 'department', 690),
        702: ('1 группа 1 отдела 2 управления Воинской части 0111', 'department', 690),
        703: ('2 группа 1 отдела 2 управления Воинской части 0111', 'department', 690),
        704: ('Отделение строевого учета управления части Воинской части 0111', 'department', 690),
        711: ('Отделение защиты государственных секретов управления части Воинской части 0111', 'department', 690),
        726: ('Отдел финансового обеспечения Воинской части 0116 Госпиталю', 'division', 691),
        737: ('Отделение медицинского обеспечения Воинской части 0111', 'division', 716),
        843: ('2 отдел 1 управления Воинской части 0111', 'division', 761),
        879: ('2 отдел 2 управления Воинской части 0111', 'division', 762),
        925: ('2 отдел 3 управление Воинской части 0111', 'division', 767),
        951: ('1 группа 2 отдела 1 управления Воинской части 0111', 'division', 843),
    }
    return [dict(id=pk, name=name, division_type=kind, parent_id=parent, code='import-' + str(pk))
            for pk, (name, kind, parent) in names.items()]


class Org0111PlanTests(unittest.TestCase):
    def setUp(self):
        file = Path(__file__).resolve().parents[1] / 'org-0111-repair-checks.py'
        self.assertTrue(file.is_file(), 'Guarded repair of the confirmed production hierarchy is missing')
        spec = importlib.util.spec_from_file_location('org_0111_checks', file)
        self.checks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.checks)

    def test_confirmed_bad_hierarchy_gets_three_ancestors_and_only_eight_moves(self):
        rows = fixture()
        before = [dict(row) for row in rows]
        plan = self.checks.build_plan(rows)
        self.assertEqual(rows, before)
        self.assertEqual(len(plan['create']), 3)
        self.assertEqual({row['id'] for row in plan['changes']}, {693, 694, 695, 696, 702, 703, 704, 711})
        self.assertEqual({row['after']['parent_id'] for row in plan['changes'] if row['id'] in (702, 703)}, {'u2d1'})
        self.assertTrue(all(row['after']['division_type'] == 'division' for row in plan['changes']))
        self.assertNotIn(691, {row['id'] for row in plan['changes']})
        self.assertNotIn(716, {row['id'] for row in plan['changes']})

    def test_existing_exact_ancestors_are_reused_and_second_apply_is_empty(self):
        rows = fixture()
        initial = self.checks.build_plan(rows)
        aliases = {}
        for index, node in enumerate(initial['create'], 1100):
            parent = aliases.get(node['parent_id'], node['parent_id'])
            rows.append(dict(id=index, name=node['name'], code=node['code'], division_type=node['division_type'], parent_id=parent))
            aliases[node['ref']] = index
        plan = self.checks.build_plan(rows)
        self.assertEqual(plan['create'], [])
        for change in plan['changes']:
            row = next(row for row in rows if row['id'] == change['id'])
            row.update(change['after'])
        self.assertEqual(self.checks.build_plan(rows)['changes'], [])
        self.assertEqual(self.checks.build_plan(rows)['create'], [])

    def test_valid_existing_first_department_without_patch_code_is_reused(self):
        rows = fixture()
        rows.append(dict(id=1010, name='1 отдел', code='original-import-code', division_type='division', parent_id=761))
        plan = self.checks.build_plan(rows)
        self.assertNotIn('u1d1', {row['ref'] for row in plan['create']})
        self.assertEqual({row['after']['parent_id'] for row in plan['changes'] if row['id'] in (695, 696)}, {1010})

    def test_wrong_known_id_name_parent_or_type_fails_closed(self):
        for pk, changes in ((703, {'name': 'Another unit'}), (703, {'parent_id': 691}),
                            (703, {'division_type': 'organization'}), (762, {'parent_id': 691}),
                            (716, {'division_type': 'organization'})):
            with self.subTest(pk=pk, changes=changes):
                rows = fixture()
                next(row for row in rows if row['id'] == pk).update(changes)
                with self.assertRaisesRegex(RuntimeError, 'changed|Unexpected|ambiguous'):
                    self.checks.build_plan(rows)

    def test_duplicate_or_elsewhere_named_intermediate_does_not_create_a_duplicate(self):
        for parents in ((761, 761), (690,)):
            rows = fixture()
            for index, parent in enumerate(parents, 1100):
                rows.append(dict(id=index, name='1 отдел 1 управления Воинской части 0111', code='existing-' + str(index),
                                 division_type='division', parent_id=parent))
            with self.subTest(parents=parents), self.assertRaisesRegex(RuntimeError, 'ambiguous|elsewhere|parent'):
                self.checks.build_plan(rows)

    def test_missing_anchor_or_parent_cycle_refuses_before_work(self):
        rows = [row for row in fixture() if row['id'] != 762]
        with self.assertRaises(RuntimeError):
            self.checks.build_plan(rows)
        rows = fixture()
        rows.append(dict(id=1200, name='Unrelated cycle', code='cycle', division_type='division', parent_id=1200))
        with self.assertRaisesRegex(RuntimeError, 'cycle'):
            self.checks.build_plan(rows)


if __name__ == '__main__':
    unittest.main()
