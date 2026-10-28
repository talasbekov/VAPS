"""Concrete questions never grant authority or move a short answer to another field."""
import uuid

import pytest

from organization_management.apps.operations.models_assistant import OpsAssistantTask, OpsAssistantMessage
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.tests.test_assistant_briefing import INTERNAL, FOREIGN, NAMES, rows
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, URL
from organization_management.apps.ops.tests.test_ops_assistant_dialogue import run_worker, say
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object, make_employee

pytestmark = pytest.mark.django_db


@pytest.fixture
def guided(monkeypatch):
    api, user = jwt_actor('guided-chief', ('event.create', 'event.manage', 'event.view', 'catalog.view'))
    for index, name in enumerate(NAMES):
        make_object(code=f'GUIDED-{index}', name=name)
    make_employee('Мусахан', 'Улан')
    make_employee('Мейрам', 'Еламан')
    make_employee('Аскен', 'Асет')
    for code in ('800', '802', '803'):
        OpsProtectedPerson.objects.create(name='ОЛ ' + code, callsign=code, category='OURS')
    def interpret(text, **kwargs):
        return {'title': 'Встреча', 'businessDate': '2026-10-25' if '25.10.2026' in text else '2027-06-01',
                'kind': 'FOREIGN' if 'иностранного' in text else 'INTERNAL'} if 'Подготовь' in text else {}
    monkeypatch.setattr(provider, 'interpret', interpret)
    return api, user


def begin(api, message):
    response = api.post(URL, {'requestKey': str(uuid.uuid4()), 'message': message, 'interpret': True}, format='json')
    assert response.status_code == 201, response.content
    assert response.json().get('guidance', {}).get('current') is None
    return run_worker(api, response.json()['id'])


BASE = 'Подготовь внутреннее мероприятие «Встреча» 01.06.2027 на объектах Аккорда. '
CHIEF = 'У Аккорды старший объекта Улан Мусахан. '


@pytest.mark.parametrize('message,object_count', [(INTERNAL, 3), (FOREIGN, 4)], ids=['internal', 'foreign'])
def test_original_prompts_accept_short_post_answers_without_rewriting_other_objects(guided, message, object_count):
    api, _ = guided
    task = begin(api, message)
    assert len(task['plan']['briefing']['objects']) == object_count
    current = task.get('guidance', {}).get('current')
    assert current is not None, task
    assert all(word in current['text'] for word in ('Аккорда', 'сектор 1', 'пост 1'))
    assert task['guidance']['remaining'] > 15
    assert task['guidance']['deferred'] == 0
    assert set(current) <= {'id', 'field', 'text', 'placeholder', 'choices', 'canDefer'}
    assert len(task['messages'][-1]['text']) < 600
    task = say(api, task, '2 человека')
    objects = rows(task['plan']['briefing'])
    assert objects['Аккорда']['sectors'][0]['posts'][0]['need'] == 2
    assert objects['Аккорда']['personnelNeed'] == 5
    assert objects['Тарлан']['personnelNeed'] == 8
    assert task['plan']['personnelTotal'] is None
    assert 'подпост 1' in task['guidance']['current']['text']
    task = say(api, task, 'один')
    assert rows(task['plan']['briefing'])['Аккорда']['sectors'][0]['posts'][0]['subposts'][0]['need'] == 1
    assert task['guidance']['remaining'] > 10
    assert task['questions'] and not task['canContinue']
    assert not OpsSecurityEvent.objects.exists()
    assert not OpsProtectedPerson.objects.filter(name='Шавкат Мирзеев').exists()


