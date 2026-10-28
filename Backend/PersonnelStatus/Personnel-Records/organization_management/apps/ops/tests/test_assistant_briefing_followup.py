"""Pure follow-up facts; no catalog access, actor authority, or database required."""
import copy
import unittest

from organization_management.apps.ops.assistant import briefing


def previous():
    return {"objects": [
        {"name": "Аккорда", "sectorCount": 2, "personnelNeed": 5, "needStatus": "known", "sectors": [
            {"number": 1, "postCount": 2, "posts": [
                {"number": 1, "need": None, "subpostCount": 1, "subposts": [{"number": 1, "need": None}]},
                {"number": 2, "need": None, "subpostCount": 0, "subposts": []}]},
            {"number": 2, "postCount": 1, "posts": [{"number": 1, "need": 7, "subpostCount": 0, "subposts": []}]}]},
        {"name": "Тарлан", "sectorCount": 0, "personnelNeed": 8, "needStatus": "known", "sectors": []}],
        "protectedPersons": [{"code": "800"}], "issues": []}


class BriefingFollowupTests(unittest.TestCase):
    def apply(self, message, patch=None, old=None):
        from organization_management.apps.ops.assistant.briefing_followup import apply_followup
        return apply_followup(message, patch, old or previous())

    def test_explicit_post_and_subpost_need_preserve_object_total_and_unrelated_structure(self):
        old = previous()
        before = copy.deepcopy(old)
        base = briefing.extract_briefing('Для Аккорды: в секторе 1 на пост 1 нужно 2 человека, на подпост 1 нужно 1 человек.', previous=old)
        patch = self.apply('Для Аккорды: в секторе 1 на пост 1 нужно 2 человека, на подпост 1 нужно 1 человек.', base, old)
        obj = patch['objects'][0]
        self.assertEqual(obj['personnelNeed'], 5)
        self.assertEqual(obj['sectors'][0]['posts'][0]['need'], 2)
        self.assertEqual(obj['sectors'][0]['posts'][0]['subposts'][0]['need'], 1)
        self.assertEqual(obj['sectors'][0]['posts'][1]['need'], None)
        self.assertEqual(obj['sectors'][1]['posts'][0]['need'], 7)
        self.assertEqual(old, before)

    def test_bulk_people_are_scoped_to_named_object_and_sector(self):
        patch = self.apply('Аккорда: в секторе 1 на каждом посту по 2 человека, на каждом подпосту по одному человеку.')
        obj = patch['objects'][0]
        self.assertEqual([p['need'] for p in obj['sectors'][0]['posts']], [2, 2])
        self.assertEqual(obj['sectors'][0]['posts'][0]['subposts'][0]['need'], 1)
        self.assertEqual(obj['sectors'][1]['posts'][0]['need'], 7)
        self.assertEqual(obj['personnelNeed'], 5)
        self.assertEqual([o['name'] for o in patch['objects']], ['Аккорда'])

    def test_ambiguous_unnamed_object_or_sector_never_assigns_people(self):
        self.assertIsNone(self.apply('На каждом посту по 2 человека.'))
        patch = self.apply('Аккорда: на пост 1 нужно 2 человека.')
        self.assertTrue(patch['issues'])
        self.assertTrue(all(p['need'] is None for p in patch['objects'][0]['sectors'][0]['posts']))

    def test_ambiguous_post_amount_cannot_become_object_demand_in_actual_extract_merge(self):
        old = previous()
        patch = briefing.extract_briefing('Аккорда: на пост 1 нужно 2 человека.', previous=old)
        merged = briefing.merge_briefing(old, patch)
        obj = merged['objects'][0]
        self.assertEqual(obj['personnelNeed'], 5)
        self.assertTrue(all(p['need'] is None for p in obj['sectors'][0]['posts']))

    def test_later_explicit_sector_resolves_the_helpers_own_sector_question(self):
        old = previous()
        patch = briefing.extract_briefing('Аккорда: на пост 1 нужно 2 человека.', previous=old)
        old = briefing.merge_briefing(old, patch)
        patch = briefing.extract_briefing('Аккорда: в секторе 1 на пост 1 нужно 2 человека.', previous=old)
        merged = briefing.merge_briefing(old, patch)
        self.assertFalse(any('уточните сектор для поста 1' in issue['text'] for issue in merged['issues']))
        self.assertEqual(merged['objects'][0]['sectors'][0]['posts'][0]['need'], 2)

    def test_checked_declaration_does_not_invent_normal_but_explicit_all_normal_does(self):
        checked = self.apply('Аккорда: чек-лист проверен.')
        self.assertFalse(checked['objects'][0].get('checklistResults'))
        normal = self.apply('Аккорда: по всем пунктам чек-листа норма, замечаний нет.')
        self.assertEqual([row['state'] for row in normal['objects'][0]['checklistResults']], ['NORMAL'] * 5)

    def test_explicit_all_objects_normal_answer_applies_to_all_previous_objects(self):
        patch = self.apply('На всех объектах по всем пунктам чек-листа норма, замечаний нет.')
        self.assertEqual([obj['name'] for obj in patch['objects']], ['Аккорда', 'Тарлан'])
        self.assertTrue(all(len(obj['checklistResults']) == 5 for obj in patch['objects']))
        self.assertEqual([obj['personnelNeed'] for obj in patch['objects']], [5, 8])

    def test_all_objects_dative_answer_targets_checklist_only_and_bare_normal_is_unresolved(self):
        old = previous()
        patch = self.apply('По всем объектам все пункты чек-листа норма. На каждом посту по 2 человека.', old=old)
        self.assertEqual([obj['name'] for obj in patch['objects']], ['Аккорда', 'Тарлан'])
        self.assertTrue(all(len(obj['checklistResults']) == 5 for obj in patch['objects']))
        self.assertEqual([obj['sectors'] for obj in patch['objects']], [obj['sectors'] for obj in old['objects']])
        self.assertEqual([obj['personnelNeed'] for obj in patch['objects']], [5, 8])
        self.assertIsNone(self.apply('Все нормально.', old=old))

    def test_explicit_numbered_remark_preserves_comment_and_other_unchecked_items(self):
        patch = self.apply('Аккорда: пункт 2 чек-листа: замечание — повреждено ограждение.')
        results = patch['objects'][0]['checklistResults']
        self.assertEqual(results, [{'id': 'checklist-1', 'state': 'REMARK', 'comment': 'повреждено ограждение'}])
        self.assertFalse(patch['objects'][0].get('checklistChecked'))

    def test_named_checklist_results_keep_comment_case_and_do_not_fill_unmentioned_items(self):
        patch = self.apply('Аккорда: результаты чек-листа: подъезд NORMAL, вход NORMAL; ограждение: замечание — Повреждение КПП-2.')
        results = {row['id']: row for row in patch['objects'][0]['checklistResults']}
        self.assertEqual(set(results), {'checklist-0', 'checklist-1', 'checklist-2'})
        self.assertEqual(results['checklist-0']['state'], 'NORMAL')
        self.assertEqual(results['checklist-2']['state'], 'NORMAL')
        self.assertEqual(results['checklist-1']['comment'], 'Повреждение КПП-2')

    def test_foreign_identity_answer_without_object_is_kept_and_creation_requires_explicit_words(self):
        patch = self.apply('ФИО иностранного ОЛ Шавкат Мирзеев, страна Узбекистан, создай такого иностранного ОЛ.')
        self.assertEqual(patch['objects'], [])
        self.assertEqual(patch['protectedPersons'], [{'name': 'Шавкат Мирзеев', 'country': 'Узбекистан', 'createIfMissing': True}])
        denied = self.apply('ФИО иностранного ОЛ Шавкат Мирзеев, страна Узбекистан, не создавай иностранного ОЛ.')
        self.assertFalse(denied['protectedPersons'][0]['createIfMissing'])

    def test_singular_foreign_identity_correction_marks_only_one_previous_foreign_person_for_replacement(self):
        old = previous()
        old['protectedPersons'].append({'name': 'Прежнее Имя', 'country': 'Узбекистан', 'personId': '77'})
        patch = self.apply('ФИО иностранного ОЛ Новое Имя, страна Казахстан.', old=old)
        self.assertIs(patch.get('replaceForeignPerson'), True)
        self.assertNotIn('personId', patch['protectedPersons'][0])

    def test_add_another_or_ambiguous_foreign_identity_never_replaces_previous_people(self):
        old = previous()
        old['protectedPersons'].append({'name': 'Прежнее Имя', 'country': 'Узбекистан'})
        patch = self.apply('Добавь еще одного иностранного ОЛ. ФИО иностранного ОЛ Новое Имя, страна Казахстан.', old=old)
        self.assertFalse(patch.get('replaceForeignPerson'))
        old['protectedPersons'].append({'name': 'Другое Имя', 'country': 'Кыргызстан'})
        patch = self.apply('ФИО иностранного ОЛ Новое Имя, страна Казахстан.', old=old)
        self.assertFalse(patch.get('replaceForeignPerson'))
        initial = self.apply('ФИО иностранного ОЛ Новое Имя, страна Казахстан.')
        self.assertFalse(initial.get('replaceForeignPerson'))

    def test_explicit_sector_post_and_subpost_clarification_can_fill_missing_structure(self):
        patch = self.apply('Аккорда: во втором секторе 2 поста. У первого поста 1 подпост, у второго поста без подпостов.')
        sector = patch['objects'][0]['sectors'][1]
        self.assertEqual(sector['postCount'], 2)
        self.assertEqual([p['subpostCount'] for p in sector['posts']], [1, 0])
        self.assertEqual(sector['posts'][0]['need'], 7)

    def test_explicit_unknown_object_need_is_not_restored_from_old_known_total(self):
        old = previous()
        message = 'Аккорда: потребность неизвестна. В секторе 1 на каждом посту по 2 человека.'
        patch = briefing.extract_briefing(message, previous=old)
        patch = self.apply(message, patch, old)
        self.assertIsNone(patch['objects'][0]['personnelNeed'])
        self.assertEqual(patch['objects'][0]['needStatus'], 'unknown')

    def test_negated_or_questioned_all_normal_is_not_a_normal_declaration(self):
        for message in ['Аккорда: не по всем пунктам чек-листа норма.',
                        'Аккорда: по всем пунктам чек-листа норма?']:
            patch = self.apply(message)
            self.assertFalse(patch['objects'][0].get('checklistResults'), message)

    def test_resolves_only_the_foreign_detail_issue_when_identity_is_supplied(self):
        old = previous()
        resolved = 'Укажите ФИО и страну иностранного охраняемого лица.'
        old['issues'] = [{'field': 'briefing', 'text': resolved}, {'field': 'briefing', 'text': 'Уточните старшего Аккорды.'}]
        patch = self.apply('ФИО иностранного ОЛ Шавкат Мирзеев, страна Узбекистан.', old=old)
        self.assertEqual(patch['resolvedIssues'], [resolved])

    def test_explicit_third_post_sector_resolves_only_matching_object_issue(self):
        old = previous()
        old['objects'][0]['sectors'][1]['postCount'] = 3
        old['objects'][0]['sectors'][1]['posts'].extend([
            {'number': 2, 'need': None, 'subpostCount': None, 'subposts': []},
            {'number': 3, 'need': None, 'subpostCount': None, 'subposts': []}])
        resolved = '«Аккорда»: уточните, к какому сектору относится указанный третий пост с подпостом.'
        other = '«Тарлан»: уточните, к какому сектору относится указанный третий пост с подпостом.'
        old['issues'] = [{'field': 'briefing', 'text': resolved}, {'field': 'briefing', 'text': other}]
        patch = self.apply('Аккорда: во втором секторе третий пост имеет один подпост.', old=old)
        self.assertEqual(patch['objects'][0]['sectors'][1]['posts'][2]['subpostCount'], 1)
        self.assertEqual(patch['resolvedIssues'], [resolved])


if __name__ == '__main__':
    unittest.main()
