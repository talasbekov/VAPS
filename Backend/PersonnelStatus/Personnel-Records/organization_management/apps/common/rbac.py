"""
RBAC портальных экранов: штатное расписание и вакансии.

🔴 ПРАВА И ОБЛАСТЬ БЕРУТСЯ ТОЛЬКО ИЗ РАЗДЕЛА ОМ (Plane №352, Ш-3).

Раньше этот файл был вторым каталогом ролей: он читал `common.Role` из БД и
знал наизусть семь кодов — `if role == 'ROLE_3': подняться до управления`,
`if role == 'ROLE_6': вернуть отдел как есть`. Заказчик потребовал искоренить
старую систему и работать по своим ролям; ни одного из этих кодов среди них
нет, и каждая новая роль молча получала бы `return False` — «права выданы, а
ничего не видно».

Теперь правило одно, то же, что у Ш-2 в `staff_unit/views.py`:

* ЧТО МОЖНО — решает право раздела. Кадровые имена прав (`view_vacancies`,
  `create_staffing_position`, …) остались точками вызова в `staff_unit/views.py`
  и в классах DRF, но за ними стоит код раздела из карты ниже.
* ЧЬЁ — решает ОБЛАСТЬ ГРАНТА этого права: `visible_division_ids` отдаёт
  подразделения гранта вместе с потомками, поэтому право, выданное на
  департамент, накрывает его управления и отделы. Отдельного разбора уровней
  («поднимись до департамента») больше нет и быть не должно: он и был той
  зашитой иерархией, которую велено снести.

ЧЕГО ЗДЕСЬ БОЛЬШЕ НЕТ И ПОЧЕМУ.

* `has_role_permission` — чтение прав из `common.Role`. Второй каталог прав;
  сами модели снимает Ш-6, читателя снимает этот шаг.
* Ограничение откомандированных (`is_seconded` у ROLE_3/6/7 запрещал правку
  статусов и данных). Признак живёт в старой модели `UserRole` и уходит
  вместе с ней; в разделе аналога нет. Потеря ОСОЗНАННАЯ и записана в
  `Frontend/Decisions.md` + карточкой в «Предложено Claude»: вернуть правило
  можно только признаком, не привязанным к снесённому каталогу, а это
  решение заказчика, а не побочный эффект шага.
* Ветка «суперпользователь видит всё» осталась: это факт об учётной записи
  Django, а не роль.
"""
from typing import Any, Optional

from django.contrib.auth.models import User


#: Кадровое имя права → код права раздела ОМ.
#:
#: Карта, а не переименование точек вызова: имена прав сидят в `permission_map`
#: вьюсетов, в классах `drf_permissions` и в двух десятках вызовов
#: `check_permission`, и переименовывать их значило бы делать в Ш-3 работу Ш-6
#: вслепую. Один слой перевода здесь оставляет обе стороны читаемыми: вызов
#: говорит на языке экрана, каталог — на языке раздела.
#:
#: 🔴 ИМЯ ВНЕ КАРТЫ = ОТКАЗ. Так же вела себя и старая функция (право, которого
#: нет у роли в БД, давало `False`), и иначе нельзя: молчаливое «разрешаем
#: незнакомое» — это дыра, которая открывается опечаткой в `permission_map`.
OPS_PERMISSION_BY_PORTAL = {
    # Чтение штатки и вакансий — то же право, которым открыт экран
    # оргструктуры: показывают они одно и то же дерево, и второе имя для
    # одного и того же разошлось бы с ним при первой же раздаче прав.
    'view_staffing_table': 'orgstructure.view',
    'view_vacancies': 'orgstructure.view',
    # Правка штатки и вакансий. Один код на обе: вакансия — штатная единица
    # без человека, отдельного владельца у неё нет.
    'manage_staffing_table': 'orgstructure.manage',
    'create_staffing_position': 'orgstructure.manage',
    'edit_staffing_position': 'orgstructure.manage',
    'delete_staffing_position': 'orgstructure.manage',
    'create_vacancy': 'orgstructure.manage',
    'edit_vacancy': 'orgstructure.manage',
    'close_vacancy': 'orgstructure.manage',
    # Простановка статуса из ручки `directorate`: право раздела, которым
    # статусы правит весь остальной портал.
    'change_employee_status': 'status.manage',
}