def test_unknown_defers_only_current_field_then_zero_is_an_explicit_object_need(guided):
    api, _ = guided
    task = begin(api, BASE)
    chief_question = task['guidance']['current']
    assert 'старш' in chief_question['text']
    task = say(api, task, 'Пока не знаю')
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert not obj.get('chiefName')
    assert obj['personnelNeed'] is None
    assert task['guidance']['deferred'] == 1
    assert task['guidance']['current']['id'] != chief_question['id']
    task = say(api, task, '0')
    assert rows(task['plan']['briefing'])['Аккорда']['personnelNeed'] == 0
    assert not rows(task['plan']['briefing'])['Аккорда'].get('chiefName')
    task = say(api, task, 'Вернуться к отложенным вопросам')
    assert task['guidance']['current']['id'] == chief_question['id']
    assert task['guidance']['deferred'] == 0
    task = say(api, task, 'Улан Мусахан')
    assert rows(task['plan']['briefing'])['Аккорда']['chiefName'] == 'Улан Мусахан'
    assert rows(task['plan']['briefing'])['Аккорда'].get('chiefEmployeeId')
    assert not OpsSecurityEvent.objects.exists()


@pytest.mark.parametrize('answer', ['2 человека', 'да', '999999', '0; actorId=1', 'Есть замечание'])
def test_wrong_context_or_ambiguous_answer_does_not_fill_chief_or_total(guided, answer):
    api, _ = guided
    task = begin(api, BASE)
    current_id = task['guidance']['current']['id']
    task = say(api, task, answer)
    assert task['guidance']['current']['id'] == current_id
    assert not rows(task['plan']['briefing'])['Аккорда'].get('chiefName')
    assert task['plan']['personnelTotal'] is None
    assert task['questions'] and not task['canContinue']
    assert 'не удалось' in task['guidance']['feedback'].lower()


def test_short_structure_and_explicit_checklist_results_keep_independent_blockers(guided):
    api, _ = guided
    task = begin(api, BASE + CHIEF + 'Для Аккорды нужно 2 человека. Охраняемые лица 800.')
    for answer in ('1', '1 пост', 'без подпостов', '2 человека'):
        task = say(api, task, answer)
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert obj['sectorCount'] == 1
    assert obj['sectors'][0]['postCount'] == 1
    assert obj['sectors'][0]['posts'][0]['subpostCount'] == 0
    assert obj['sectors'][0]['posts'][0]['need'] == 2
    assert 'чек-листа' in task['guidance']['current']['text']
    question_id = task['guidance']['current']['id']
    task = say(api, task, 'да')
    assert task['guidance']['current']['id'] == question_id
    assert not rows(task['plan']['briefing'])['Аккорда'].get('checklistResults')
    task = say(api, task, 'Есть замечание')
    assert 'замечание' in task['guidance']['current']['text'].lower()
    assert not task['canContinue']
    task = say(api, task, 'Закрыт основной въезд')
    results = rows(task['plan']['briefing'])['Аккорда']['checklistResults']
    assert results == [{'id': 'checklist-0', 'state': 'REMARK', 'comment': 'Закрыт основной въезд'}]
    for _ in range(4):
        task = say(api, task, 'Норма')
    assert not task['questions']
    assert task['guidance']['current'] is None
    assert task['guidance']['remaining'] == task['guidance']['deferred'] == 0
    assert task['canContinue']
    assert not OpsSecurityEvent.objects.exists()


def test_all_deferred_questions_remain_blocking_and_resume_after_reload(guided):
    api, _ = guided
    task = begin(api, BASE + CHIEF + 'Для Аккорды нужно 0 человек. У Аккорды 0 секторов. Охраняемые лица 800.')
    assert task['guidance']['remaining'] == 5
    for _ in range(5):
        task = say(api, task, 'Пока не знаю')
    task = api.get(URL + task['id'] + '/').json()
    assert task['guidance']['current'] is None
    assert task['guidance']['remaining'] == task['guidance']['deferred'] == 5
    assert task['questions'] and not task['canContinue']
    assert api.post(URL + task['id'] + '/continue/', {'revision': task['revision']}, format='json').status_code == 200
    assert not OpsSecurityEvent.objects.exists()
    task = api.get(URL + task['id'] + '/').json()
    task = say(api, task, 'Вернуться к отложенным вопросам')
    assert task['guidance']['current'] is not None
    assert task['guidance']['deferred'] == 0


