"""Server-owned question selection; no client or model supplies an answer target."""
import hashlib
import json
import re

from . import briefing


DEFER = 'Пока не знаю'
RESUME = 'Вернуться к отложенным вопросам'
PUBLIC_KEYS = ('id', 'field', 'text', 'placeholder', 'choices', 'canDefer')


def _question(field, text, target, *, placeholder=None, choices=None):
    identity = target or {'field': field, 'text': text}
    identifier = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
    result = {'id': identifier, 'field': field, 'text': text, 'canDefer': True, '_target': target}
    if placeholder:
        result['placeholder'] = placeholder
    if choices:
        result['choices'] = [{'label': label, 'value': label} for label in choices]
    return result


def _object_questions(obj):
    from organization_management.apps.ops.security_events import RECON_CHECKLIST_TEMPLATE
    name = obj['name']
    base = {'object': briefing.key(name)}
    label = f'«{name}»'

    def ask(field, text, extra=None, **kwargs):
        return _question(field, text, {**base, **(extra or {}), 'field': field}, **kwargs)

    if not obj.get('chiefName'):
        yield ask('chiefName', f'{label}: кто будет старшим объекта? Напишите ФИО.', placeholder='Например: Улан Мусахан')
    if obj.get('personnelNeed') is None:
        yield ask('personnelNeed', f'{label}: сколько всего людей нужно на объекте?', placeholder='Точное количество; 0 — люди не нужны')
    if obj.get('sectorCount') is None:
        yield ask('sectorCount', f'{label}: сколько секторов будет на объекте?', placeholder='Например: 2; если секторов нет — 0')
    else:
        sectors = {s['number']: s for s in obj.get('sectors', [])}
        for sn in range(1, obj['sectorCount'] + 1):
            sector = sectors.get(sn, {})
            sector_label = f'{label}, сектор {sn}'
            if sector.get('postCount') is None:
                yield ask('postCount', f'{sector_label}: сколько постов будет в секторе?', {'sector': sn}, placeholder='Например: 3')
                continue
            posts = {p['number']: p for p in sector.get('posts', [])}
            for pn in range(1, sector['postCount'] + 1):
                post = posts.get(pn, {})
                target = {'sector': sn, 'post': pn}
                post_label = f'{sector_label}, пост {pn}'
                if post.get('subpostCount') is None:
                    yield ask('subpostCount', f'{post_label}: сколько подпостов будет у этого поста?', target,
                              placeholder='Например: 1; если нет — 0', choices=['Без подпостов'])
                if post.get('need') in (None, 0):
                    text = (f'{post_label}: сколько людей нужно на самом посту, без подпостов?' if post.get('need') is None else
                            f'{post_label}: указано 0 людей. Уточните положительное количество или исправьте структуру постов.')
                    yield ask('need', text, target, placeholder='Число людей на этом посту')
                if post.get('subpostCount') is not None:
                    subposts = {s['number']: s for s in post.get('subposts', [])}
                    for sub in range(1, post['subpostCount'] + 1):
                        if subposts.get(sub, {}).get('need') in (None, 0):
                            yield ask('need', f'{post_label}, подпост {sub}: сколько людей нужно на подпосту?',
                                      {**target, 'subpost': sub}, placeholder='Положительное число людей')
    known_need, complete = 0, obj.get('sectorCount') is not None
    sectors = obj.get('sectors', [])
    complete = complete and len(sectors) == obj.get('sectorCount')
    for sector in sectors:
        posts = sector.get('posts', [])
        complete = complete and sector.get('postCount') is not None and len(posts) == sector['postCount']
        for post in posts:
            subposts = post.get('subposts', [])
            complete = complete and post.get('subpostCount') is not None and len(subposts) == post['subpostCount']
            for row in [post, *subposts]:
                known_need += row.get('need') or 0
                complete = complete and row.get('need') is not None
    total = obj.get('personnelNeed')
    if total is not None and (known_need > total or (complete and known_need != total)):
        yield ask('personnelNeed', f'{label}: по объекту указано {total}, по постам и подпостам — {known_need}. Какова верная общая потребность?',
                  placeholder='Верное количество или подробное исправление постов')
    results = {r['id']: r for r in obj.get('checklistResults', [])}
    for index, check_label in enumerate(RECON_CHECKLIST_TEMPLATE):
        cid = f'checklist-{index}'
        result = results.get(cid, {})
        if result.get('state') == 'REMARK' and not result.get('comment'):
            yield ask('checklistComment', f'{label}, пункт {index + 1} чек-листа «{check_label}»: какое замечание выявлено?',
                      {'check': cid}, placeholder='Коротко опишите замечание')
        elif result.get('state') not in {'NORMAL', 'REMARK'}:
            yield ask('checklistResult', f'{label}, пункт {index + 1} чек-листа «{check_label}»: какой результат проверки?',
                      {'check': cid}, placeholder='Норма, есть замечание или пока не знаю', choices=['Норма', 'Есть замечание'])