#: Право, которым фильтруются СПИСКИ штатных единиц и вакансий. Оба читателя
#: `get_user_scope_queryset` — чтение, и область у них общая с экраном
#: оргструктуры.
_SCOPE_READ_PERMISSION = 'orgstructure.view'


def ops_permission_code(permission: str) -> Optional[str]:
    """Код права раздела за кадровым именем; `None` — имени в карте нет.

    Префикс приложения (`staff_unit.view_vacancies`) отбрасывается: он
    приходит из автоопределения DRF, а карта ведётся по именам прав.
    """
    if not permission:
        return None
    name = permission.split('.')[-1] if '.' in permission else permission
    return OPS_PERMISSION_BY_PORTAL.get(name)


def _actor_id(user: User) -> str:
    """Идентификатор актора в RBAC раздела.

    Импорт локальный: `common` — старое приложение, и модульная связь с
    разделом протянула бы его зависимости во все его импорты (тот же приём,
    что в `staff_unit/views.py`).
    """
    from organization_management.apps.operations.services import LegacyRoleSync

    return LegacyRoleSync.actor_id_for_user(user)


def _scope_division_ids(user: User, code: Optional[str]):
    """Подразделения, на которые у актора выдан грант этого КОДА РАЗДЕЛА.

    Принимает код раздела, а не кадровое имя: перевод делает вызывающий. Так
    сюда можно спросить и код, у которого кадрового имени нет вовсе
    (`_SCOPE_READ_PERMISSION`), не заводя ему фиктивную строку в карте.

    `None` на входе (имени нет в карте) — пустая область, то есть отказ.
    `None` на выходе — грант без области (в том числе wildcard
    администратора): область не ограничена ничем.
    """
    from organization_management.apps.operations.services import PermissionService

    if code is None:
        return set()
    return PermissionService.visible_division_ids(_actor_id(user), code)


def check_permission(user: User, permission: str, obj: Any = None) -> bool:
    """Есть ли у пользователя право, а если передан объект — и область на него.

    Args:
        user: Django User
        permission: кадровое имя права (см. `OPS_PERMISSION_BY_PORTAL`)
        obj: проверяемый объект (StaffUnit, Vacancy, Employee, …)

    Examples:
        >>> check_permission(user, 'view_staffing_table')
        >>> check_permission(user, 'edit_vacancy', vacancy_obj)
    """
    from organization_management.apps.operations.services import PermissionService

    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    code = ops_permission_code(permission)
    if code is None:
        return False

    if not PermissionService.has_permission(_actor_id(user), code):
        return False

    if obj is not None:
        return is_in_scope(user, obj, permission)

    return True


def is_in_scope(user: User, obj: Any, permission: str) -> bool:
    """Попадает ли объект в область гранта этого права.

    Область считается ПО ТОМУ ЖЕ праву, которое проверяют: у роли раздела
    грантов сколько угодно и у каждого своя область, поэтому «область
    пользователя» вообще не определена — определена область права.
    """
    if user.is_superuser:
        return True

    obj_division = get_object_division(obj)
    if not obj_division:
        # Подразделение объекта не определено — отказываем: гейт обязан
        # оставаться fail-closed.
        return False

    visible = _scope_division_ids(user, ops_permission_code(permission))
    if visible is None:
        # Грант без области накрывает всё дерево.
        return True
    return obj_division.id in visible


