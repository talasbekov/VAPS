"""Closed read vocabulary; no fields here can select authority or execution."""
from datetime import date
from rest_framework.exceptions import ValidationError

OPERATIONS = frozenset({'own_profile', 'directory', 'statuses', 'status_summary', 'events', 'event_detail', 'event_objects',
    'organization', 'objects', 'duties', 'force_requests', 'vehicles', 'laws', 'protected_persons', 'users', 'roles', 'permissions', 'audit',
    'daily_submissions','report_jobs','feedback','dictionaries','settings','ratings','rating_analytics'})
FIELDS = {'operation', 'page', 'date', 'dateFrom', 'dateTo', 'employeeId', 'divisionId', 'eventId', 'search', 'stage', 'absentOnly','ownOnly'}
PER_OPERATION = {
    'own_profile': set(), 'directory': {'employeeId', 'divisionId', 'search'},
    'statuses': {'date', 'employeeId', 'divisionId', 'absentOnly','ownOnly'}, 'status_summary': {'date', 'divisionId', 'absentOnly'},
    'events': {'date', 'dateFrom', 'dateTo', 'search', 'stage', 'divisionId'},
    'event_detail': {'eventId'}, 'event_objects': {'eventId'}, 'organization': {'divisionId', 'search'},
    'objects': {'search'}, 'duties': {'date', 'employeeId', 'divisionId'}, 'force_requests': {'eventId', 'divisionId'},
    **{name: {'search'} for name in ['vehicles', 'laws', 'protected_persons', 'users', 'roles', 'permissions', 'audit']},
    'daily_submissions':{'date','divisionId'}, 'report_jobs':{'search'}, 'feedback':{'search'},
    'dictionaries':{'search','divisionId'}, 'settings':{'search'}, 'ratings':set(), 'rating_analytics':set(),
}


def validate_spec(value):
    if not isinstance(value, dict) or set(value) - FIELDS or not isinstance(value.get('operation'),str) or value['operation'] not in OPERATIONS:
        raise ValidationError('Недопустимый запрос чтения.')
    if set(value) - {'operation', 'page'} - PER_OPERATION[value['operation']]:
        raise ValidationError('Фильтр не поддерживается этой операцией.')
    result = dict(value)
    for key in ['page', 'employeeId', 'divisionId', 'eventId']:
        if key in result and (type(result[key]) is not int or not 1 <= result[key] <= (1000 if key == 'page' else 2147483647)):
            raise ValidationError('Недопустимый числовой фильтр.')
    result.setdefault('page', 1)
    for key in ['date', 'dateFrom', 'dateTo']:
        if key in result:
            try:
                if not isinstance(result[key], str) or len(result[key]) != 10:
                    raise ValueError()
                date.fromisoformat(result[key])
            except (TypeError, ValueError):
                raise ValidationError('Укажите действительную дату ГГГГ-ММ-ДД.')
    if 'dateFrom' in result and 'dateTo' in result and result['dateFrom'] > result['dateTo']:
        raise ValidationError('Начало периода позже окончания.')
    if 'search' in result and (not isinstance(result['search'], str) or len(result['search']) > 100 or any(ord(c)<32 for c in result['search'])):
        raise ValidationError('Поиск ограничен 100 знаками.')
    if 'absentOnly' in result and type(result['absentOnly']) is not bool:
        raise ValidationError('Недопустимый фильтр отсутствия.')
    if 'ownOnly' in result and type(result['ownOnly']) is not bool:
        raise ValidationError('Недопустимый фильтр своей записи.')
    if 'stage' in result and (not isinstance(result['stage'],str) or result['stage'] not in {'BULLETIN','RECON','DEMAND','FORCES','PLACEMENT','APPROVAL','ACKNOWLEDGEMENT','CONDUCT','CLOSED'}):
        raise ValidationError('Неизвестный этап.')
    if result['operation'] in {'event_detail', 'event_objects'} and 'eventId' not in result:
        raise ValidationError('Выберите мероприятие.')
    return result
