# Рабочее место дежурного и интеграция — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Shared repository; each worker owns only the files assigned below. Root runs verification and commits.

**Goal:** Реализовать семь пользовательских задач с сохранением данных и одним рабочим стендом.

**Architecture:** Существующие сервисы и маршруты, отдельная версия read-only API и additive права. Выгрузки и статусы остаются в своих сервисах; общий журнал задаёт канонический состав.

**Tech Stack:** Django/DRF/PostgreSQL, Next.js/TypeScript/Playwright; существующие офлайн-зависимости.

**Spec:** ../specs/2026-10-16-officer-workspace-and-integration-design.md

## Global Constraints

- Рабочий стек 3380/18380: 2008 сотрудников, 194 подразделения, 20 ОМ, 4 объекта; PG и том не заменять.
- Digital, чужие контейнеры и все существующие тома сохранить. Только собственные временные проверки.
- Не менять импортные ID, nullable-даты, историю и пользовательские гранты.
- API без персональных данных и обратной записи. Сохранённые координаты, без внешней сети.

## Review Focus

- Сохранение паспорта с прежними/чужими/повторными/временными ID и двумя конкурентными создателями.
- Чтение кадрового свода при закрытом workspace, смешанные/custom роли и обычный сотрудник.
- Числа с неполной пагинацией, поздний ответ после отзыва права, прошлые незакрытые ОМ.
- Пост каталога и пост ОМ с разными идентификаторами; неизвестные точки/потребность; retired место.
- Агрегаты по уникальным людям на дату, кадровые/почасовые/ОМ источники без сложения и утечки ПДн.

## Task 1 — Целостность каталога

Files: apps/ops/passport.py, apps/ops/tests/test_passport_catalog_integrity.py, features/object-passport/ui/PassportForm.tsx.

- [x] Добавить регрессии ID/назначения, malformed/длины/atomic reject, разрыв кода/конкурентное создание.
- [x] Root подтверждает RED в отдельном PostgreSQL; затем минимальное исправление.
- [x] Выполнить новые и существующие паспортные/статусные/диспетчерские проверки, независимый обзор.

## Task 2 — Рабочее место

Files: entities/portal-access, components/navigation, app/statuses, employee deep link, app/reports, app/security-ops/{service-reports,command-center}, app/settings/permissions, shared report navigation, e2e/ux-duty-workspace.spec.ts.

- [x] RED: кадровый экран, явный grant, единые отчёты по четырём наборам прав, фактические числа/вторая страница/сбой.
- [x] Внести ограниченные изменения интерфейса; старые mock-разрешения обновить по смыслу.
- [x] Browser GREEN и gate:front; scoped review.

## Task 3 — Права

Files: apps/operations/management/commands/seed_operations.py; additive migration0144; focused migration/permission tests.

- [x] RED: pure DUTY, mixed/custom role, повтор migration/seed, сохранность UserRole.
- [x] Добавить status.workspace, digital_twin.read и DIGITAL_TWIN_READER; дополнять существующие гранты без удаления.
- [x] GREEN и drift check; объяснить необходимость миграции в инструкции.

## Task 4 — API Цифрового двойника

Files: apps/ops/digital_twin.py, apps/ops/api/digital_twin.py, config/urls.py, apps/ops/duty_roster.py только минимальное извлечение общего чтения, focused tests и docs/digital-twin-api.md.

- [x] RED: отсутствующий API, глобальное право, методы/даты, catalog/events/maps/duty агрегаты, сохранность ID и null, отсутствие ПДн.
- [x] Реализовать явные serializers/OpenAPI и сервис whitelist-полей; использовать общий выбор кадровых статусов.
- [x] GREEN, регрессии общего журнала и независимый обзор контракта/прав.

## Task 5 — Проверка и локальное применение

- [x] Проверить source/права/связанные PostgreSQL тесты, gate:front и browser; удалить временные проверки/образ.
- [x] Собрать текущие два app-образа без сети, резервировать БД/загрузки, применить additive migration и приложения в прежнем стеке.
- [x] Реальные API/UI от нужных ролей, сохранность кадровых хэшей/томов/других проектов; корневой launcher и памятки.
- [x] Обновить Задачи/Журнал и отчёт, зафиксировать локальные коммиты. Серверное применение не заявлять.