def get_object_division(obj: Any):
    """
    Получить подразделение объекта для ЛЮБОЙ модели системы

    Поддерживаемые модели:
    - Division: само подразделение
    - StaffUnit: через поле division
    - Vacancy: через staff_unit.division
    - Employee: через staff_unit (текущая штатная единица)
    - EmployeeStatus: через employee.staff_unit.division
    - Secondment: через from_division или to_division
    - Report: через division (если есть)

    Args:
        obj: объект любой модели системы

    Returns:
        Division или None
    """
    if not obj:
        return None

    model_name = obj.__class__.__name__

    # 1. Division - сам объект
    if model_name == 'Division':
        return obj

    # 2. StaffUnit - прямое поле division
    if hasattr(obj, 'division') and obj.division:
        return obj.division

    # 3. Vacancy - через staff_unit
    if model_name == 'Vacancy':
        if hasattr(obj, 'staff_unit') and obj.staff_unit:
            return obj.staff_unit.division if hasattr(obj.staff_unit, 'division') else None

    # 4. Employee - через текущую штатную единицу
    if model_name == 'Employee':
        # Используем staff_unit (OneToOne)
        if hasattr(obj, 'staff_unit') and obj.staff_unit:
            return obj.staff_unit.division
        # Fallback: через staffunit_set
        if hasattr(obj, 'staffunit_set'):
            staff_unit = obj.staffunit_set.first()
            return staff_unit.division if staff_unit and hasattr(staff_unit, 'division') else None

    # 5. EmployeeStatus - через employee
    if model_name == 'EmployeeStatus':
        if hasattr(obj, 'employee') and obj.employee:
            return get_object_division(obj.employee)
        # Альтернативно через related_division (если есть)
        if hasattr(obj, 'related_division') and obj.related_division:
            return obj.related_division

    # 6. Secondment - зависит от контекста
    if model_name == 'Secondment':
        # Для откомандирования используем from_division
        if hasattr(obj, 'from_division') and obj.from_division:
            return obj.from_division
        # Для прикомандирования используем to_division
        if hasattr(obj, 'to_division') and obj.to_division:
            return obj.to_division

    # 7. EmployeeTransferHistory - через from_division или to_division
    if model_name == 'EmployeeTransferHistory':
        if hasattr(obj, 'to_division') and obj.to_division:
            return obj.to_division
        if hasattr(obj, 'from_division') and obj.from_division:
            return obj.from_division

    # 8. StatusDocument - через status.employee
    if model_name == 'StatusDocument':
        if hasattr(obj, 'status') and obj.status:
            return get_object_division(obj.status)

    # 9. StatusChangeHistory - через status
    if model_name == 'StatusChangeHistory':
        if hasattr(obj, 'status') and obj.status:
            return get_object_division(obj.status)

    # 10. Report - может иметь division
    if model_name in ['Report', 'GeneratedReport']:
        if hasattr(obj, 'division') and obj.division:
            return obj.division

    # Универсальный fallback: если есть поле division
    if hasattr(obj, 'division') and obj.division:
        return obj.division

    # Если ничего не нашли
    return None


def get_user_scope_queryset(user: User, model_class):
    """Выборка модели, суженная областью права `orgstructure.view`.

    Поддерживаемые модели перечислены в `_get_division_field_for_model`.
    Точечная проверка (`is_in_scope`) и эта выборка обязаны отвечать
    одинаково, поэтому обе спрашивают область у одного резолвера раздела.
    """
    if user.is_superuser:
        return model_class.objects.all()

    model_name = model_class.__name__
    division_field = _get_division_field_for_model(model_name)
    if not division_field:
        return model_class.objects.none()

    visible = _scope_division_ids(user, _SCOPE_READ_PERMISSION)
    if visible is None:
        return model_class.objects.all()
    if not visible:
        return model_class.objects.none()

    return model_class.objects.filter(
        **{f'{division_field}__id__in': sorted(visible)}
    )


def _get_division_field_for_model(model_name: str) -> str:
    """
    Определить поле для фильтрации по подразделению для конкретной модели

    Args:
        model_name: название модели

    Returns:
        строка с путём к полю division
    """
    # Маппинг моделей на пути к полю division
    DIVISION_FIELD_MAP = {
        # Прямое поле division
        'Division': 'id',  # для Division фильтруем по id
        'StaffUnit': 'division',
        'Vacancy': 'staff_unit__division',

        # Через employee
        'Employee': 'staff_unit__division',
        'EmployeeTransferHistory': 'employee__staff_unit__division',

        # Через employee.staff_unit.division
        'EmployeeStatus': 'employee__staff_unit__division',
        'StatusDocument': 'status__employee__staff_unit__division',
        'StatusChangeHistory': 'status__employee__staff_unit__division',

        # Secondment - используем from_division
        'Secondment': 'from_division',

        # Report
        'Report': 'division',
        'GeneratedReport': 'division',
    }

    return DIVISION_FIELD_MAP.get(model_name, 'division')