def test_date_kind_title_and_codes_use_only_the_question_context(guided, monkeypatch):
    api, _ = guided
    monkeypatch.setattr(provider, 'interpret', lambda *args, **kwargs: {})
    task = begin(api, 'Подготовь наряд на объектах Аккорда.')
    assert task['guidance']['current']['field'] == 'title'
    task = say(api, task, 'Рабочая встреча')
    assert task['plan']['title'] == 'Рабочая встреча'
    task = say(api, task, '01.06.2027')
    assert task['plan']['businessDate'] == '2027-06-01'
    task = say(api, task, 'Внутреннее')
    assert task['plan']['kind'] == 'INTERNAL'
    for answer in ('Улан Мусахан', '0', '0', 'Норма', 'Норма', 'Норма', 'Норма', 'Норма'):
        task = say(api, task, answer)
    assert 'охраняем' in task['guidance']['current']['text'].lower()
    task = say(api, task, '800, 802 и 803')
    people = task['plan']['briefing']['protectedPersons']
    assert {p['code'] for p in people} == {'800', '802', '803'}
    assert all(p.get('personId') for p in people)
    assert task['plan']['personnelTotal'] is None
    assert not task['questions']
    assert not OpsSecurityEvent.objects.exists()


def test_failed_short_answer_retry_never_rebinds_to_the_next_question(guided, monkeypatch):
    api, _ = guided
    task = begin(api, BASE + CHIEF)
    def failed(*args, **kwargs):
        raise provider.ProviderUnavailable('Модель недоступна')
    monkeypatch.setattr(provider, 'interpret', failed)
    body = {'requestKey': str(uuid.uuid4()), 'revision': task['revision'], 'message': '2 человека'}
    endpoint = URL + task['id'] + '/messages/'
    assert api.post(endpoint, body, format='json').status_code == 202
    assert api.post(endpoint, body, format='json').status_code == 200
    assert api.post(endpoint, {**body, 'requestKey': str(uuid.uuid4())}, format='json').status_code == 409
    failed_task = run_worker(api, task['id'])
    assert failed_task['processing']['state'] == 'failed'
    assert failed_task['guidance']['current'] is None
    assert not failed_task['canContinue']
    assert rows(failed_task['plan']['briefing'])['Аккорда']['sectorCount'] is None
    monkeypatch.setattr(provider, 'interpret', lambda *args, **kwargs: {})
    retry = api.post(URL + task['id'] + '/retry/', {'requestKey': str(uuid.uuid4()), 'revision': failed_task['revision']}, format='json')
    assert retry.status_code == 202
    task = run_worker(api, task['id'])
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert obj['personnelNeed'] == 2
    assert obj['sectorCount'] is None
    assert task['plan']['personnelTotal'] is None
    assert len([m for m in task['messages'] if m['role'] == 'user']) == 2
    assert 'секторов' in task['guidance']['current']['text']
    assert not OpsSecurityEvent.objects.exists()


def test_detailed_correction_works_during_a_different_guided_question(guided):
    api, _ = guided
    task = begin(api, INTERNAL)
    task = say(api, task, 'Для Тарлана нужно 9 человек. Для Аккорды нужно 6 человек.')
    assert rows(task['plan']['briefing'])['Тарлан']['personnelNeed'] == 9
    assert rows(task['plan']['briefing'])['Аккорда']['personnelNeed'] == 6
    assert rows(task['plan']['briefing'])['Аккорда']['sectors'][0]['posts'][0]['need'] is None
    assert 'пост 1' in task['guidance']['current']['text']


def test_guided_flow_supports_more_than_thirty_answers_but_stays_bounded(guided):
    api, _ = guided
    task = begin(api, BASE)
    saved = OpsAssistantTask.objects.get(pk=task['id'])
    OpsAssistantMessage.objects.bulk_create([OpsAssistantMessage(task=saved, role='user', text='Пока не знаю', request_key=str(uuid.uuid4())) for _ in range(35)])
    task = api.get(URL + task['id'] + '/').json()
    assert task['canMessage']
    task = say(api, task, 'Улан Мусахан')
    assert rows(task['plan']['briefing'])['Аккорда']['chiefName'] == 'Улан Мусахан'
    assert not OpsSecurityEvent.objects.exists()


