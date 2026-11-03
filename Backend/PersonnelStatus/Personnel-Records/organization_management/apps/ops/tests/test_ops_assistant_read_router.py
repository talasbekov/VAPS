import pytest
from organization_management.apps.ops.assistant.read_router import resolve_spec
from organization_management.apps.ops.assistant.read_spec import validate_spec


@pytest.mark.parametrize('question,operation', [
    ('Какие ОМ сегодня?', 'events'), ('Покажи мероприятия на 2026-11-01', 'events'),
    ('Кто сегодня отсутствует?', 'statuses'), ('Покажи статусы сотрудников', 'statuses'),
    ('Сколько сотрудников по статусам?', 'status_summary'), ('Покажи ОМ 17', 'event_detail'),
    ('Покажи объекты мероприятия 17', 'event_objects'), ('Покажи структуру организации', 'organization'),
    ('Покажи доступные объекты', 'objects'), ('Какие дежурства сегодня?', 'duties'),
    ('Покажи запросы сил', 'force_requests'), ('Покажи транспорт ГОН', 'vehicles'),
    ('Покажи законы об ОМ', 'laws'), ('Покажи охраняемых лиц', 'protected_persons'),
    ('Покажи пользователей', 'users'), ('Покажи роли', 'roles'), ('Покажи права', 'permissions'),
    ('Покажи журнал аудита', 'audit'),
])
def test_natural_questions_resolve_only_to_fixed_operations(question, operation):
    assert validate_spec(resolve_spec(question))['operation'] == operation


def test_continuation_keeps_only_signed_validated_filters():
    prior = {'operation':'statuses', 'page':1, 'date':'2026-10-30', 'divisionId':3}
    assert resolve_spec('Следующая страница', prior) == {**prior, 'page':2}
    assert resolve_spec('А на 2026-11-01?', prior) == {**prior, 'date':'2026-11-01', 'page':1}
    assert resolve_spec('Как работает реестр ОМ?', prior) is None
    assert resolve_spec('Создай мероприятие', prior) is None
    assert resolve_spec('Следующая страница') is None


def test_specific_division_employee_dates_are_filters_not_authority():
    result = resolve_spec('Покажи статусы сотрудника 12 подразделения 3 на 2026-10-30')
    assert result['employeeId'] == 12 and result['divisionId'] == 3 and result['date'] == '2026-10-30'
    assert set(result) <= {'operation','employeeId','divisionId','date','page'}


def test_own_status_and_event_code_are_narrowing_filters():
    assert resolve_spec('Покажи мои статусы')['ownOnly'] is True
    assert resolve_spec('Покажи ОМ OM-2026-2')['search']=='om-2026-2'


def test_explicit_date_followup_replaces_previous_date_family():
    first=resolve_spec('Покажи ОМ с 2026-10-01 по 2026-10-31')
    second=resolve_spec('А на 2026-11-01?',first)
    assert second['date']=='2026-11-01' and 'dateFrom' not in second and 'dateTo' not in second
