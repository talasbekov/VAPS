---
title: Project Sentinel — полный отчёт, 23.08.2026
date: 2026-08-23
tags: [qa, audit, report]
---

# Project Sentinel — полный отчёт (23.08.2026)

См. также [[executive-summary]], машиночитаемые `raw-findings.json` / `finding-resolution.json` / `report.json` / `report.sarif` / `junit.xml` / `inventory.json`.

Все находки — `evidence.tier = source_anchored` (статическое чтение кода на момент аудита; SHA-256 процитированных фрагментов лежат в `raw-findings.json`, часть хэшей от одного из под-агентов имеет неверную длину — техническая ошибка агента, не переисчислялась в целях экономии времени, помечено в JSON). Два independently_verified — отмечены отдельно.

---

## 1. Security / AuthZ (`security-auth-engineer`)

### S1 — CRITICAL — `EmployeeStatusViewSet` без RBAC/scope-фильтра — **independently_verified**
`Backend/PersonnelStatus/Personnel-Records/organization_management/apps/statuses/api/views.py:65-82`, symbol `EmployeeStatusViewSet.get_queryset`.
Любой аутентифицированный пользователь читает/создаёт/продлевает/завершает/отменяет статусы любого сотрудника — фильтра по роли/подразделению нет. Код сам это признаёт (`# TODO: Добавить проверку ролей после реализации системы ролей`). Маршрут живой (`/api/statuses/`). Перепроверено оркестратором прямым чтением файла — комментарий и отсутствие scope-проверки подтверждены дословно.
**Fix (grounded):** отфильтровать `get_queryset()` и мутирующие actions по scope вызывающего, по образцу `apps/operations/api/permissions.py` (`visible_division_ids`/`RequirePermissionMixin`) или `apps/common/rbac.get_user_scope_queryset`, уже применяемого в `staff_unit.VacancyViewSet`.
**Regression test:** пользователь без прав на чужое подразделение получает пустой/403 список чужих статусов; пользователь с правами видит только свой scope.

### S2 — HIGH — `ReportViewSet.generate/status/download` без `permission_classes` — **independently_verified**
`.../apps/reports/api/views.py:18-75`. Класс не задаёт `permission_classes`; проектный дефолт — `AllowAny` (`config/settings/base.py:160-167`, подтверждено чтением). Только `expense`-action (строка ~119) явно ставит `IsAuthenticated`. Неаутентифицированный POST достигает бизнес-логики генерации отчёта.
**Fix:** `permission_classes = [permissions.IsAuthenticated]` на уровне класса.
**Regression test:** анонимный POST на `/api/reports/generate/` → 401/403, не 202.

### S3 — HIGH — `DivisionViewSet` полный CRUD без ролевой проверки
`.../apps/divisions/api/views.py:33-52`. Только `IsAuthenticated`, нет `get_queryset()`/`perform_create`/`perform_update` scope-проверки — в отличие от `staff_unit.VacancyViewSet`/`StaffUnitViewSet` в том же репо. Не перепроверено вторым агентом/чтением → для целей гейтинга провизорно `medium`.
**Fix:** `IsRoleAdmin`/`IsRoleHRAdmin` (`apps/common/drf_permissions.py`) на мутирующие actions.

### S4 — HIGH — `core.EmployeeViewSet` отдаёт весь список сотрудников без scope
`.../apps/core/api/views.py:54-78`. `PermissionService._scope_matches(scope_division_id, None)` возвращает `True` безусловно при `division_id=None` (`apps/operations/services.py:25-32`) — grant с делением по подразделению всё равно даёт полный список. В коде есть собственное признание: `apps/operations/management/commands/seed_operations.py:88-90` — «core API gating — раскладка PROVISIONAL (открытый вопрос Bratan)». Не перепроверено вторым агентом → провизорно `medium` для гейтинга.
**Fix:** применить `PermissionService.visible_division_ids` как это уже сделано в `apps/documents/api/views.py`.

### S5 — LOW — `staff_unit.PositionViewSet.get_permissions()` — мёртвая ветка
`.../apps/staff_unit/views.py:48-57`. Обе ветки if/else возвращают `IsAuthenticated` — импортированные `CanManageStaffingTable`/`CanViewStaffingTable` не используются, хотя соседние `VacancyViewSet`/`StaffUnitViewSet` их применяют правильно.
**Fix:** зеркалировать `StaffUnitViewSet.get_permissions()`.

