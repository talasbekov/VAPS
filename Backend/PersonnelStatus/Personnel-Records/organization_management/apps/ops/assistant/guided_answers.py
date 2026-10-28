"""Interpret narrow ordinary answers only against the server's saved question."""
from copy import deepcopy
import re

from . import briefing, guided_questions


UNKNOWN = {'пока не знаю', 'не знаю', 'неизвестно', 'пока неизвестно', 'еще не знаю'}
ACKNOWLEDGEMENTS = {'да', 'нет', 'хорошо', 'ок', 'понятно', 'проверено', 'все проверено'}
CHECK_REPLIES = {'норма', 'в норме', 'без замечаний', 'нет замечаний', 'есть замечание', 'есть замечания', 'замечание',
                'не проверен', 'не проверено', 'еще не проверен'}
COUNT_FIELDS = {'personnelNeed': 100000, 'personnelTotal': 100000, 'sectorCount': 30,
                'postCount': 200, 'subpostCount': 50, 'need': 100000}
_LETTERS = r'[^\W\d_]'
_NAME = re.compile(rf'{_LETTERS}+(?:[- ]{_LETTERS}+)+', re.UNICODE)
_COUNT = re.compile(rf'(?:нужно\s+|будет\s+)?({briefing.NUM})(?:\s+(человек(?:а)?|людей|сотрудник(?:а|ов)?|сектор(?:а|ов)?|пост(?:а|ов)?|подпост(?:а|ов)?))?')


def _count(source, field):
    absent = {'sectorCount': {'без секторов', 'секторов нет'}, 'postCount': {'без постов', 'постов нет'},
              'subpostCount': {'без подпостов', 'подпостов нет', 'нет'}}
    if source in absent.get(field, set()):
        return 0
    match = _COUNT.fullmatch(source)
    if not match:
        return None
    value, unit = briefing.number(match[1]), match[2] or ''
    expected = {'sectorCount': 'сектор', 'postCount': 'пост', 'subpostCount': 'подпост'}
    if unit and not (unit.startswith(expected[field]) if field in expected else re.match(r'человек|людей|сотрудник', unit)):
        return None
    if value > COUNT_FIELDS[field] or (field in {'need', 'personnelTotal'} and value == 0):
        return None
    return value


def _date(source):
    from .planning import literal_date
    return literal_date(source)


def _literal(text, target, old):
    field = (target or {}).get('field')
    source = text.casefold().replace('ё', 'е').strip().rstrip('.!')
    literal_name = text.strip().rstrip('.!').strip()
    if field in COUNT_FIELDS:
        return _count(source, field)
    if field == 'businessDate':
        return _date(source)
    if field == 'kind':
        return {'внутреннее': 'INTERNAL', 'внутренний': 'INTERNAL', 'internal': 'INTERNAL',
                'иностранное': 'FOREIGN', 'иностранный': 'FOREIGN', 'foreign': 'FOREIGN',
                'с участием иностранных лиц': 'FOREIGN', 'визит иностранного ол': 'FOREIGN'}.get(source)
    if field == 'chiefName':
        if (_NAME.fullmatch(literal_name) and 2 <= len(literal_name.split()) <= 4 and source not in CHECK_REPLIES
                and not re.search(r'\b(?:нужно|старший|объект|не|да|нет|знаю)\b', source)):
            return literal_name
    if field == 'title':
        if (1 <= len(text) <= 255 and not re.search(r'[\d:;?\n=]|\b(?:нужно|нужны|подготовь|отправь|объект[а-я]*|сектор[а-я]*|пост[а-я]*|внутренн[а-я]*|иностранн[а-я]*)\b', source)
                and source not in UNKNOWN | ACKNOWLEDGEMENTS | CHECK_REPLIES and _date(source) is None and re.search(_LETTERS, source)):
            return text.strip(' «»"')
    if field in {'protectedPersons', 'protectedPerson'}:
        if re.fullmatch(r'\d{2,10}(?:\s*(?:,|и)\s*\d{2,10})*', source):
            codes = list(dict.fromkeys(re.findall(r'\d{2,10}', source)))
            if len(codes) <= 30 and (field == 'protectedPersons' or len(codes) == 1):
                return [{'code': code} for code in codes]
        if _NAME.fullmatch(literal_name) and 2 <= len(literal_name.split()) <= 4 and source not in UNKNOWN | ACKNOWLEDGEMENTS | CHECK_REPLIES:
            return [{'name': literal_name}]
    if field in {'checklistResult', 'checklistComment'}:
        if source in {'норма', 'в норме', 'без замечаний', 'нет замечаний'}:
            return {'state': 'NORMAL', 'comment': ''}
        if source in {'не проверен', 'не проверено', 'еще не проверен'}:
            return {'state': 'UNCHECKED', 'comment': ''}
        if source in {'есть замечание', 'замечание', 'есть замечания'}:
            return {'state': 'REMARK', 'comment': ''}
        match = re.fullmatch(r'(?:есть\s+)?замечание\s*[:—–-]\s*(.+)', text.strip(), re.I)
        if match and 0 < len(match[1]) <= 2000:
            return {'state': 'REMARK', 'comment': match[1].strip()}
    if field == 'checklistComment':
        if (0 < len(text.strip()) <= 2000 and source not in UNKNOWN | ACKNOWLEDGEMENTS and '?' not in text and _date(source) is None
                and not re.match(r'(?:дата|перенеси|перенести|название|назови|тип\s+мероприятия)\b', source)
                and not any(re.search(briefing._pattern(obj['name']), source) for obj in (old.get('briefing') or {}).get('objects', []))):
            return text.strip()
    return None


