---
name: project-reports-expense-aggregator
description: DataAggregator расхода переписан 14.08.2026 — раньше падал на несуществующем Employee.division и считал 7 типов статуса из 13
metadata: 
  node_type: memory
  type: project
  originSessionId: ba6988f1-2326-4a03-ab84-323031645e67
---

Коммит `dc055c34` (Personnel-Records, `apps/reports/infrastructure/`).

**У `employees.Employee` НЕТ поля подразделения.** Подразделение сотрудника —
только через `staff_unit.division` (StaffUnit.employee — OneToOne). Прежний
`Employee.objects.filter(division_id__in=...)` ронял сборку FieldError'ом, то
есть `reports/tasks.generate_report_task` всегда уходил в FAILED.

Что теперь держит расход:
- `REPORT_COLUMN_BY_STATUS` — колонка для КАЖДОГО типа статуса, разбиение
  повторяет `report_column_code` канонического каталога ОМ (отпуск по рапорту →
  «Отпуск»; соревнования и конференция → «Учёба»; дежурство и отдых после —
  свои колонки). Тип без колонки краснит тест полноты — это и есть гвард,
  которого не было;
- `headcount` + тест «сумма колонок == headcount»;
- отменённые не считаются; конец периода — `actual_end_date` при наличии
  (досрочно завершённый статус хранит прежний `end_date`);
- прикомандированные — по `related_division` строк SECONDED_TO, БЕЗ сужения по
  штату отчёта;
- `PRESENT_OWN_COLUMNS` — единственное место определения «наличествует».

Ловушки, стоившие времени:
- **MPTT + `values().annotate()` без `order_by()`**: сортировка по дереву
  уезжает в GROUP BY, группировка дробится, штатная численность = 1. Касается
  StaffUnit и Division — обеих;
- `EmployeeStatus.save()` вызывает `full_clean()` и ЗАПРЕЩАЕТ пересекающиеся
  статусы. Отсюда: в тестах нужен `created_by`, а пару статусов на один период
  можно завести только `bulk_create`;
- `secondments/api/views.py::approve` был сломан этим же правилом (две строки
  на период) — **починен коммитом `458c8cf6`**: теперь ОДИН статус SECONDED_TO,
  принимающая сторона выводится из его `related_division`. Зеркальные строки
  SECONDED_FROM больше не заводятся;
- генераторы xlsx/docx/pdf перечисляли колонки СВОИМИ списками — теперь
  заголовки и ячейки из `infrastructure/report_table.py`, по `data["columns"]`.

Бумажный «расход» (`reports/utils.py`) — другой путь и другой документ, у него
свои колонки; они пересекаются, но код не общий.

Связано: [[project_duty_assignment_link]], [[feedback_noop_red_probe]].