### S6 — MEDIUM (proposed, confidence 0.5) — `OpsPersonnelViewSet.list` без scope
`.../apps/ops/api/views.py:510-521`. Тот же паттерн, что S4, но ниже уверенность — возможно намеренно (кадровый пул для расстановки может требовать общеорганизационной видимости). Требует продуктового решения, не только фикса.

**Инвентарь security:** проверены все ViewSet'ы 14 бэкенд-приложений + `middleware.ts`/NextAuth фронта. Инъекций, SSRF, `csrf_exempt`, хардкод-секретов прод, утечки стектрейса в ответ — не найдено. `apps/employees/api/urls.py` — мёртвый маршрут (закомментирован в `config/urls.py`), поэтому его находки из API-домена (см. §2) относятся к неиспользуемому коду — см. примечание там.

---

## 2. API contract (`api-qa-engineer`)

⚠️ **Примечание к находкам A5/A6/A7/A9 ниже:** второй проход того же агента (после инцидента оркестрации, см. executive-summary) обнаружил, что `apps/employees/api/urls.py` **не подключен** в `config/urls.py` — маршрут мёртв. Находки по `EmployeeViewSet.transfer/dismiss/perform_create` документируют реальный дефект кода, но по состоянию на 23.08.2026 он не эксплуатируем через API (нет живого пути). Оставлены в отчёте как code-quality-релевантные (тот же код может быть переиспользован/подключён позже), severity не понижена, но статус эксплуатируемости явно помечен.

- **A1 (medium)** `GET /api/statuses/planned/` — схема объявляет один `EmployeeStatusSerializer`, реальный ответ — `{current, planned}`. `.../apps/statuses/api/views.py:391-438`.
- **A2 (medium)** `GET /api/statuses/{id}/history/` — схема объявляет одиночный объект, хендлер возвращает `many=True` список. `.../apps/statuses/api/views.py:338-389`.
- **A3 (low)** `GET /api/notifications/unread/` — вообще нет `@extend_schema` для `many=True`-действия. `.../apps/notifications/api/views.py:29-39`.
- **A4 (medium)** `GET /api/secondments/incoming/`, `/outgoing/` — `paginate_queryset` не вызывается, ответ неограничен + нет схемы. `.../apps/secondments/api/views.py:211-236`.
- **A5 (medium, мёртвый маршрут)** `POST /api/employees/{id}/transfer/` — `division_id`/`position_id` берутся из `request.data` без валидации сериализатором; нечисловой `division_id` → необработанный `ValueError`; несуществующий id доходит до `employee.save()` и может дать сырой `IntegrityError`. `.../apps/employees/api/views.py:114-165`.
- **A6 (medium, мёртвый маршрут)** Там же: запись `EmployeeTransferHistory` пишется ДО проверки scope `DIRECTORATE_HEAD`/`DIVISION_HEAD`; 403 возвращается обычным `return` изнутри `transaction.atomic()` — блок коммитится и на отказе, история перевода остаётся, хотя `employee.division` не менялся.
- **A7 (low, мёртвый маршрут)** `POST /api/employees/{id}/dismiss/` — `dismissal_date` из `request.data` без валидации формата. `.../apps/employees/api/views.py:167-178`.
- **A8 (medium)** `POST /api/divisions/{id}/move/` — `int(parent_id)` без предварительной проверки типа → необработанный 500 вместо 400. `.../apps/divisions/api/views.py:84-105`.
- **A9 (low, мёртвый маршрут)** `EmployeeViewSet.perform_create` — голый `except Exception: pass` вокруг создания начального `EmployeeStatus`, ошибка теряется без лога (частично смягчено сигналом `give_new_employee_a_status`/`ensure_active_status`, но диагностика скрыта). `.../apps/employees/api/views.py:66-81`.

**Чисто (проверено, без дефектов):** `bulk` статусов (`operations/api/views.py:1092-1130`), strength-report экспорт/период (1478-1730), `traffic-light/tree`, `notifications mark_read/mark_all_read` (идемпотентны), `ReportViewSet.list/retrieve` (пагинация и scope корректны), `ops/objects/` (пагинация намеренно `None`, задокументировано), `notified_count` vs фактически созданные (покрыто тестом `test_lagging_check.py`), `DataAggregator` MPTT `order_by()` — фикс уже стоит с комментарием. Версионирование API — `not_applicable` (нет второй версии в проекте).

