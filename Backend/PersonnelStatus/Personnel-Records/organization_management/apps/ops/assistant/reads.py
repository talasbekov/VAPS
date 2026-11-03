"""Two explicit, bounded reads over the existing authorized directory selector.

Model cannot choose an arbitrary query, ID, division, API or fields. Personnel
are rendered by the server and are not sent to LLM or conversation history.
"""
import re
from rest_framework.exceptions import PermissionDenied
from organization_management.apps.core.service_employees import visible_employees
from organization_management.apps.operations.api.permissions import effective_permissions
from organization_management.apps.operations.clock import Clock


def resolve_read(question):
    normalized = " ".join(question.casefold().split()).rstrip(".!?")
    if normalized == "покажи мой профиль":
        return "own_profile", 1
    match = re.fullmatch(r"покажи доступных сотрудников(?: страница ([1-9][0-9]{0,3}))?", normalized)
    if match and int(match[1] or 1) <= 1000:
        return "directory", int(match[1] or 1)
    return None


def execute_read(request, operation, page=1):
    if operation not in {"own_profile", "directory"} or type(page) is not int or not 1 <= page <= 1000:
        raise ValueError("Unsupported read")
    queryset = visible_employees(request)
    from .data_scope import DataAuthority
    from django.db.models import Q
    scope = DataAuthority(request).scope('personnel.view')
    if scope is not None:
        queryset = queryset.filter(Q(staff_unit__division_id__in=scope) | Q(user=request.user))
    if operation == "own_profile":
        queryset = queryset.filter(user=request.user)
    elif not ({"*", "personnel.view"} & effective_permissions(request)) and not queryset.exists():
        # Same guard as ServiceEmployeeViewSet.initial, not a new grant.
        raise PermissionDenied("PERMISSION_DENIED")
    count = queryset.count()
    page_size = 10
    rows = []
    for employee in queryset[(page - 1) * page_size:page * page_size]:
        staff = getattr(employee, "staff_unit", None)
        rows.append({"id": employee.pk,
            "name": " ".join(part for part in [employee.last_name, employee.first_name, employee.middle_name] if part),
            "division": staff.division.name if staff and staff.division else None,
            "position": staff.position.name if staff and staff.position else None})
    return {"operation": operation, "asOf": Clock.now().isoformat(), "count": count,
            "page": page, "pageSize": page_size, "hasNext": page * page_size < count, "rows": rows}


def describe(result):
    if result["operation"] == "own_profile" and not result["rows"]:
        return "Своя активная карточка сотрудника не найдена. Проверьте привязку учётной записи через ответственного администратора."
    title = "Мой профиль" if result["operation"] == "own_profile" else "Доступные сотрудники"
    lines = [f"{title}. Найдено в вашей области: {result['count']}. Страница {result['page']}."]
    for row in result["rows"]:
        lines.append(" · ".join(part for part in [row["name"], row["division"], row["position"]] if part))
    if result["hasNext"]:
        lines.append(f"Для следующей страницы: «Покажи доступных сотрудников страница {result['page'] + 1}».")
    lines.append("Данные на " + result["asOf"] + ". Статусы, личные и медицинские сведения не включены. Это серверное чтение, без обращения к LLM.")
    return "\n".join(lines)


def describe_live(result):
    titles = {'statuses':'Статусы сотрудников', 'status_summary':'Свод статусов', 'events':'Охранные мероприятия',
              'event_detail':'Мероприятие', 'event_objects':'Объекты мероприятия'}
    lines = [titles.get(result['operation'], 'Доступные данные') + '. Только разрешённая область.',
             f"Найдено: {result['count']}. Страница {result['page']}."]
    if result.get('date'):
        lines.append('На дату: ' + result['date'])
    if result.get('notice'):
        lines.append(result['notice'])
    for row in result['rows']:
        values = [str(row[key]) for key in ['code','title','name','division','status','stageLabel','date','startDate','endDate'] if row.get(key) is not None]
        if 'count' in row:
            values.append('Количество: ' + str(row['count']))
        for key,label in {'state':'Состояние','revision':'Версия','format':'Формат','rating':'Рейтинг','evaluationsCount':'Оценок',
                          'late':'С опозданием','sent':'Отправлено','published':'Опубликовано'}.items():
            if key in row:
                value=row[key]
                values.append(label+': '+('Неизвестно' if value is None else 'Да' if value is True else 'Нет' if value is False else str(value)))
        if row.get('planned'):
            values.append('План, не подтверждённый факт')
        lines.append(' · '.join(values)[:600])
    if not result['rows']:
        lines.append('В доступной области по этим фильтрам записей нет.')
    if result['hasNext']:
        lines.append('Есть следующая страница. Напишите «Следующая страница».')
    lines.append('Данные на ' + result['asOf'] + '. Неизвестные значения не заменены нулями; запись не выполнялась.')
    text = '\n'.join(lines)
    return text if len(text) <= 8000 else text[:7850] + '\nОтвет сокращён; полные сведения доступны в исходном разделе.'
