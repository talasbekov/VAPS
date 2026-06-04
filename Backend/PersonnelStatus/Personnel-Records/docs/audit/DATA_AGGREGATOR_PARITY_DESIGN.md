# DATA_AGGREGATOR_PARITY_DESIGN

## 1. Current Sync Source of Truth Behavior
Синхронный путь (`reports/utils.py`, `generate_personnel_expense_report`) является текущим эталоном (Source of Truth) и работает по следующим правилам:
* **Итерация по Управлениям (Directorates)**: Для каждого управления выполняется `get_descendants(include_self=True)`, после чего все дочерние элементы объединяются в статистику этого управления.
* **Строка "ИТОГО"**: Включает не только сумму всех Управлений, но и **прямые штатные единицы на уровне Департамента** (Department-level staff units).
* **Списки отсутствующих**: Собираются рекурсивно по каждому Управлению с получением полного ФИО.

## 2. Current DataAggregator Behavior
Текущий асинхронный механизм (`DataAggregator.collect_data`) работает неверно:
* **Плоская агрегация**: Использует `values('staff_unit__division_id').annotate(total=Count('id'))`. Группировка происходит по конкретному ID дивизиона, без поднятия (rollup) значений до уровня родительского Управления (Directorate).
* **Отсутствие рекурсии**: Сотрудник в "Отдел 1" будет подсчитан только для строки "Отдел 1", но не приплюсован к "Управление 1". В результате метрики "Управление 1" занижены.
* **Сломанная строка ИТОГО**: Сводка (`summary`) возвращает нули по всем метрикам из-за неверного расчета.
* **Выведенный in_service**: `DataAggregator` пытается математически вычислить количество в строю (`inferred_in_service = max(0, total - known)`). `utils.py` считает `IN_SERVICE` напрямую через ORM.

## 3. Exact Mismatches (From Contract Test)
По результатам интеграционного тестирования (`test_daily_expense_contract.py`):
* **Управление 1 (staff_units)**: Sync = 5, Async = 1 (Async потерял 4 штатки из Отдела 1 и вакансию).
* **Управление 1 (trip)**: Sync = 1, Async = 0 (Командировка была в Отделе 1).
* **ИТОГО (staff_units)**: Sync = 6, Async = 0.
* **ИТОГО (in_service)**: Sync = 2, Async = 0.

## 4. Target Parity Rules
Чтобы `DataAggregator` стал безопасной заменой (и источником данных для `utils.py`), он должен:
1. Выдавать статистику строго на уровне Управлений (Directorates), суммируя все дочерние отделы.
2. Отдельно вычислять метрики для сотрудников уровня Департамента (руководство/напрямую подчиненные Департаменту).
3. Суммировать ИТОГО как сумму всех Управлений + руководство Департамента.
4. Отказаться от "inferred" логики для статусов: считать все явно по записям `EmployeeStatus` для полного паритета.

## 5. Proposed Algorithm (Safe MPTT aggregation)
Для предотвращения N+1 запросов, необходимо уйти от вызова `get_descendants()` в цикле. Предлагаемый безопасный алгоритм:
1. Выполнить **один** запрос для получения всех подразделений в scope:
   `divisions_qs = report.division.get_descendants(include_self=True)`
2. Выполнить **один** запрос (через `annotate` и `values`) для получения штаток:
   `StaffUnit.objects.filter(division__in=divisions_qs).values('division_id').annotate(...)`
3. Выполнить **один** запрос для получения статусов:
   `EmployeeStatus.objects.filter(employee__staff_unit__division__in=divisions_qs, ...).values('employee__staff_unit__division_id', 'status_type').annotate(...)`
4. **Python-Rollup (Агрегация в памяти)**: Вместо того, чтобы база считала древовидные суммы (что сложно в Django ORM), мы собираем словарь: `dict[division_id] = metrics`. Затем проходим по списку `directorates = ...filter(parent=department)`. Для каждого `directorate` ищем все дочерние `division_id` (это можно сделать быстро в памяти, либо через MPTT `lft`/`rght` свойства, полученные 1 раз) и суммируем их значения в итоговую строку Управления.

## 6. How to preserve direct Department-level total behavior
Сотрудники и штатки, привязанные напрямую к Департаменту (где `division_id == department.id`), должны быть собраны в отдельный бакет `head_metrics`.
Итоговая строка вычисляется как: `Total = Sum(Directorates) + head_metrics`.

## 7. How to calculate each field
* `staff_units`: Считается по `StaffUnit.objects.filter(division_id__in=...)`
* `employees`: `StaffUnit.objects.filter(division_id__in=..., employee__isnull=False)`
* `vacancies`: `StaffUnit.objects.filter(division_id__in=..., employee__isnull=True)`
* `in_service`, `vacation`, `trip`, `sick`: Группировка по `status_type` из `EmployeeStatus.objects`.

## 8. Risks
* Возможная нехватка памяти при агрегации больших департаментов в Python (Python-Rollup), однако для сотен и даже пары тысяч записей словари Python работают мгновенно (в отличие от N+1 ORM запросов).
* Если кто-то ожидает старое поведение `DataAggregator` для других отчетов, изменение может их сломать (нужно проверить, используется ли `DataAggregator` где-то еще, кроме `EXPENSE`).

## 9. Tests Required Before Implementation
* `test_daily_expense_contract.py` (уже написан). Он должен стать полностью зеленым (`assert sync == async`) после завершения рефакторинга.

## 10. Step-by-Step Implementation Plan
1. Внести изменения в `DataAggregator.collect_data()`, добавив алгоритм Python-Rollup для группировки данных по корневым Управлениям (Directorates).
2. Обновить логику подсчета статусов на прямое чтение (убрать `inferred_in_service`).
3. Запустить `test_daily_expense_contract.py` и добиваться полного совпадения.
4. (Отдельная задача): после успешного паритета перевести `generate_personnel_expense_report` (XLSX генератор) на использование метода `DataAggregator.collect_data()` для устранения N+1.