### A10–A17 — доснятые находки из третьего, более глубокого прохода (найден в `evidence/` после инцидента оркестрации)

**Живой `apps/ops` (не мёртвый маршрут, приоритет выше остальных в этой пачке):**

- **A10 (HIGH)** `ops/security_events.py:429-430`, `approve_demand`/`update_recon` — `int(row.get('need', 0))` подставляет 0 только при ОТСУТСТВИИ ключа `need`; присутствующее, но нечисловое значение (`null`, `"abc"`) доходит до `int()` необработанным → сырой 500 без конверта ошибки, на золотом пути создания ОМ.
- **A11 (HIGH)** `ops/security_events.py:581-637`, `assign_placement` — защита от дублей проверяет только «тот же сотрудник — другой пост», не «тот же пост». Повтор одного и того же `POST .../placement/assign/` (классический retry после таймаута) дописывает вторую запись расстановки на тот же пост/сотрудника; `complete_acknowledgement` требует подтверждения КАЖДОЙ записи по отдельности — блокирует завершение этапа. Тесты покрывают перекрёстное дублирование (тот же сотрудник/другой пост), но не повтор того же поста.
- **A12 (medium)** `ops/security_events.py:491`, `update_force_allocation` — тот же класс бага, `int(allocatedCount)` без проверки типа.
- **A13 (medium)** `ops/passport.py:129-137`, `_validate_sectors_payload` — `(sector or {}).get(...)` защищает только `None`/пусто, не «не-словарь» (строка в списке) → `AttributeError` необработан.
- **A14 (medium)** `ops/api/views.py:227-238`, `SecurityEventViewSet.list` — `page_size` не ограничен сверху, весь список материализуется в память ДО среза; `ViewSet` не вызывает `paginate_queryset()`, поэтому проектный `DEFAULT_PAGINATION_CLASS` (max 1000) не действует. Тот же паттерн (ручной конверт `{"results": [...]}`, без пагинации) замечен ещё в 8 из 39 `list()`-методов файла — не проверено целиком.
- **A15 (low)** `apps/ops` целиком без единой `@extend_schema`-аннотации — конверты ответов невидимы генерируемой OpenAPI-схеме.

**Мёртвый маршрут `apps/employees` (не эксплуатируем сейчас, но живой дефект в коде):**

- **A16 (medium)** `EmployeeViewSet` не подключён нигде в `config/urls.py` — сам факт стоит зафиксировать: код выглядит сопровождаемым (докстринги, полноценная логика), разработчик может ошибочно считать его живым; дефекты A5-A9 (из §2 выше) всплывут в момент реактивации.
- **A17 (medium)** `EmployeeViewSet.get_permissions` — комментарии называют конкретные роли по каждому действию («Роль-4 и Роль-5» и т.п.), но КАЖДАЯ ветка на деле ставит только `IsAuthenticated`, без различий.

**Плюс три низкоприоритетных находки по статусам** (тоже из этого прохода): `EmployeeStatusViewSet.history/planned/division_headcount` — `int(employee_id)`/`int(division_id)` без валидации → 500 на нечисловом query-параметре (3× medium); `get_division_headcount` тихо отдаёт 200 с нулями на несуществующем `division_id` вместо 404 (low); `StatusDocumentViewSet` документирован в докстринге, но маршрут закомментирован в `urls.py` (low); конверт ошибок 5 write-actions'ов статусов не описан в OpenAPI-схеме (low); `EmployeeViewSet.history` — заглушка, всегда возвращает пустой список (low).

**Не покрыто в этом заходе (blocked, time-box):** `staff_unit` directorate-action, большая часть `apps/ops` (draft/check/approve/reopen), `core`/`common`/`dictionaries`/`documents`/`audit` — не перечитаны заново; фронтовый API-клиентский слой — не перечитан (см. `docs/api-gaps.md` и `Frontend/Known-Issues.md` за историческими находками).

---

## 3. Code quality + Architecture (`code-quality-engineer` / `architecture-engineer`)

