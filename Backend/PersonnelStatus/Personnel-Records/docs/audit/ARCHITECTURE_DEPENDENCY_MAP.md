# Аудит архитектуры и зависимостей (STORY-000.2)

Данный документ содержит анализ архитектуры проекта, выявленные зависимости между Django-приложениями, а также оценку рисков и рекомендации по дальнейшему рефакторингу в соответствии с концепцией чистой архитектуры и предметно-ориентированного проектирования (DDD). В ходе аудита исходный код не модифицировался.

## 1. Карта зависимостей между приложениями (App-by-App Dependency Map)

Анализ импортов (выполнен скриптом `scripts/audit_imports.py` на основе AST-парсинга) показал следующие кросс-зависимости внутри `organization_management/apps/`:

- **audit**: зависит от `divisions`
- **common**: зависит от `divisions`, `employees`, `staff_unit`, `statuses`
- **dictionaries**: зависит от `statuses`
- **divisions**: зависит от `employees`
- **employees**: зависит от `dictionaries`, `divisions`, `staff_unit`, `statuses`
- **notifications**: зависит от `employees`, `secondments`, `statuses`
- **reports**: зависит от `common`, `divisions`, `employees`, `notifications`, `secondments`, `staff_unit`, `statuses`
- **secondments**: зависит от `divisions`, `statuses`
- **staff_unit**: зависит от `common`, `dictionaries`, `divisions`, `employees`, `statuses`
- **statuses**: зависит от `dictionaries`, `divisions`, `employees`, `notifications`, `staff_unit`

## 2. Рискованные зависимости (Risky Dependencies)

- **`common` зависит от предметных областей:** Приложение `common` (общего назначения) импортирует `divisions`, `employees`, `staff_unit`, `statuses`. Приложение `common` должно предоставлять общие утилиты и не должно знать деталей предметных областей.
- **`reports` зависит почти от всех модулей:** Создает жесткую связь со структурой данных (`schema coupling`) других приложений. Требует изоляции через промежуточные сервисы или DTO.

## 3. Циклические импорты (Circular Imports)

- `divisions` ↔ `employees`
- `employees` ↔ `staff_unit`
- `employees` ↔ `statuses`
- `staff_unit` ↔ `statuses`
- `staff_unit` ↔ `common`
- `common` ↔ `employees`
- `common` ↔ `divisions`
- `statuses` ↔ `notifications`

Эти циклы заставляют использовать локальные импорты (внутри функций), что усложняет чтение кода и увеличивает хрупкость приложения.

## 4. Бизнес-логика в `views` и `serializers`

- **`secondments/api/views.py`**: Логика проверок статусов, вхождений в подразделение (через `get_descendants()`) и изменение состояния (`ApprovalStatus.APPROVED` / `REJECTED`) прошита прямо в методах `approve` и `reject`.
- **`employees/api/views.py`**: Перевод сотрудника происходит прямо во view с использованием `transaction.atomic()` и явным созданием `EmployeeTransferHistory`.
- **`divisions/api/views.py`**: Логика проверок иерархии (вычисление глубины, поиск активных сотрудников в ветке дерева) осуществляется прямо в `update` и `destroy`.

## 5. Дублирование логики (Duplicated logic)

- Во многих `views.py` дублируются проверки `request.user.is_superuser`, прежде чем делегировать проверку к кастомным правилам (например, `if not request.user.is_superuser: if not check_permission(...)`).
- Расчет области видимости подразделения (получение потомков) многократно дублируется: `request.user.division.get_descendants(include_self=True)`.

## 6. Хардкод путей и настроек (Hardcoded paths/settings)

- Жестко зашитые HTTP статусы в `Response` (например, `status=400` или `status=403`) во `views.py` вместо использования DRF констант (`status.HTTP_400_BAD_REQUEST`).
- Локальные файловые пути временно зашиты в слое генераторов отчетов.

## 7. Логика прав доступа, встроенная во `views` (Permission logic embedded in views)

- **`check_permission`**: Используется напрямую во многих методах `staff_unit/views.py`, смешивая логику обработки запроса и проверки прав: `if not check_permission(request.user, 'create_staffing_position', temp_obj): raise PermissionDenied(...)`.
- **`role_info`**: Используется для извлечения дивизиона `user_division = user.role_info.get_user_division()` в `reports/api/views.py` и `staff_unit/views.py`, что привязывает код к конкретной реализации `UserRole`.
- **Определение видимости**: Вызовы `get_descendants()` внедрены в `get_queryset` во множестве views (`secondments`, `divisions`), вместо инкапсуляции этой логики в селекторы или `PermissionService`.

## 8. Рекомендованные границы сервисов (Recommended future service boundaries)

1. **`PermissionService`**: Единая точка управления доступом и расчетом "зон видимости".
2. **Сервисы-селекторы (Selectors)**: Функции (например, `get_visible_employees(user)`) для извлечения данных без смешивания с `request`.
3. **Сервисы-мутаторы (Mutation Services)**: `EmployeeTransferService`, `SecondmentApprovalService` и `DivisionManagementService` для изоляции бизнес-правил и транзакционной целостности от `views`.

## 9. Безопасный порядок рефакторинга (Safe refactoring order)

1. **Изоляция прав доступа**: Интеграция `PermissionService` и перевод views на использование этого сервиса (и DRF Permissions).
2. **Вынос селекторов**: Вынос сложной логики `get_queryset()` в отдельные селекторы.
3. **Вынос логики мутаций**: Создание слоев сервисов для изоляции сохранения, транзакций и бизнес-валидации.
4. **Разделение зависимостей (Decoupling)**: Перевод прямых импортов моделей между приложениями на DTO / контракты.

## 10. Что нельзя трогать до написания тестов

- Логику переводов сотрудников (`EmployeeTransferHistory`) до покрытия транзакционными интеграционными тестами.
- Генераторы отчетов и логику агрегации данных (`DataAggregator`).
- Схемы БД (миграции) и переименование приложений, так как это разорвет существующие контракты с API.

## 11. Предложенные следующие шаги (Recommended next stories)

1. Создание и внедрение `PermissionService` (STORY-004, STORY-005).
2. Покрытие `EmployeeTransfer` интеграционными тестами (STORY-007).
3. Рефакторинг `get_queryset` во всех views на использование селекторов (STORY-008).