def _numbered(rows, number, defaults):
    row = next((row for row in rows if row['number'] == number), None)
    if row is None:
        row = {'number': number, **defaults}
        rows.append(row)
        rows.sort(key=lambda item: item['number'])
    return row


def _changes(old, target, value):
    field = target['field']
    if 'object' not in target and field not in {'protectedPersons', 'protectedPerson'}:
        return {field: value}
    structured = deepcopy(old['briefing'])
    if field == 'protectedPersons':
        structured['protectedPersons'] = value
    elif field == 'protectedPerson':
        people = structured['protectedPersons']
        index = next(i for i, person in enumerate(people) if (person.get('code') or briefing.key(person.get('name', ''))) == target['person'])
        people[index] = value[0]
    else:
        obj = next(obj for obj in structured['objects'] if briefing.key(obj['name']) == target['object'])
        row = obj
        if 'sector' in target:
            row = _numbered(obj.setdefault('sectors', []), target['sector'], {'postCount': None, 'posts': []})
        if 'post' in target:
            row = _numbered(row.setdefault('posts', []), target['post'], {'need': None, 'subpostCount': None, 'subposts': []})
        if 'subpost' in target:
            row = _numbered(row.setdefault('subposts', []), target['subpost'], {'need': None})
        if field in {'checklistResult', 'checklistComment'}:
            results = {r['id']: r for r in obj.get('checklistResults', [])}
            results[target['check']] = {'id': target['check'], **(value if isinstance(value, dict) else {'state': 'REMARK', 'comment': value})}
            obj['checklistResults'] = list(results.values())
        else:
            row[field] = value
            if field == 'chiefName':
                obj.pop('chiefEmployeeId', None)
            if field == 'personnelNeed':
                obj['needStatus'] = 'known'
                obj['demandSpecified'] = True
            if field in {'sectorCount', 'postCount', 'subpostCount'}:
                child = {'sectorCount': 'sectors', 'postCount': 'posts', 'subpostCount': 'subposts'}[field]
                row[child] = [item for item in row.get(child, []) if item['number'] <= value]
    return {'briefing': briefing.validate_briefing(structured)}


def prepare(message, old, binding):
    """Retries keep the accepted binding, even after the answer resolved its question."""
    source = message.strip().casefold().replace('ё', 'е').rstrip('.!')
    result = {'handled': False, 'changes': {}, 'deferred': list(old.get('guidedDeferred', [])), 'outcome': None}
    if source == guided_questions.RESUME.casefold():
        return {**result, 'handled': True, 'deferred': [], 'outcome': 'resumed'}
    if not binding:
        # A failed/hidden or exhausted question cannot give an unscoped number
        # meaning. Keep detailed explicit corrections on the normal path.
        if old.get('briefing') and ((_COUNT.fullmatch(source) and not source.startswith('нужно ')) or source in ACKNOWLEDGEMENTS | CHECK_REPLIES):
            return {**result, 'handled': True, 'outcome': 'unread'}
        return result
    snapshot = binding.get('question')
    if not snapshot:
        return result
    if source in UNKNOWN:
        return {**result, 'handled': True, 'deferred': list(dict.fromkeys([*result['deferred'], snapshot['id']])), 'outcome': 'deferred'}
    value = _literal(message, snapshot.get('_target'), old)
    is_short = bool(_COUNT.fullmatch(source) or source in ACKNOWLEDGEMENTS | CHECK_REPLIES or re.fullmatch(r'\d{1,6}', source))
    if source.startswith('нужно '):
        # Preserve explicit global corrections when this question is not a count.
        is_short = False
    if value is None:
        return {**result, 'handled': is_short, 'outcome': 'unread'}
    # The saved question, its target and the still-unresolved server candidate
    # must agree. A retry may not reinterpret the reply as the next question.
    candidate = next((q for q in guided_questions.questions(old) if q['id'] == snapshot['id'] and q['_target'] == snapshot.get('_target')), None)
    changes = _changes(old, candidate['_target'], value) if candidate else {}
    return {**result, 'handled': True, 'changes': changes}


def remember(plan, result):
    available = {q['id'] for q in guided_questions.questions(plan)}
    plan['guidedDeferred'] = [identifier for identifier in result['deferred'] if identifier in available]