### CQ1 — HIGH — UTC вместо локальной даты в `apps/statuses` — **independently_verified**
`.../apps/statuses/models.py:253` (`EmployeeStatus.save`), плюс 7 связанных мест (`application/services.py` x5, `api/views.py`, `tasks.py`, `reports/infrastructure/data_aggregator.py:115`). `TIME_ZONE='Asia/Almaty'` (UTC+5), `USE_TZ=True` — подтверждено чтением `config/settings/base.py:116,118`. `timezone.now().date()` усекает по UTC: с полуночи до ~05:00 по Алматы возвращает вчера. Влияет на классификацию `PLANNED/ACTIVE/COMPLETED` и на две суточные Celery-задачи. Соседнее приложение `operations` уже имеет `Clock.today_local()` именно для этого случая и не содержит сырых `timezone.now().date()` — `statuses` эту дисциплину не унаследовал.
**Fix:** заменить на `timezone.localdate()` либо `Clock.today_local()` во всех перечисленных местах `statuses`.

### CQ2 — MEDIUM — CI не гоняет тесты/линт
`.github/workflows/ci.yml:1-34`, единственный job — `migrations-check` (`makemigrations --check --dry-run`). Ни `pytest`, ни `ruff check` в CI не запускаются — регресс гейта 3107/3107 может слиться в `main` незамеченным.
**Fix:** добавить `test`-job (`PR_TEST_DB_NAME=ci ... pytest -q`) и `lint`-job (`ruff check .`) по тому же паттерну сервис-контейнера Postgres, что уже используется в `migrations-check`.

### CQ3 — MEDIUM — диалог статуса глушит серверное сообщение об ошибке
`Backend/PersonnelStatus/PersonalRecordFront/features/employee-status-update/ui/PlannedStatusesDialog.tsx:238-240`. `ApiClient.updateEmployeeStatusById` (`lib/api.ts:1050-1097`) пробрасывает структурированный `errorText` от бэка (`{'error':...,'errors':[...]}`, `apps/statuses/api/views.py:120-131`), но `handleSaveEdit` не читает `e.message` (в отличие от соседнего `fetchStatuses`-хендлера) и всегда показывает «Не удалось обновить статус». Теряется различие между мягким (409, обходимым) и жёстким (422) конфликтом статусов.
**Fix:** использовать `extractApiErrorMessage` (уже применяется в `createEmployeeStatus`) в catch-блоке `handleSaveEdit`.

### CQ4 — LOW (proposed) — `personnelFields()` типизирован как `any`
`Backend/PersonnelStatus/PersonalRecordFront/entities/employee/model/from-api.ts:28-47`. Единственный общий маппер для трёх экранов без compile-time контракта; `last_name`/`first_name` читаются без null-guard в отличие от остальных полей. Живого падения не найдено — контрактный риск, не подтверждённый баг.

### ARCH1 — HIGH (слияние ТРЁХ независимых находок — см. `finding-resolution.json`) — Django Admin даёт второй путь мутации бизнес-записей мимо сервисного слоя и аудита
Источники: `code-quality-engineer` (`apps/statuses/admin.py`, оценка low) + `architecture-engineer` (`apps/secondments/admin.py` + `apps/statuses/admin.py` как related, оценка medium) + третий, независимый проход `architecture-engineer` (найден при повторной сверке `evidence/`, оценка **high**) — один и тот же причинный дефект, сведено по правилу 2 `finding-resolution.md`, гейтится по самой строгой из трёх — `high`. Три сходящихся независимых прочтения одного и того же дефекта — сильный сигнал, не совпадение.
`EmployeeStatusAdmin` (`apps/statuses/admin.py`) не переопределяет `has_delete_permission` — `EmployeeStatus` (объект инварианта «один активный статус на сотрудника») можно удалить из Admin без прохождения `StatusApplicationService` и без записи в `StatusChangeHistory` (сигнал — только `post_save`). `admin.site.register(SecondmentRequest)` (`apps/secondments/admin.py:4`) без кастомизации даёт прямое редактирование workflow-поля `status`, минуя scope-проверки `SecondmentRequestViewSet.approve/reject/cancel`. `AuditMiddleware` фильтрует только `/api/*` (`apps/audit/middleware.py:35`) — Admin-запросы вообще не аудируются. Проектное правило «Admin = только справочники» задокументировано в vault (`Personnel-Records/Decisions.md`) и раньше проверялось тестом `test_admin_registry_is_exactly_catalogs` в архивном стеке `Backend/VAPS` — в текущем Personnel-Records такого теста нет (grep подтверждает отсутствие), гвард не был воссоздан после переезда.
**Fix:** либо ограничить admin.py регистрациями только справочников (Position/Rank/Role/Permission — легитимны; Employee/EmployeeStatus/StaffUnit/Division/SecondmentRequest — нет) с read-only доступом, либо перенести `test_admin_registry_is_exactly_catalogs` как регрессионный гвард.

