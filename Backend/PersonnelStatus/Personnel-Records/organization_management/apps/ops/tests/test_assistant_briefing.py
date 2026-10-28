import pytest

from organization_management.apps.ops.assistant import briefing


COMMON = ('Охраняемые лица которые посетят эти объекты 800, 802, 803. '
    'У объекта Аккорды, 2 сектора будет, у первого сектора 3 поста, первые два поста имеют по одному подпосту '
    'а третьи не имеет подпоста; у Тарлана три сектора, у первого сектора 3 поста без подпостов, '
    'у второго 1 пост с двумя подпостами, у тертьего поста один подпост. '
    'У тарлана старший объекта Улан Мусахан, у Аккорды Еламан мейрам, у Бейбитшилик сарайы асет аскен. '
    'Запроси для Аккорды пять человек, для Тарлана 8 человек, для Бейбитшилик сарайы пока не нужны люди, '
    'еще неизвестно. Все объекты по чек листу проверены.')
INTERNAL = 'Подготовь наряд на внутреннее мероприятие «Встреча» 25.10.2026 на объектах Аккорда, Тарлан, Бейбитшилик сарайы. ' + COMMON
FOREIGN = ('Подготовь наряд на визит иностранного ОЛ «Встреча» 25.10.2026 на объектах Аккорда, Тарлан, '
    'Бейбитшилик сарайы, Ритц-Карлтон. ' + COMMON.replace('800, 802, 803.', '800, 802, 803 и иностранный ОЛ.')
    + ' ФИО иностранного ОЛ Шавкат Мирзеев, страна Узбекистан, если его в справочниках нет то создай такого иностранного ОЛ.')
NAMES = ['Аккорда', 'Тарлан', 'Бейбитшилик сарайы', 'Ритц-Карлтон']


def rows(value):
    return {row['name']: row for row in value['objects']}


def test_internal_keeps_each_object_structure_chief_and_unknown_demand():
    value = briefing.extract_briefing(INTERNAL, object_names=NAMES)
    objects = rows(value)
    assert set(objects) == set(NAMES[:3])
    assert objects['Аккорда']['sectorCount'] == 2
    assert objects['Тарлан']['sectorCount'] == 3
    assert objects['Аккорда']['personnelNeed'] == 5
    assert objects['Тарлан']['personnelNeed'] == 8
    assert objects['Бейбитшилик сарайы']['personnelNeed'] is None
    assert objects['Бейбитшилик сарайы']['needStatus'] == 'unknown'
    assert objects['Тарлан']['chiefName'] == 'Улан Мусахан'
    assert objects['Аккорда']['chiefName'] == 'Еламан мейрам'
    assert objects['Аккорда']['sectors'][0]['postCount'] == 3
    assert [p['subpostCount'] for p in objects['Аккорда']['sectors'][0]['posts']] == [1, 1, 0]
    assert [p['subpostCount'] for p in objects['Тарлан']['sectors'][0]['posts']] == [0, 0, 0]
    assert objects['Тарлан']['sectors'][1]['posts'][0]['subpostCount'] == 2
    assert all(p['need'] is None for p in objects['Аккорда']['sectors'][0]['posts'])
    assert all(o['checklistChecked'] is True for o in objects.values())
    assert [p['code'] for p in value['protectedPersons']] == ['800', '802', '803']
    questions = ' '.join(row['text'] for row in briefing.completeness_questions(value))
    assert 'Аккорда' in questions and 'сектор 2' in questions
    assert 'Тарлан' in questions and 'сектор 3' in questions
    assert 'Бейбитшилик' in questions
    assert any('пост' in row['text'] for row in value['issues'])


def test_foreign_keeps_fourth_object_and_explicit_person_creation():
    value = briefing.extract_briefing(FOREIGN, object_names=NAMES)
    objects = rows(value)
    assert set(objects) == set(NAMES)
    assert objects['Ритц-Карлтон']['chiefName'] is None
    assert objects['Ритц-Карлтон']['personnelNeed'] is None
    foreign = value['protectedPersons'][-1]
    assert foreign['name'] == 'Шавкат Мирзеев'
    assert foreign['country'] == 'Узбекистан'
    assert foreign['createIfMissing'] is True
    questions = ' '.join(row['text'] for row in briefing.completeness_questions(value))
    assert 'Ритц-Карлтон' in questions
    assert 'результат' in questions