@pytest.mark.parametrize('sector_count,post_count', [(1, 1), (10, 100)], ids=['small', 'large'])
def test_model_context_is_bounded_valid_json_and_does_not_carry_internal_identifiers(monkeypatch, sector_count, post_count):
    import json
    from io import BytesIO
    from django.test import override_settings
    captured = {}
    def respond(request, timeout):
        captured.update(json.loads(request.data))
        empty = {'title': None, 'businessDate': None, 'kind': None, 'objectName': None,
                 'eventCode': None, 'intent': 'prepare', 'allocations': []}
        return BytesIO(json.dumps({'done': True, 'message': {'content': json.dumps(empty)}}).encode())
    monkeypatch.setattr(provider, 'urlopen', respond)
    # This is within the accepted briefing size and over the model context budget.
    context = {'proposal': {'title': 'Встреча', 'businessDate': '2027-06-01',
        'briefing': {'objects': [{'name': 'Аккорда', 'objectId': 'DO-NOT-SEND', 'chiefEmployeeId': 'DO-NOT-SEND',
            'sectors': [{'number': i, 'postCount': post_count, 'posts': [{'number': n, 'need': 2,
                'subpostCount': 0, 'subposts': []} for n in range(1, post_count + 1)]} for i in range(1, sector_count + 1)]}],
            'protectedPersons': [{'code': '800', 'personId': 'DO-NOT-SEND'}]}},
        'messages': ['Предыдущее сообщение ' * 190 for _ in range(250)]}
    with override_settings(OPS_ASSISTANT_PROVIDER='ollama', OPS_ASSISTANT_OLLAMA_URL='http://127.0.0.1:11434', OPS_ASSISTANT_MODEL='qwen2.5:7b'):
        provider.interpret('2', context=context)
    content = captured['messages'][1]['content']
    assert len(content) <= 17000
    assert 'DO-NOT-SEND' not in content
    parsed = json.loads(content.split(': ', 1)[1])
    assert parsed['proposal']['title'] == 'Встреча'
    assert parsed['proposal']['businessDate'] == '2027-06-01'


def test_out_of_order_date_is_not_misread_as_title_or_checklist_comment(guided, monkeypatch):
    from datetime import date
    from organization_management.apps.operations import clock
    api, _ = guided
    monkeypatch.setattr(provider, 'interpret', lambda *args, **kwargs: {})
    with clock.override(date(2026, 10, 27)):
        task = begin(api, 'Подготовь наряд на объектах Аккорда.')
        task = say(api, task, 'завтра')
    assert task['plan']['title'] is None
    assert task['plan']['businessDate'] == '2026-10-28'
    task = begin(api, BASE + CHIEF + 'Для Аккорды нужно 0 человек. У Аккорды 0 секторов. Охраняемые лица 800.')
    # Restore the title/kind that the deterministic mock deliberately does not infer.
    response = api.post(URL + task['id'] + '/continue/', {'revision': task['revision'],
        'fields': {'title': 'Встреча', 'kind': 'INTERNAL', 'businessDate': '2027-06-01'}}, format='json')
    assert response.status_code == 200
    task = say(api, response.json(), 'Есть замечание')
    task = say(api, task, 'Дата 30 октября 2026')
    result = rows(task['plan']['briefing'])['Аккорда']['checklistResults'][0]
    assert result['comment'] == ''
    assert task['plan']['businessDate'] == '2026-10-30'
    assert task['guidance']['current']['field'] == 'checklistComment'


def test_no_complaints_is_explicit_normal_but_zero_post_need_still_blocks(guided):
    api, _ = guided
    task = begin(api, BASE + CHIEF + 'Для Аккорды нужно 2 человека. У Аккорды 1 сектор, у первого сектора 1 пост. Охраняемые лица 800.')
    task = say(api, task, 'нет')
    assert rows(task['plan']['briefing'])['Аккорда']['sectors'][0]['posts'][0]['subpostCount'] == 0
    current = task['guidance']['current']['id']
    task = say(api, task, '0')
    assert task['guidance']['current']['id'] == current
    assert not task['canContinue']
    task = say(api, task, '2')
    task = say(api, task, 'нет замечаний')
    assert rows(task['plan']['briefing'])['Аккорда']['checklistResults'][0]['state'] == 'NORMAL'