### ARCH2 — MEDIUM — переход PLANNED→ACTIVE зависит только от Celery, без чтения-времени восстановления (в отличие от EXPIRED-пути)
`.../apps/statuses/tasks.py:15-39` (`apply_planned_statuses_task`) + `.../apps/statuses/selectors.py`. `CELERY_BROKER_URL='redis://redis:6379/0'` — недоступен на локальном стенде без Docker (уже задокументировано в `Personnel-Records/Known-Issues.md`, инцидент 19.08 — 7 из 14 сотрудников остались без активного статуса). Новое в этой находке: селекторы явно дают read-time видимость просроченному (EXPIRED) статусу («не закрыт задачей — но это надо ПОКАЗЫВАТЬ», докстринг `selectors.py`), а для PLANNED-статуса, срок которого уже настал, — такой же защиты нет: `status_on_date()`/`active_status()` жёстко фильтруют `state=ACTIVE`, поэтому наступивший PLANNED-статус невидим до ручного `ensure_employee_statuses` или запуска Celery.
**Fix:** дать PLANNED-пути ту же read-time видимость, что и EXPIRED-пути, либо синхронный fallback-вызов `apply_planned_statuses()` там, где известно, что Celery недоступен.

### ARCH3 — MEDIUM — bulk-создание статусов не аудируется
`.../apps/operations/api/views.py:1107-1127` (`bulk`-action) возвращает `{'created': N}` без `id` — `AuditMiddleware.target_object_id = response_data.get('id')` (`apps/audit/middleware.py:58-64,116-127`) остаётся `None`, `AuditLog` не создаётся. Реальный, а не гипотетический пробел: действие мутирующее, permission-gated (`status.manage`), с проверкой конфликтов — и полностью невидимо для аудита.
**Fix:** явная запись `AuditLog` на уровне сервиса для bulk-путей, либо расширение middleware под конвенцию `{'ids': [...]}`.

### ARCH4 — LOW — `entities/employee` импортирует из `features/` (нарушение направления FSD)
`Backend/PersonnelStatus/PersonalRecordFront/entities/employee/ui/EmployeeTable.tsx:35` — `import EditStatusDialog from '@/features/employee-status-update/ui/EditStatusDialog'`. Единственный потребитель — `app/employees/page.tsx`. Чисто структурная находка, поведение не сломано.

### INFO — измеренный ruff-baseline: 1518 нарушений, закреплённого конфига нет — **artifact_backed** (заменяет более слабую находку)
`ruff` не был установлен в `.venv`; для аудита установлен и прогнан (`ruff check . --statistics`) — реальный артефакт, не просто чтение. Результат: **1518** нарушений (397 автофиксируемых), топ-категории: `RUF012` mutable-class-default (418), `F811` redefined-while-unused (372), `I001` unsorted-imports (179), `EXE002` (151), `SIM117` (55), `F401` (52), `RUF059` (48), `BLE001` blind-except (40), `S110` try-except-pass (13), `E722` bare-except (3). Конфига `[tool.ruff]` в `pyproject.toml`/`ruff.toml` не найдено — это сырой дефолт ruff, не курируемый проектом гейт.
**Fix:** если ruff задуман как гейт, закрепить `[tool.ruff]` с осознанным набором правил (auto-memory харнесса ссылается на «ruff check (E,F)» для соседнего проекта) — иначе 1518 стилистических находок топят немногие реальные (`BLE001`/`S110`/`E722`).

### CQ5 — LOW, **artifact_backed** — голые `except:` глушат чужие ошибки в JWT-claims и админ-отображении
`apps/common/jwt_serializers.py:56,134`, `apps/common/admin.py:338` — все три `except: pass` (подтверждено прогоном `ruff`, категория `E722`, 3 из 3 нарушений этого типа в проекте — исчерпывающий список, не выборка) глушат ЛЮБОЕ исключение, а не только ожидаемый `AttributeError`/`DoesNotExist`.
**Fix:** сузить до конкретного типа исключения, который каждый guard реально ожидает.