def test_followup_merges_one_object_without_losing_others_or_unknown_zero_distinction():
    original = briefing.extract_briefing(FOREIGN, object_names=NAMES)
    patch = briefing.extract_briefing('Для Бейбитшилик сарайы нужно 0 человек.', object_names=NAMES, previous=original)
    merged = briefing.merge_briefing(original, patch)
    assert rows(merged)['Бейбитшилик сарайы']['personnelNeed'] == 0
    assert rows(merged)['Бейбитшилик сарайы']['needStatus'] == 'known'
    assert rows(merged)['Тарлан']['personnelNeed'] == 8
    assert rows(merged)['Аккорда']['sectorCount'] == 2
    assert merged['protectedPersons'] == original['protectedPersons']


def test_plain_legacy_request_does_not_create_a_briefing():
    assert briefing.extract_briefing('Наряд на Аккорду завтра 200 человек', object_names=NAMES) is None


def test_unknown_named_object_is_preserved_not_replaced_by_catalog_guess():
    value = briefing.extract_briefing('На объектах Аккорда, Новый дворец. Для Нового дворца нужно 7 человек.', object_names=NAMES)
    assert 'Новый дворец' in rows(value)


@pytest.mark.parametrize('value', [[], {'objects': [{'name': 'x', 'actorId': '1'}]}, {'objects': [{'name': 'x', 'personnelNeed': -1}]}, {'objects': [{'name': 'x', 'sectorCount': True}]}])
def test_invalid_nested_model_proposals_are_rejected(value):
    with pytest.raises(ValueError):
        briefing.validate_briefing(value)


def test_checked_declaration_never_fabricates_normal_results():
    value = briefing.extract_briefing(INTERNAL, object_names=NAMES)
    assert all(not o.get('checklistResults') for o in value['objects'])
    assert any('результат' in q['text'] for q in briefing.completeness_questions(value))


@pytest.mark.parametrize('sectors', [
    [{'number': 1}, {'number': 1}],
    [{'number': 3}],
    [{'number': 1, 'postCount': 1, 'posts': [{'number': 2}]}],
    [{'number': 1, 'posts': [{'number': 1, 'subpostCount': 1, 'subposts': [{'number': 2}]}]}],
])
def test_duplicate_or_out_of_range_numbered_structure_is_rejected(sectors):
    with pytest.raises(ValueError):
        briefing.validate_briefing({'objects': [{'name': 'Аккорда', 'sectorCount': 2, 'sectors': sectors}]})


def test_known_demand_can_become_explicitly_unknown_without_losing_structure():
    previous = briefing.extract_briefing(INTERNAL, object_names=NAMES)
    patch = briefing.extract_briefing('Для Аккорды потребность теперь неизвестна.', object_names=NAMES, previous=previous)
    merged = briefing.merge_briefing(previous, patch)
    assert rows(merged)['Аккорда']['personnelNeed'] is None
    assert rows(merged)['Аккорда']['needStatus'] == 'unknown'
    assert rows(merged)['Аккорда']['sectorCount'] == 2


def test_missing_subposts_and_partial_checklist_remain_questions():
    value = {'objects': [{'name': 'Аккорда', 'chiefName': 'Иван Иванов', 'personnelNeed': 4,
        'sectorCount': 1, 'sectors': [{'number': 1, 'postCount': 1,
        'posts': [{'number': 1, 'need': 2, 'subpostCount': 2, 'subposts': []}]}],
        'checklistResults': [{'id': 'checklist-0', 'state': 'NORMAL', 'comment': ''}]}],
        'protectedPersons': [{'code': '800'}], 'issues': []}
    text = ' '.join(q['text'] for q in briefing.completeness_questions(value))
    assert 'подпосту' in text
    assert 'результат' in text


