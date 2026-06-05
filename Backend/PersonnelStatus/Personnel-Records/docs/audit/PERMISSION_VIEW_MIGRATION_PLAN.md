# PERMISSION_VIEW_MIGRATION_PLAN

## 1. Цель
Цель данного документа — подготовить безопасный и поэтапный план миграции существующих эндпоинтов (Views / ViewSets) с прямой императивной логики авторизации (например, `if role == SYSTEM_ADMIN`) на централизованный фасад `PermissionService`, не меняя при этом бизнес-поведение системы.

## 2. Методика аудита
Аудит проводился с помощью специально написанного статического AST-анализатора (`scripts/audit_permission_usage.py`), который сканировал все модули приложений (`apps/`) на наличие вызовов, связанных с авторизацией:
* `role_info`
* `get_user_division()`
* `get_descendants()`
* `check_permission()`
* `SYSTEM_ADMIN`, `DIRECTORATE_HEAD`, `ROLE_4`, и т.д.

## 3. Общая картина текущей авторизации
Большинство эндпоинтов (в особенности переопределенные методы `get_queryset()`) содержат жестко закодированную проверку ролей.
Например:
* `employees/api/views.py` проверяет `user.RoleType.SYSTEM_ADMIN`.
* `reports/api/views.py` вызывает `user.role_info.get_user_division()` и `get_descendants()`.
* `secondments/api/views.py` вызывает `user.division.get_descendants(include_self=True)` для фильтрации запросов на прикомандирование и проверки адресатов при выполнении `approve`/`reject`.
* `staff_unit/views.py` обильно использует `check_permission()` и `role_info`.

## 4. Files/views to migrate (Таблица приоритетов)

| Priority | File/View | Current logic | Target PermissionService method | Required tests | Risk |
|---|---|---|---|---|---|
| P1 | `reports/api/views.py` | `role_info`, `get_user_division()`, `get_descendants()` | `filter_reports`, `can_generate_report` | report access tests | HIGH |
| P2 | `employees/api/views.py` | `SYSTEM_ADMIN`, `DIRECTORATE_HEAD`, `get_descendants()` | `filter_employees`, `can_view_employee` | employee visibility tests | HIGH |
| P3 | `statuses/application/services.py` | `get_descendants()` внутри сервисов | `filter_statuses`, `can_change_employee_status` | status edit scopes | MEDIUM |
| P4 | `staff_unit/views.py` | `check_permission()`, `get_descendants()`, `role_info` | `filter_staff_units`, `can_manage_staff_unit` | staff_unit crud tests | HIGH |
| P5 | `secondments/api/views.py` | `SYSTEM_ADMIN`, `DIRECTORATE_HEAD`, `get_descendants()` | `filter_secondments`, `can_approve_secondment` | secondment workflow tests | HIGH |
| P6 | `divisions/api/views.py` | `get_descendants()` для ограничения иерархий | `get_visible_divisions`, `can_view_division` | division scope tests | MEDIUM |
| P7 | `dictionaries`, `notifications`, `audit` | `ROLE_4` (в тестах/админке), `check_permission` | `can_perform(action)` | default permission checks | LOW |

## 5. Current authorization logic per view
* **`reports/api/views.py`**: Определяет `allowed = user_division.get_descendants()` и фильтрует доступные отчеты или проверяет права на генерацию нового отчета.
* **`employees/api/views.py`**: Для получения списка сотрудников заново перепроверяет роль (Админ видит всех, остальные видят только свои `allowed = request.user.division.get_descendants()`).
* **`secondments/api/views.py`**: При выполнении `.approve()` жестко проверяет: `if role == request.user.RoleType.DIRECTORATE_HEAD: ... allowed = request.user.division.get_descendants()`.
* **`staff_unit/views.py`**: Проверяет права напрямую через `check_permission()` на каждое действие (например, `create_vacancy`).

## 6. Target PermissionService method per view
Каждая явная проверка из пункта 5 будет заменена вызовом конкретного метода `PermissionService`:
* `get_visible_divisions()`
* `can_perform(action, obj=None)`
* `filter_employees(qs)`
* `filter_staff_units(qs)`
* `filter_statuses(qs)`
* `filter_secondments(qs)`
* `filter_reports(qs)`
* `can_view_employee(employee)`
* `can_change_employee_status(employee)`
* `can_generate_report(division)`
* `can_view_division(division)`
* `can_manage_staff_unit(staff_unit)`
* `can_approve_secondment(secondment)`

## 7. Migration priority
Рефакторинг начнется с `reports`, так как это логическое продолжение предыдущих аудитов производительности и Daily Expense отчета. Затем `employees`, `statuses` и `staff_unit`, поскольку эти приложения составляют ядро учета персонала. В последнюю очередь мигрируются второстепенные приложения (Словари, Уведомления).

## 8. Required tests before each migration
* **reports**:
  - SYSTEM_ADMIN can generate report for any department
  - DIRECTORATE_HEAD can generate only own directorate/subtree report
  - unauthorized user gets 401
  - authenticated but out-of-scope user gets 403
* **employees**:
  - user sees only employees inside visible divisions
  - out-of-scope employee is hidden
  - SYSTEM_ADMIN sees all
* **statuses**:
  - operator can change status only inside own scope
  - viewer cannot change status
  - status history remains unchanged
* **secondments**:
  - Directorate head can approve secondment only if to_division is inside their scope.
* **staff_unit**:
  - Cannot manage staff unit outside allowed division tree.

## 9. Risk matrix
* **HIGH**: Изменение `reports/api/views.py`, `employees/api/views.py`, и `secondments/api/views.py`. Ошибка в `get_queryset()` может привести к утечке данных целых подразделений.
* **HIGH**: Рефакторинг `staff_unit/views.py`. Из-за плотного использования `check_permission()`, неверная привязка может сломать CRUD-операции над штатным расписанием.
* **MEDIUM**: `statuses`. Приложение в основном завязано на сервисы, ошибки могут заблокировать перевод сотрудников в отпуск или больничный.
* **LOW**: Словари, уведомления. Логика ролей в этих модулях минимальна.

## 10. What must not be changed yet
* В рамках плана (до начала имплементации Story) запрещено переписывать какие-либо views, serializers, models.
* Текущий генератор JWT и настройки авторизации (`REST_FRAMEWORK` / `SIMPLE_JWT`) остаются нетронутыми.
* Учет "Daily Marks" не должен начинаться до завершения полной интеграции `PermissionService`.
* Настройка пайплайнов (CI) отложена.

## 11. Recommended implementation order
1. **STORY-006**: Покрытие `reports/api/views.py` тестами доступов, внедрение `PermissionService.filter_reports` и `can_generate_report`.
2. Внедрение `PermissionService` в `employees` и `statuses`.
3. Внедрение в `staff_unit` и `secondments`.
4. Удаление легаси-проверок ролей из всех остальных Views.

## 12. Acceptance checklist before STORY-006
* [x] План миграции формализован и согласован.
* [x] Скелет `PermissionService` покрыт Unit-тестами (STORY-004).
* [x] Определен набор необходимых интеграционных API-тестов.
* [x] `test_daily_expense_contract.py` стабильно зеленый, что гарантирует работу Daily Expense отчетов.