### CQ6 — HIGH (proposed, confidence 0.55) — `complete_expired_statuses` без по-строчной изоляции транзакции
`.../apps/statuses/application/services.py:559-592`. Весь цикл обёрнут ОДНИМ внешним `@transaction.atomic`. Сосед `apply_planned_statuses` (тот же файл, строки 478-557) явно оборачивает КАЖДУЮ запись в свой `with transaction.atomic():` + `try/except ValidationError` — докстринг объясняет почему: «задача ежедневная и массовая, и один сотрудник с противоречивыми данными не должен оставлять без статусов всех остальных». У `complete_expired_statuses` этой защиты нет — `ValidationError` на одном сотруднике откатывает завершение статусов ВСЕМ остальным, обработанным ранее в том же вызове.
**Fix:** дать `complete_expired_statuses` тот же по-строчный `atomic`+`except`, что уже есть у `apply_planned_statuses`.

### CQ7 — MEDIUM (proposed) — Celery-задачи статусов глушат исключение в непрочитанный `{'success': False}`
`.../apps/statuses/tasks.py:50-82`. Оба `@shared_task` оборачивают вызов сервиса в `except Exception: return {'success': False, ...}`; ни `bind=True`, ни `autoretry_for` не заданы; вызываются fire-and-forget через `.delay()` — возврат никто не читает. В связке с CQ6: одна плохая запись может дать Celery-уровня SUCCESS при нуле реально завершённых статусов, без ретрая и без алерта. Это тот же механизм, что и уже задокументированный в vault «Celery-задачи статусов не доезжают на стенде», но про другой случай — не недоступность брокера, а тихий сбой в бою.
**Fix:** дать исключению всплыть (Celery пометит задачу FAILED, видно в мониторинге) или добавить `autoretry_for` + алерт.

**Инвентарь architecture:** `operations ↛ core.models` — чисто (только один импорт `core.api.serializers` внутри функции, не models). `apps/ops/admin.py` — регистраций нет. `documents/reports/notifications/audit` admin.py — регистраций нет. Scalability limit — `not_applicable`, измеренного baseline нет, числа не выдуманы.

---

## 4. Business-process / a11y / i18n (`business-process-analyst`, `accessibility-globalization-engineer`)

### BP1 — MEDIUM — реестр ГВО, фильтр «Мои» — запрещённый паттерн сопоставления по ФИО жив
`Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/gvo/page.tsx:66-73` (`ownerName === user.name`). `Frontend/Status.md` (запись 23.08.2026) прямым текстом называет этот паттерн запрещённым и объясняет им ОТСУТСТВИЕ вкладок «Мои/Все» в реестре ОМ — но тот же паттерн независимо реализован в реестре ГВО с комментарием в коде, признающим компромисс («Без host-логина... владельца определить нечем»). Два сотрудника с одинаковым отображаемым именем перепутают события; смена имени — событие «потеряется» из «Моих».
**Fix:** либо убрать переключатель `scope=mine` из реестра ГВО (как сделано в реестре ОМ), либо завести стабильный идентификатор владельца на бэке.

### BP2 — LOW — `formatMoment` задублирован в 4 файлах вместо канонического хелпера
`app/security-ops/feedback/page.tsx:29-32`, `.../feedback/[feedbackId]/page.tsx:39-42`, `.../analytics/page.tsx:147-150`, `features/ops-reports/report-shared.ts:19-22` — побайтово идентичны и эквивалентны `shared/lib/date.ts:formatIsoDateTime`. Живого расхождения нет сейчас, но будущая правка форматирования (локаль, DST) молча не затронет эти 4 места.

### A11Y1 — LOW — свободный текст без overflow-wrap
Комментарии/фидбэк-текст рендерятся в `<p>` без `break-words`/`overflow-wrap` нигде в дереве `security-ops`. Длинная строка без пробелов может выйти за карточку.

### DRIFT (info, не дефекты) — сверка с аудитом 17.08.2026:
- **Исправлено:** Tailwind v4-only утилиты (`shadow-xs` и т.п.) — 0 упоминаний по всему дереву; мёртвый `styles/globals.css` — файл удалён коммитом `1cc83efe`.
- **Без изменений:** `@tanstack/react-virtual` — установлен, нигде не используется.

---

## 5. UI + a11y, свежий код (`ui-qa-engineer` / `accessibility-globalization-engineer`)

