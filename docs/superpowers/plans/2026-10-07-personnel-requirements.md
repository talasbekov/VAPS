# Personnel requirements implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Independent implementations use dispatching-parallel-agents.

**Goal:** Исправить подтверждённые дефекты и выполнить требования фотографий.

**Architecture:** Сохранить Django/Next.js, существующие права и снимки сдачи.
Добавить недостающие данные на сервере, использовать их во всех представлениях.

**Tech Stack:** Django, PostgreSQL, Next.js, React Query, pytest, Playwright.

**Spec:** ../specs/2026-10-07-personnel-requirements-design.md

## Global Constraints

- Сохранять UUID, nullable-даты и импортный порядок.
- Тесты использовать с отдельной PostgreSQL; рабочая база не меняется.
- Не публиковать и не заменять архивы в этой итерации.

## Review Focus

- Сортировка должна действовать между страницами, включая импортные записи.
- Одинаковые имена управлений не объединяют разные идентификаторы.
- Даты отсутствия отображаются включительно без изменения API.
- Снимок вложенного свода не меняется при последующей пересдаче.
- Уведомления разных этапов сохраняются при одинаковом адресате.

## Task 1: Данные и документы расхода

Files: ops/daily.py, operations snapshot/status serializers, expense_document.py,
expense_release.py, expense_layout.py, expense renderers and regression tests.
Interfaces: daily employees expose full_name, position_level, position_name,
department/directorate metadata; status reads expose destination (string).

- [x] Написать и воспроизвести регрессии полного ФИО, места убытия и вложенного свода.
- [x] Исправить источник данных и обход закреплённых версий, сохранить старые снимки.
- [x] Проверить полный состав и детализацию документов без обрезки имён.
- [x] Прогнать соответствующий pytest-набор.

## Task 2: Напоминания

Files: operations reminder services/tasks, settings/base.py, notification UI/tests.
Interfaces: SUBMISSION_LAGGING payload phase=before_deadline|overdue, ids и срок.

- [x] Воспроизвести пропуск расписания и двух этапов в тестах.
- [x] Подключить периодическую задачу, этапы и несколько scoped получателей.
- [x] Проверить границы срока, дедупликацию, сдачу между этапами и повтор после сбоя.

Review additions: существующее право `daily_report.mark_update`, предыдущее
местное число для срока около полуночи, допустимая временная роль через
реальные serializer/service вместо обхода правил выдачи.

## Task 3: Должностная иерархия и управления

Files: staff_unit/views.py, components/status-table.tsx, regression tests.
Interfaces: staff rows additive department/directorate id/name metadata.

- [x] Проверить обратный порядок создания и переход между страницами.
- [x] Сортировать на сервере, группировать статусы по управлению на клиенте.
- [x] Проверить одинаковые названия разных управлений и реальные division_id записи.
- [x] Сохранить и восстановить редактируемое место убытия в статусе.

## Task 4: Экраны расхода, свода и боевого дежурства

Files: daily-expense UI, service-summary UI, combat page/navigation/API helpers.
Interfaces: consume Task 1 metadata and existing duty API/permissions.

- [x] Воспроизвести пропущенного заместителя, детали отсутствия и ненужные имена свода.
- [x] Показать полный расход и автоматически выделить руководство департаментов.
- [x] Добавить серверный раздел боевого дежурства и убрать старое название в UI.
- [x] Выполнить браузерные сценарии и npm run gate:front / test:integration.

Review additions: агрегировать корневой персонал; включить принятые серверные
боевые группы без проекции в статусы; проверять исторический доступ по
доверенному сохранённому ID подразделения подающего, старые записи без ID
оставить глобальному читателю; сбрасывать недействительный фильтр при смене даты.

## Task 5: Проверка и документация

- [x] Проверить миграции и backend-набор на PostgreSQL.
- [x] Провести независимое ревью исправлений, устранить значимые замечания.
- [x] Обновить docs/vault/Задачи.md и Журнал.md с результатами и ограничениями.

Финальный backend: 5984 passed, 1 skipped. Frontend: 23 passed (13 браузерных
сценариев и 10 проверок уведомлений), 26 контрактов; frontend gate / production
build. No changes detected в миграциях; system check 0 issues. Последнее
независимое ревью подтвердило устранение privacy blocker.
