# PERMISSION_SERVICE_DESIGN

## 1. Current RBAC Implementation
Авторизация в системе реализована в двух модулях:
* `common/rbac.py`: Хранит функцию `check_permission()` и `is_in_scope()`, реализуя сложную императивную логику определения области видимости для каждой роли.
* `common/drf_permissions.py`: Хранит DRF классы `RoleBasedPermission` и хардкоженные права (`IsRoleAdmin`, `IsRoleHRAdmin`), которые используются во `ViewSet`.

Текущий механизм требует, чтобы разработчик знал конкретные строковые названия ролей (`ROLE_4`, `ROLE_5`) или вручную вызывал `get_descendants()` во views для ограничения `queryset`.

## 2. Current Role Model
В системе существуют роли, которые хранятся как записи в БД и связываются с пользователем через `UserRole`:
* **ROLE_1**: Наблюдатель организации
* **ROLE_2**: Наблюдатель департамента
* **ROLE_3**: Начальник управления
* **ROLE_4**: Системный администратор
* **ROLE_5**: Кадровик
* **ROLE_6**: Начальник отдела
* **ROLE_7**: Делопроизводитель

У `UserRole` есть метод `get_user_division()` (`effective_scope_division`), который возвращает "домашнее" подразделение пользователя (из StaffUnit, либо ручное назначение, либо откомандирование).

## 3. Current Scope Calculation
Область видимости сейчас вычисляется многократно и по-разному в зависимости от слоя:
В `rbac.py` -> `is_in_scope` логика ветвится через `if role == 'ROLE_X':`.
Например, для ROLE_3 (Начальник управления) возвращаются права только на само Управление и его `get_descendants()`.
Однако, в `get_queryset()` внутри `views.py` (например, в `secondments/api/views.py` или `reports/api/views.py`) разработчики игнорируют `rbac.py` и заново вручную пишут:
`if role == RoleType.DIRECTORATE_HEAD: allowed = user.division.get_descendants()`

## 4. Current Permission Checks in Views
Вместо того чтобы полагаться на прозрачный селектор (например, `get_allowed_employees(user)`), Views содержат императивную бизнес-логику:
```python
# reports/api/views.py
if getattr(user, "role", None) == user.RoleType.SYSTEM_ADMIN:
    return qs
user_division = user.role_info.get_user_division()
allowed = user_division.get_descendants(include_self=True)
return qs.filter(...)
```

## 5. Duplication Points
* Использование `getattr(user, "role", None) == user.RoleType.SYSTEM_ADMIN` дублируется в `secondments`, `employees`, и `reports`.
* Использование `division.get_descendants(include_self=True)` для фильтрации дублируется более чем в 10 местах во Views.
* Определение "Корневого департамента" дублируется.

## 6. Risks
* **Безопасность (Data Leakage)**: Разработчик может забыть добавить `.filter(division__in=allowed)` в новом эндпоинте, и пользователь увидит данные всей организации.
* **Производительность**: Многократные вызовы `.get_descendants()` генерируют избыточную нагрузку на БД и MPTT-деревья внутри циклов или запросов.
* **Трудоемкость поддержки**: Добавление новой роли (например, ROLE_8) потребует внесения изменений (Monkey Patching) во все Views, где жестко прописаны `if role == ...`.

## 7. Proposed PermissionService API
Единый `PermissionService` должен заменить хардкод во Views. Он не должен обращаться к `RoleType` напрямую вне своих приватных методов.

Предлагаемое API:
```python
class PermissionService:
    def __init__(self, user: User):
        self.user = user
        self.role_info = getattr(user, 'role_info', None)

    def can_perform(self, action: str, obj=None) -> bool:
        """Делегирует в rbac.py check_permission"""
        pass

    def get_visible_divisions(self) -> QuerySet[Division]:
        """
        Возвращает QuerySet со всеми подразделениями,
        которые пользователь имеет право видеть.
        """
        pass

    def filter_queryset(self, qs: QuerySet) -> QuerySet:
        """
        Автоматически фильтрует переданный queryset (Employees, StaffUnits, Secondments)
        в зависимости от get_visible_divisions().
        """
        pass
```

## 8. Role-to-Scope Rules
| Role | Code | Scope Division Base | Visible Descendants |
|---|---|---|---|
| Системный админ | ROLE_4 | Ограничений нет | Вся организация |
| Кадровик | ROLE_5 | Ограничений нет | Вся организация |
| Наблюдатель Орг. | ROLE_1 | Ограничений нет | Вся организация |
| Наблюдатель Деп. | ROLE_2 | get_department() | Департамент и все подчиненные |
| Нач. Управления | ROLE_3 | scope_division | Управление и подчиненные отделы |
| Нач. Отдела | ROLE_6 | scope_division | Отдел (без детей) |
| Делопроизводитель| ROLE_7 | scope_division | Отдел (без детей) |

## 9. Action-to-Permission Matrix
Управление правами будет сохранено через модель `Permission` и `RolePermission`. Однако, вместо ручных проверок `if role == ...` в `secondments.reject()` необходимо использовать:
`if not permission_service.can_perform('reject_secondment', secondment_obj): raise PermissionDenied()`

## 10. Migration Plan from Views
1. Разработать класс `PermissionService` в `common/services/permissions.py`.
2. Покрыть `PermissionService` Unit-тестами на все 7 ролей.
3. Постепенно (по одному приложению) удалять `if role == ...` из `get_queryset()` во views и заменять их на `return permission_service.filter_queryset(qs)`.
4. Заменить вызовы ролей в `@action` на `permission_service.can_perform()`.

## 11. What Must Not Be Changed Yet
* Не переписывать существующий `common/rbac.py` или модели `UserRole` в этой задаче. `PermissionService` должен стать адаптером (Фасадом) над ними, а не заменять базу данных.
* Не применять `PermissionService` к Views в рамках этого Story.
* В рамках STORY-003 не писать код самого `PermissionService`, только дизайн.