**Хорошая новость:** все Critical-пункты аудита 17.08.2026 (C1 Tailwind-утилиты, C3 error boundaries, C4 permission-error-vs-denial, C5 анонимный доступ `/reports`, C6 гварды на detail-маршрутах — на выборке) подтверждены исправленными по текущему коду, включая C4 — элегантно, единым сегмент-уровневым гейтом (`app/security-ops/layout.tsx`) вместо рекомендованной 22-страничной правки. Новый код с 17.08 (`DailyExpenseBoard`, `day-submission-panel`, `SummaryVersions`, `ExpenseTrafficCard`, `LeadershipStrip`, `PassportPlannedTabs`, ~2100 строк) последовательно держит паттерны здоровой половины: isPending/isError-ветки, `role="alert"`/`role="region"` + aria-label, permission-гварды, защитный парсинг payload, верный `formatIsoDate`.

### UI1–UI7 — LOW (7 отдельных находок, один root cause: `missing-overflow-wrap`→нет, здесь `raw-date-not-formatted`) — сырая ISO-дата вместо `formatIsoDate`
`Frontend/Status.md` заявляет: «сырой ISO... больше не печатается нигде» — это **не полностью верно**. Закрыто в реестре ОМ (`events/page.tsx:325,330` действительно вызывает `formatIsoDate`), но не закрыто в 7 других местах:
1. `app/security-ops/persons/page.tsx` — `businessDate` в JSX напрямую.
2. Место с `verificationDueAt` в пользовательском предложении.
3. Командный центр — «ближайшие мероприятия», `businessDate` напрямую.
4–5. `app/security-ops/analytics/page.tsx` и `.../analytics/operations` — `snapshot.businessDate` в шапке/сводке.
6. Таблица — `row.businessDate` как есть, без форматирования.
7. Пояснение к клэмп-серии — `businessDate` в тексте подписи.
(точные строки — в `raw-findings.json`, записи `RAW-20260823-0001..0007`)
**Fix:** обернуть все 7 в `formatIsoDate`/`formatIsoDateTime` (`shared/lib/date.ts`), как уже сделано в `events/page.tsx`.

### UI8 — LOW — eslint не установлен, `next.config.js` держит `eslint.ignoreDuringBuilds: true`
Подтверждено: `package.json` не содержит `eslint` в `devDependencies`; `next.config.js:10-11` — `ignoreDuringBuilds: true`. Совпадает с находкой аудита 17.08 — статус «без изменений».

**Инвентарь UI/a11y:** выборочно перепроверены `events`, `objects`, `persons`, `events/[id]` — гварды/loading/error/empty состояния корректны у всех четырёх. 10 сайтов `.toISOString()` — все внутренние (не в JSX), утечки в разметку не найдено. react-hook-form: подтверждено, что sprint 4 (18.08) перевёл большинство крупных форм; `CreateSecurityEventDialog` осознанно остаётся на ручном state+zod (как и было в аудите 17.08).

---

## Что дальше (приоритизация)

1. **Немедленно:** S1 (critical) — RBAC/scope на `EmployeeStatusViewSet`.
2. **До следующего релиза:** S2 (independently verified) — permission_classes на `ReportViewSet`; CQ1 (independently verified) — `timezone.localdate()` в `apps/statuses`; A10/A11 (живой `apps/ops`, high) — падение на `need`/`allocatedCount` и дубль расстановки при повторе запроса.
3. **Перепроверить вторым агентом/ручным чтением, затем чинить или осознанно принять:** S3 (`DivisionViewSet`), S4 (`core.EmployeeViewSet`), CQ6 (`complete_expired_statuses` без по-строчной изоляции) — три high по заявке одного агента.
4. **Процессное:** CQ2 — подключить pytest+ruff к CI (закреплённый `[tool.ruff]`-конфиг, не сырой дефолт — иначе 1518 находок топят реальные), иначе следующий регресс подобного рода тоже проскочит незамеченным.
5. **Есть время — почистить:** ARCH1 (Admin-гвард, эскалирован до high тремя источниками), A6 (история перевода при 403), ARCH3 (аудит bulk), CQ7 (Celery глушит исключение), UI1–UI7 (сырые даты), A12-A15 (остальной хвост `apps/ops`), CQ5 (голые `except:`), остальной low/medium хвост по вкусу.

Известные ограничения этого прогона — см. `executive-summary.md` §«Что покрыто, что нет» и §«Инцидент оркестрации».
