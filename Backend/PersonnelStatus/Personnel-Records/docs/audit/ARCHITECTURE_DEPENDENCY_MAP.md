# ARCHITECTURE_DEPENDENCY_MAP

## 1. Цель аудита
Анализ текущей архитектуры проекта, выявление зависимостей между приложениями (Django apps), поиск бизнес-логики в некорректных слоях (views, serializers) и оценка рисков для планирования безопасного рефакторинга. Цель — подготовить почву для перехода к более чистой архитектуре (services, selectors).

## 2. Методика анализа
1. Автоматический анализ с использованием скрипта `scripts/audit_imports.py` для построения графа зависимостей между приложениями через AST-парсинг.
2. Ручной поиск и анализ исходного кода (`grep`, bash).
3. Классификация найденных проблем по уровням: LOW, MEDIUM, HIGH, CRITICAL.

## 3. Карта приложений
* `audit`
* `common`
* `dictionaries`
* `divisions`
* `employees`
* `notifications`
* `reports`
* `secondments`
* `staff_unit`
* `statuses`

## 4. App-by-app dependency map
* `audit` зависит от:
  - `divisions`
* `common` зависит от:
  - `divisions`
  - `employees`
* `dictionaries` зависит от:
  - `statuses`
* `divisions` зависит от:
  - `employees`
* `employees` зависит от:
  - `dictionaries`
  - `divisions`
  - `staff_unit`
  - `statuses`
* `notifications` зависит от:
  - `employees`
  - `secondments`
  - `statuses`
* `reports` зависит от:
  - `divisions`
  - `employees`
  - `notifications`
  - `secondments`
  - `staff_unit`
  - `statuses`
* `secondments` зависит от:
  - `divisions`
  - `statuses`
* `staff_unit` зависит от:
  - `common`
  - `dictionaries`
  - `divisions`
  - `employees`
  - `statuses`
* `statuses` зависит от:
  - `dictionaries`
  - `divisions`
  - `employees`
  - `notifications`
  - `staff_unit`

## 5. Cross-app imports
В проекте наблюдается тесная связность между `reports`, `staff_unit`, `statuses`, `employees` и `secondments`. Многие приложения обращаются напрямую к моделям друг друга.

## 6. Circular dependencies
* `employees` <-> `staff_unit` (CRITICAL)
* `staff_unit` <-> `statuses` (CRITICAL)
* `dictionaries` <-> `statuses` (CRITICAL)
* `employees` <-> `statuses` (CRITICAL)
* `notifications` <-> `statuses` (CRITICAL)
* `divisions` <-> `employees` (CRITICAL)

## 7. Business logic in views
* **`secondments/api/views.py`**: Управление статусами, создание связанных `EmployeeStatus` при одобрении (approve/reject/return) (HIGH).
* **`reports/api/views.py`**: Вызов `user.role_info.get_user_division()` (HIGH).
* **`employees/api/views.py`**: Расчет зон видимости подразделений через `get_descendants()` (MEDIUM).
* **`divisions/api/views.py`**: Агрегация и подсчет статистики (`active_in_branch`) (MEDIUM).

## 8. Business logic in serializers
Значительной сложной бизнес-логики в сериализаторах при беглом осмотре не выявлено, что является хорошим показателем (LOW). В основном стандартные валидации.

## 9. Hardcoded paths/settings
* `reports/utils.py`: Жестко закодированный путь к шаблону Excel: `os.path.join(settings.BASE_DIR, 'apps/reports/расход.xlsx')` (MEDIUM).
* В тестах встречается monkeypatch `settings.BASE_DIR`.

## 10. Permission/access logic in views
* В `secondments/api/views.py` и `reports/api/views.py` напрямую проверяются роли (например, `getattr(user, "role", None) == user.RoleType.SYSTEM_ADMIN`) и строятся сложные запросы `Q(from_division_id__in=allowed_ids) | Q(to_division_id__in=allowed_ids)` (HIGH).
* Повсеместное использование `request.user.division.get_descendants(include_self=True)` для проверки доступа и фильтрации прямо во view (HIGH).

## 11. Duplicated logic
* Расчет дерева подразделений (`get_descendants`) для определения зоны видимости пользователя дублируется в `secondments`, `employees`, `reports`, `staff_unit` (MEDIUM).
* Проверки ролей и доступов (`SYSTEM_ADMIN`, `DIRECTORATE_HEAD`) повторяются в разных ViewSet (MEDIUM).

## 12. Recommended service/selectors boundaries
* **`PermissionService`**: Единый сервис для расчета зон видимости и проверки прав доступа (чтобы убрать логику `get_descendants` и проверку ролей из views).
* **`SecondmentService`**: Сервис для управления прикомандированиями (approve, reject, return), скрывающий логику создания `EmployeeStatus`.
* **`ReportSelector`**: Для формирования данных отчетов, скрывающий сложную агрегацию и фильтрацию.

## 13. Risk matrix
* **CRITICAL**: Циклические зависимости `employees` <-> `divisions`, `employees` <-> `statuses`, `employees` <-> `staff_unit`, `divisions` <-> `staff_unit`, `statuses` <-> `staff_unit`, `statuses` <-> `divisions`, `secondments` <-> `divisions`, `secondments` <-> `statuses`.
* **HIGH**: Создание связанных сущностей (`EmployeeStatus`) из view прикомандирований. Жестко закодированные проверки доступов в views.
* **MEDIUM**: Дублирование логики получения дочерних подразделений (`get_descendants`). Hardcoded пути к файлам шаблонов.
* **LOW**: Стандартные операции ORM (get, filter) в views.

## 14. Safe refactoring order
1. Покрытие тестами текущего поведения прикомандирований и расчетов прав.
2. Выделение дублирующейся логики доступов (вычисление scope) в `PermissionService` (или `selectors`).
3. Рефакторинг `secondments/api/views.py` с переносом бизнес-логики в `application/services.py`.
4. Перевод остальных ViewSet на использование `services` и `selectors`.

## 15. What must not be touched yet
* Не изменять текущую логику генерации отчетов (`reports/utils.py`).
* Не выносить `EmployeeStatus` из `secondments/api/views.py` до появления тестов на этот функционал.
* Не трогать `get_descendants()` без внедрения `PermissionService`.

## 16. Recommended next stories
* Написание тестов на процесс одобрения/отклонения/возврата прикомандирований (`secondments`).
* Создание и внедрение базового `PermissionService` для расчета зоны видимости подразделений (scope).