def questions(plan, blocking=None):
    """Expand completeness for conversation without removing the execution blockers."""
    blocking = plan.get('questions', []) if blocking is None else blocking
    structured = plan.get('briefing') or {}
    grouped = briefing.completeness_questions(structured) if structured else []
    result, references, later = [], [], []
    for q in blocking:
        if q in grouped:
            continue
        if q['field'].startswith('briefing'):
            references.append(q)
            continue
        field = q['field']
        kwargs = {}
        if field == 'kind':
            kwargs['choices'] = ['Внутреннее', 'С участием иностранных лиц']
        if field == 'businessDate':
            kwargs['placeholder'] = 'Например: 01.06.2027 или завтра'
        if field == 'allocations':
            kwargs['placeholder'] = 'Например: второй департамент 5 человек, шестой 8 человек'
        if field in {'objectId', 'eventId'}:
            kwargs['placeholder'] = 'Укажите точное название объекта или код существующего ОМ; также доступен выбор в форме'
        if field == 'personnelTotal':
            kwargs['placeholder'] = 'Например: всего нужно 20 человек; либо уточните распределение по департаментам'
        if field == 'event':
            kwargs['placeholder'] = 'Проверьте уже сохранённые сведения в карточке ОМ'
        target = {'field': field} if field in {'title', 'businessDate', 'kind', 'personnelTotal', 'objectId', 'eventId'} else None
        (result if field in {'title', 'businessDate', 'kind'} else later).append(_question(field, q['text'], target, **kwargs))
    for obj in structured.get('objects', []):
        result.extend(_object_questions(obj))
    if structured and not structured.get('protectedPersons'):
        result.append(_question('protectedPersons', 'Какие охраняемые лица будут участвовать? Напишите их коды или ФИО.',
                                {'field': 'protectedPersons'}, placeholder='Например: 800, 802 и 803'))
    result.extend(later)
    # Reference errors stay questions even when a literal value has been supplied.
    for q in references:
        target = None
        chief = re.fullmatch(r'briefing\.objects\.(\d+)\.chiefName', q['field'])
        person = re.fullmatch(r'briefing\.protectedPersons\.(\d+)', q['field'])
        if chief and int(chief[1]) < len(structured.get('objects', [])):
            obj = structured['objects'][int(chief[1])]
            target = {'object': briefing.key(obj['name']), 'field': 'chiefName'}
        elif person and int(person[1]) < len(structured.get('protectedPersons', [])):
            row = structured['protectedPersons'][int(person[1])]
            target = {'person': row.get('code') or briefing.key(row.get('name', '')), 'field': 'protectedPerson'}
        placeholder = ('ФИО действующего сотрудника' if chief else 'Код или полное ФИО из справочника ОЛ' if person else
                       'Проверьте запись в справочнике или укажите исправление вместе с названием объекта')
        result.append(_question(target['field'] if target else 'briefing', q['text'], target, placeholder=placeholder))
    for q in structured.get('issues', []):
        placeholder = 'Укажите исправление вместе с названием объекта и номерами сектора и поста'
        if 'ФИО и страну' in q['text']:
            placeholder = 'ФИО иностранного ОЛ Имя Фамилия, страна Название'
        result.append(_question('briefing', q['text'], None, placeholder=placeholder))
    # Stable identity is based on named/numbered targets, never on array position.
    return list({q['id']: q for q in result}.values())


def select(plan, blocking=None):
    available = questions(plan, blocking)
    deferred = set(plan.get('guidedDeferred', [])) & {q['id'] for q in available}
    return next((q for q in available if q['id'] not in deferred), None), len(available), len(deferred)


def public_guidance(plan, *, blocking=None, enabled=True):
    current, remaining, deferred = select(plan, blocking)
    public = {key: current[key] for key in PUBLIC_KEYS if key in current} if current and enabled else None
    result = {'current': public, 'remaining': remaining, 'deferred': deferred}
    if enabled and plan.get('guidedFeedback'):
        result['feedback'] = plan['guidedFeedback']
    return result


def reply_text(plan):
    current, remaining, _ = select(plan)
    if not remaining:
        return 'Сведения поручения обновлены. Проверьте план и подтвердите следующий шаг.'
    if current is None:
        return f'Оставшиеся вопросы отложены. Для продолжения напишите «{RESUME}» или уточните сведения вручную.'
    prefix = plan.get('guidedFeedback', 'Сведения поручения сохранены.') + ' '
    return prefix + current['text']