def test_stale_tab_manual_correction_and_forged_target_never_rebind_reply(guided):
    api, _ = guided
    task = begin(api, BASE)
    body = {'requestKey': str(uuid.uuid4()), 'revision': task['revision'], 'message': 'Улан Мусахан'}
    endpoint = URL + task['id'] + '/messages/'
    assert api.post(endpoint, {**body, 'questionId': 'arbitrary', 'target': {'field': 'chiefEmployeeId', 'value': '1'}}, format='json').status_code == 400
    task = say(api, task, 'Пока не знаю')
    response = api.post(URL + task['id'] + '/continue/', {'revision': task['revision'], 'fields': {'title': 'Новое название'}}, format='json')
    assert response.status_code == 200
    assert response.json()['guidance']['deferred'] == 1
    assert 'feedback' not in response.json()['guidance']
    assert api.post(endpoint, body, format='json').status_code == 409
    task = say(api, response.json(), '2')
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert obj['personnelNeed'] == 2
    assert not obj.get('chiefName')
    assert not OpsSecurityEvent.objects.exists()


def test_new_short_message_while_model_failed_has_no_implicit_question_target(guided, monkeypatch):
    api, _ = guided
    task = begin(api, BASE + CHIEF)
    def unavailable(*args, **kwargs):
        raise provider.ProviderUnavailable('Модель недоступна')
    monkeypatch.setattr(provider, 'interpret', unavailable)
    task = say(api, task, 'Пока не знаю')
    assert task['processing']['state'] == 'failed'
    assert task['guidance']['current'] is None and 'feedback' not in task['guidance']
    monkeypatch.setattr(provider, 'interpret', lambda *args, **kwargs: {})
    task = say(api, task, '2 человека')
    assert task['plan']['personnelTotal'] is None
    assert rows(task['plan']['briefing'])['Аккорда']['personnelNeed'] is None
    assert rows(task['plan']['briefing'])['Аккорда']['sectorCount'] is None


@pytest.mark.parametrize('name', ['Улан Мусахан.', 'Улан Мусахан!'])
def test_chief_name_accepts_harmless_sentence_punctuation(guided, name):
    api, _ = guided
    task = begin(api, BASE)
    task = say(api, task, name)
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert obj['chiefName'] == 'Улан Мусахан'
    assert obj.get('chiefEmployeeId')


@pytest.mark.parametrize('answer,state,remaining', [('Не проверен', 'UNCHECKED', 5), ('Норма', 'NORMAL', 4),
    ('Без замечаний', 'NORMAL', 4), ('Нет замечаний', 'NORMAL', 4)])
def test_checklist_comment_accepts_result_correction_without_fabricating_remark(guided, answer, state, remaining):
    api, _ = guided
    task = begin(api, BASE + CHIEF + 'Для Аккорды нужно 0 человек. У Аккорды 0 секторов. Охраняемые лица 800.')
    task = say(api, task, 'Есть замечание')
    task = say(api, task, answer)
    assert rows(task['plan']['briefing'])['Аккорда']['checklistResults'][0] == {'id': 'checklist-0', 'state': state, 'comment': ''}
    assert task['guidance']['remaining'] == remaining
    assert not task['canContinue']
    assert not OpsSecurityEvent.objects.exists()


def test_explicit_global_count_out_of_order_does_not_fill_an_object_or_chief(guided):
    api, _ = guided
    task = begin(api, BASE)
    question_id = task['guidance']['current']['id']
    task = say(api, task, 'Нужно 20 человек')
    assert task['plan']['personnelTotal'] == 20
    obj = rows(task['plan']['briefing'])['Аккорда']
    assert obj['personnelNeed'] is None
    assert not obj.get('chiefName')
    assert task['guidance']['current']['id'] == question_id
    assert not OpsSecurityEvent.objects.exists()