def test_object_demand_cannot_hide_larger_post_total():
    value = {'objects': [{'name': 'Аккорда', 'chiefName': 'Иван Иванов', 'personnelNeed': 2,
        'sectorCount': 1, 'sectors': [{'number': 1, 'postCount': 1,
        'posts': [{'number': 1, 'need': 3, 'subpostCount': 0, 'subposts': []}]}]}],
        'protectedPersons': [{'code': '800'}], 'issues': []}
    assert any('по объекту 2, по указанным постам и подпостам 3' in q['text'] for q in briefing.completeness_questions(value))


@pytest.mark.django_db
@pytest.mark.parametrize('message,kind,count', [(INTERNAL, 'INTERNAL', 3), (FOREIGN, 'FOREIGN', 4)])
def test_real_dialogue_path_keeps_full_prompt_and_asks_missing_object_details(message, kind, count, monkeypatch):
    import uuid
    from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, URL
    from organization_management.apps.ops.tests.test_ops_security_events_api import make_object, make_employee
    from organization_management.apps.operations.models_assistant import OpsAssistantTask
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    from organization_management.apps.operations.models_gvo import OpsProtectedPerson
    from organization_management.apps.ops.assistant import provider
    from organization_management.apps.ops.assistant.dialogue import process_task

    api, user = jwt_actor('briefing-' + kind, ('event.create', 'event.manage', 'event.view', 'catalog.view'))
    for index, name in enumerate(NAMES[:3]):
        make_object(code='BR' + str(index), name=name)
    make_employee('Мусахан', 'Улан')
    make_employee('Мейрам', 'Еламан')
    make_employee('Аскен', 'Асет')
    for code in ('800', '802', '803'):
        OpsProtectedPerson.objects.create(name='ОЛ ' + code, callsign=code, category='OURS')
    monkeypatch.setattr(provider, 'interpret', lambda text, **kw: {'title': 'Встреча', 'businessDate': '2026-10-25',
        'kind': kind, 'briefing': {'objects': [{'name': 'Аккорда', 'personnelNeed': 9999}]}} if 'Встреча' in text else {})
    first = api.post(URL, {'requestKey': str(uuid.uuid4()), 'message': message, 'interpret': True}, format='json')
    assert first.status_code == 201
    task = OpsAssistantTask.objects.get(pk=first.json()['id'])
    process_task(str(task.pk), task.processing['generation'])
    current = api.get(URL + str(task.pk) + '/').json()
    assert current['processing']['state'] == 'ready', current
    assert len(current['plan']['briefing']['objects']) == count
    assert rows(current['plan']['briefing'])['Аккорда']['personnelNeed'] == 5
    assert current['plan']['businessDate'] == '2026-10-25'
    assert current['plan']['title'] == 'Встреча'
    assert current['canContinue'] is False
    assert any('Аккорда' in q['text'] and 'сектор 2' in q['text'] for q in current['questions'])
    if kind == 'FOREIGN':
        assert any('Ритц-Карлтон' in q['text'] for q in current['questions'])
        assert not OpsProtectedPerson.objects.filter(name='Шавкат Мирзеев').exists()
    assert not OpsSecurityEvent.objects.exists()
    response = api.post(URL + str(task.pk) + '/messages/', {'requestKey': str(uuid.uuid4()),
        'message': 'Для Бейбитшилик сарайы нужно 0 человек.', 'revision': current['revision']}, format='json')
    assert response.status_code == 202
    task.refresh_from_db()
    process_task(str(task.pk), task.processing['generation'])
    final = api.get(URL + str(task.pk) + '/').json()
    assert final['processing']['state'] == 'ready', final
    assert rows(final['plan']['briefing'])['Бейбитшилик сарайы']['personnelNeed'] == 0
    assert rows(final['plan']['briefing'])['Тарлан']['personnelNeed'] == 8
    assert final['plan']['title'] == 'Встреча'
    assert not OpsSecurityEvent.objects.exists()
