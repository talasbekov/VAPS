"""Conservative natural-language routing into a closed read vocabulary.

Unrecognized questions remain documentation dialogue. Never interprets writes,
role changes, arbitrary SQL/URLs or caller-selected fields as tools.
"""
import re
from datetime import timedelta
from organization_management.apps.operations.clock import Clock
from .read_spec import validate_spec


def resolve_spec(question, previous=None):
    text = ' '.join(question.casefold().replace('ё','е').split()).rstrip('.!?')
    if re.match(r'^(как|зачем|почему|для чего|объясни|что такое|создай|назначь|измени|удали|сохрани|отправь)\b', text):
        return None
    following = bool(previous and (text in {'следующая страница','дальше','еще','ещё'} or re.match(r'^а (?:на|за)\b', text)))
    if not following and not re.match(r'^(покажи|какие|какой|список|сколько|кто|свод|мои|мой)\b', text):
        return None
    if following:
        result = dict(validate_spec(previous))
        result['page'] = result.get('page', 1) + 1 if text in {'следующая страница','дальше','еще','ещё'} else 1
    else:
        operation = None
        for pattern, candidate in [
            (r'аналитик.*рейтинг|рейтинг.*аналитик','rating_analytics'),(r'рейтинг|оценк','ratings'),
            (r'сдач|ежедневн.*расход|свод.*служб','daily_submissions'),(r'отчет|документ.*готов','report_jobs'),
            (r'обратн.*связ|обращен','feedback'),(r'справочник','dictionaries'),(r'настройк','settings'),
            (r'журнал.*аудит|аудит', 'audit'), (r'пользовател', 'users'), (r'\bроли\b', 'roles'), (r'\bправа\b', 'permissions'),
            (r'охраняем.*лиц', 'protected_persons'), (r'закон|нормативн', 'laws'), (r'транспорт|машин|\bгон\b','vehicles'),
            (r'запрос.*сил|заявк.*сил', 'force_requests'), (r'дежурств|смены', 'duties'),
            (r'структур.*организац', 'organization'), (r'объект.*(?:мероприяти|\bом\b)', 'event_objects'),
            (r'объект', 'objects'), (r'свод.*статус|сколько.*статус|статус.*свод', 'status_summary'),
            (r'статус|отсутств|не в строю', 'statuses'), (r'мероприяти|\bом\b', 'events')]:
            if re.search(pattern, text):
                operation = candidate
                break
        if operation is None:
            return None
        result = {'operation': operation, 'page':1}
    for pattern, key in [(r'(?:подразделени[еяию]|управлени[еяию]|департамент[а-я]*)\s*(?:№|id)?\s*(\d+)','divisionId'),
                         (r'сотрудник[а-я]*\s*(?:№|id)?\s*(\d+)','employeeId'),
                         (r'(?:мероприяти[еяию]|\bом)\s*(?:№|id)?\s*(\d+)','eventId'),
                         (r'страниц[аеуы]\s+(\d+)','page')]:
        match = re.search(pattern, text)
        if match:
            result[key] = int(match[1])
    if 'eventId' in result and result['operation']=='events':
        result['operation']='event_detail'
    code=re.search(r'\b(?:ом|om)-\d{4}-\d+\b',text)
    if code and result['operation']=='events':
        result['search']=code[0]
    dates = re.findall(r'\b\d{4}-\d{2}-\d{2}\b', text)
    if following and (dates or re.search(r'сегодня|завтра|вчера',text)):
        for key in ('date','dateFrom','dateTo'):
            result.pop(key,None)
    if result['operation'] in {'events','statuses','status_summary','duties','daily_submissions'}:
        if len(dates) >= 2 and result['operation']=='events':
            result['dateFrom'],result['dateTo']=dates[:2]
        elif dates:
            result['date']=dates[0]
        elif 'завтра' in text:
            result['date']=(Clock.today_local()+timedelta(days=1)).isoformat()
        elif 'вчера' in text:
            result['date']=(Clock.today_local()-timedelta(days=1)).isoformat()
        elif 'сегодня' in text:
            result['date']=Clock.today_local().isoformat()
    if result['operation'] in {'statuses','status_summary'} and re.search(r'отсутств|не в строю', text):
        result['absentOnly']=True
    if result['operation']=='statuses' and re.search(r'\bмо[йияе]\b',text):
        result['ownOnly']=True
    stages={'рекогносциров':'RECON','расстанов':'PLACEMENT','согласован':'APPROVAL','ознакомлен':'ACKNOWLEDGEMENT','закрыт':'CLOSED','бюллетен':'BULLETIN'}
    if result['operation']=='events':
        for word, stage in stages.items():
            if word in text:
                result['stage']=stage
                break
    return validate_spec(result)
