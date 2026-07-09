---
baseline_commit: |
  98ad0e0 (feat(story-6.9)) на ветке claude/exciting-vaughan-3e478b; идёт ПОСЛЕ 6.10a
  (HTTP-выпуск/чтение расхода) — переиспользует её view/scope-паттерн. Проставить SHA 6.10a при dev.
split: |
  6.10 разбита Bratan (2026-07-09) на 6.10a (HTTP-выпуск + чтение по дате/периоду) и
  6.10b (эта — блокировка «на завтра»). 6.10b завершает Epic 6.
context:
  - _bmad-output/planning-artifacts/epics.md (§Story 6.10 стр. 891-900, AC-2 «заблокированное завтра → 422 со списком отстающих»; блокквота Bratan L900 — ВСЯ HTTP-«на завтра» здесь: код TOMORROW_BLOCKED в реестр, 422+{laggards}, POST override-эндпоинт (override_tomorrow_block кидает ValueError→маппинг), date-валидация business_date блока/override (деферы 5.6a/5.6b), фильтр протухших required-id в laggards; FR-18 стр. 51 «расход на завтра блокируется до сдачи всех необходимых; за прошедшие даты — всегда»; 5.6 стр. 737-749; 5.9 стр. 788 аудит TOMORROW_BLOCK_OVERRIDDEN — НЕ тут)
  - _bmad-output/planning-artifacts/architecture.md (Layer Contract :445-454 view→сервис, scope в сервисе→403 :452; §Format :433-435 422=бизнес-hard + DomainError+единый handler; API POST /{id}/<verb>/ :410-412; RBAC ARCH-SEC-031 :318 только PermissionService; RBAC-матрица «новый endpoint без строки не проходит ревью» :634; молчание=СТОП :33-34,:400; Admin :469 MUST NOT регать override)
  - Backend/VAPS/apps/operations/submissions/tomorrow_block.py:51 (tomorrow_block(business_date)→TomorrowBlock{blocked, laggards:[str], overridden}; laggards=required без current-сдачи, str-sorted :65; активный override→blocked=False,overridden=True,laggards видимы :66; docstring :7-8,:20 «HTTP-422 TOMORROW_BLOCKED = 5.8/6.10»; НЕ экспортирован из services/__init__ — импорт из модуля)
  - Backend/VAPS/apps/operations/submissions/services/block_override.py:28 (override_tomorrow_block(business_date, actor, reason) — пишет TomorrowBlockOverride, аудит TOMORROW_BLOCK_OVERRIDDEN, кидает ValueError на плохой вход/дубль; экспортирован из services/__init__; docstring :38 «override-API = 6.10»)
  - Backend/VAPS/apps/operations/submissions/api/views.py (RequirePermissionMixin + ensure_division_scope — реюз паттерна; POST custom-action прецедент DailySubmissionViewSet.amend) ; 6.10a ExpenseReportViewSet (issue/read) — 6.10b добавляет «на завтра»-ветку/override-роут
  - Backend/VAPS/apps/core/clock.py (Clock.today_local()/override — «завтра» = today+1; FR-18: блок ТОЛЬКО для будущего, прошедшие всегда)
  - docs/registries/error-codes.yaml (TOMORROW_BLOCKED — НЕТ, добавить 422 business_hard + details {laggards}; growth_rule :21) ; audit-events.yaml:104 (TOMORROW_BLOCK_OVERRIDDEN уже есть — эмитит block_override 5.6b/аудит 5.9, 6.10b новых событий НЕ добавляет) ; seed_operations.py (daily_report.generate есть; daily_report.override_block — НЕТ, добавить + RBAC-матрица 2.9)
---

# Story 6.10b: Блокировка «на завтра» — HTTP и override

Status: review

## Story

As a **руководство**,
I want **HTTP-поверхность блокировки расхода «на завтра»: запрос расхода на завтра при незакрытых required-управлениях → 422 `TOMORROW_BLOCKED` со списком отстающих (`laggards`), и POST-эндпоинт легального обхода (гейт `daily_report.override_block`, поверх готового `override_tomorrow_block`), с валидацией business_date и фильтром протухших required-id**,
so that **FR-18 закрыт по HTTP (завтра блокируется до сдачи всех необходимых; прошедшие даты — всегда), поверх derive-сервисов 5.6a/5.6b без переизобретения; выпуск/чтение расхода — 6.10a; аудит override — 5.9**.

## Acceptance Criteria

1. **Запрос расхода на завтра при блоке → 422 `TOMORROW_BLOCKED` + laggards.** Given `business_date` в будущем (завтра) и НЕ все required-управления сдали, When запрашиваю выпуск/расход на эту дату (ветка выпуска 6.10a), Then 422 `TOMORROW_BLOCKED` (НОВЫЙ код) с `details.laggards=[division_id]`, полученными из `tomorrow_block(business_date).laggards`; документ НЕ формируется. `TOMORROW_BLOCKED` — `overridable:false` (легальный обход = отдельный эндпоинт/сущность 5.6b, НЕ DRF override:true).

2. **Прошедшие/сегодня даты — не блокируются.** Given `business_date` в прошлом или сегодня, Then блок НЕ применяется (FR-18 «за прошедшие даты — всегда»); проверка `tomorrow_block` вызывается только когда дата в будущем.

3. **POST override-эндпоинт.** Given `POST /api/operations/expense-reports/override-tomorrow-block/` (или action) с `{business_date, reason}` и правом `daily_report.override_block`, When вызываю, Then сервис `override_tomorrow_block(business_date, actor, reason)` пишет `TomorrowBlockOverride`; после активного override `tomorrow_block(date).blocked=False` → выпуск на завтра проходит (laggards остаются видимы записью). `ValueError` из сервиса (плохой вход/дубль/пустая причина) маппится на 400 `VALIDATION_ERROR` (или 409 при дубле — Д2). Scope-проверка в сервисе (PermissionService→403).

4. **Date-валидация business_date (дефер 5.6a/5.6b).** Given `business_date` для блок-проверки/override, Then валидируется: непустой, парсится, и для override — это действительно «завтра»/будущая легальная дата (не прошлое — обходить нечего; не абсурдно далёкое — Д3). Невалидно → 400 `VALIDATION_ERROR`.

5. **Фильтр протухших required-id в laggards (дефер 5.6a).** Given `required_division_ids` содержит id несуществующего/неактивного подразделения (протухший), Then он ОТФИЛЬТРОВАН из отдаваемого `laggards` (через `CoreDivisionTreeSelector`/existence-проба; Д4 — ЛИБО делегировать admin 2.3/2.8 и задокументировать). Отдаём только валидные отстающие.

6. **Реестры, RBAC, границы, гейт.** `TOMORROW_BLOCKED` (422) в `error-codes.yaml` тем же PR (молчание=СТОП). Новый permission `daily_report.override_block` в `seed_operations` (роли ORGD/OMD, как generate) + строка в RBAC-матрице 2.9 для override-роута (`test_rbac_matrix` зелёный). Аудит-события НЕ добавляются (`TOMORROW_BLOCK_OVERRIDDEN` уже эмитит 5.6b/5.9). Модели НЕ регать в Admin. Scope в сервисе; `serializer.create/update` НЕ использовать. `make gate` зелёный; `makemigrations --check` чист (моделей 6.10b НЕ добавляет — `TomorrowBlockOverride` создан в 5.6b); ruff чист; арх-гвард цел.

## Tasks / Subtasks

- [x] Task 1: TOMORROW_BLOCKED на ветке выпуска на завтра (AC: 1, 2)
  - [x] В сервис-обёртке выпуска (6.10a `issue_expense_document`-путь): ЕСЛИ `business_date > Clock.today_local()` → вызвать `tomorrow_block(business_date)`; если `blocked` → `DomainError("TOMORROW_BLOCKED", 422, details={"laggards": [...]})`. Прошлое/сегодня — блок не зовём (AC-2).
  - [x] `tomorrow_block` импортировать из `apps.operations.submissions.tomorrow_block` (НЕ из services/__init__ — не экспортирован).
- [x] Task 2: POST override-эндпоинт (AC: 3, 4)
  - [x] View: `POST` action с `RequirePermissionMixin("daily_report.override_block")`; сериализатор входа форма (`business_date: date`, `reason: str` непустой); вызывает `override_tomorrow_block(business_date=…, actor=request.actor_id, reason=…)`; `ValueError`→маппинг (Д2: 400 VALIDATION_ERROR / 409 дубль). Scope в сервисе.
  - [x] Date-валидация business_date (AC-4): непусто/парсится/будущее-легальное; иначе 400.
- [x] Task 3: Фильтр протухших laggards (AC: 5)
  - [x] При отдаче `laggards` — отфильтровать несуществующие/неактивные division_id (existence через `CoreDivisionTreeSelector`/core-селектор; Д4). ЛИБО задокументировать делегирование admin 2.3/2.8 и оставить как есть.
- [x] Task 4: Реестр + RBAC (AC: 6)
  - [x] `error-codes.yaml`: +`TOMORROW_BLOCKED` (422, business_hard, overridable:false, «Расход на завтра заблокирован — не все необходимые управления сдали», details.laggards).
  - [x] `seed_operations.py`: +`daily_report.override_block` (описание, роли ORGD/OMD); RBAC-матрица 2.9 строка для override-роута; `test_rbac_matrix`/`test_seed` зелёные.
- [x] Task 5: Тесты + гейт (AC: 1-6)
  - [x] django_db: выпуск-на-завтра при незакрытых required → 422 TOMORROW_BLOCKED + laggards; все сдали → проходит; прошлое/сегодня → блок не применяется; override с правом → снимает блок (выпуск проходит), запись TomorrowBlockOverride; override без права → 403; чужой scope → 403; ValueError (пустая причина/дубль) → 400/409; протухший required-id отфильтрован из laggards; date-валидация (пусто/прошлое) → 400. Посев Organization/Division/Employee + `SubmissionControlSettings.required_division_ids` + сдачи (реюз submit_day); `clock.override` для «завтра»; RBAC через `UserRole`/`seed_operations`.
  - [x] `make gate` зелёный; `makemigrations --check` чист; ruff чист (точечный format).

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): derive-блок и override УЖЕ готовы — 6.10b только HTTP

`tomorrow_block()` (5.6a) и `override_tomorrow_block()` (5.6b) реализованы и оба ЯВНО деферят HTTP на 6.10 (docstrings `tomorrow_block.py:7-8`, `block_override.py:38`). **6.10b НЕ пишет derive-логику блока/override** — надевает 422+laggards на выпуск-на-завтра и POST-роут на override. `tomorrow_block` возвращает домен `{blocked, laggards, overridden}`; view/сервис-обёртка маппит на HTTP.

### ⚠️ Ловушка №2: TOMORROW_BLOCKED = overridable:false; обход — отдельная сущность, НЕ DRF override

Легальный обход блока — это `TomorrowBlockOverride` (5.6b) через отдельный POST-эндпоинт с СВОИМ правом, а НЕ `override:true` в теле мутации (то — soft-conflict-паттерн статусов 3.5). Поэтому `TOMORROW_BLOCKED` в реестре — `overridable:false`. Не путать два механизма override.

### ⚠️ Ловушка №3: блок ТОЛЬКО для будущего (FR-18)

«Расход на завтра блокируется … за прошедшие даты — всегда» (FR-18, `epics.md:51`). Вызывать `tomorrow_block` и поднимать 422 ТОЛЬКО когда `business_date > Clock.today_local()`. Прошлое/сегодня — выпуск идёт без блок-проверки (guards 6.10a: нет-сдачи 409 и т.д. — да, но не TOMORROW_BLOCKED).

### ⚠️ Ловушка №4: аудит override — НЕ здесь (5.9), событие уже эмитится

`override_tomorrow_block` (5.6b) уже пишет аудит `TOMORROW_BLOCK_OVERRIDDEN` (реестр `audit-events.yaml:104`, владелец 5.9). 6.10b НЕ добавляет и НЕ дублирует аудит-событие — только вызывает сервис. `test_audit_coverage` зелёный без правок реестра аудита.

### ⚠️ Ловушка №5: laggards — str-sorted division_id; фильтр протухших — новый (дефер 5.6a)

`tomorrow_block.laggards` = required division_id без current-сдачи, str-sorted (`tomorrow_block.py:65`). Дефер 5.6a — протухшие required-id (несуществующее/неактивное подразделение в конфиге) — 6.10b точка добора: отфильтровать перед отдачей (Д4) ИЛИ делегировать admin-гигиене 2.3/2.8 (задокументировать выбор).

### Дефолты (#YOLO)

- **Д1 (mount/форма эндпоинта):** override как action на `ExpenseReportViewSet` (6.10a) `POST .../override-tomorrow-block/` (канон POST /{resource}/<verb>/). Альт: отдельный ViewSet.
- **Д2 (ValueError-маппинг):** пустая причина/плохой вход→400 `VALIDATION_ERROR`; дубль активного override→409 (существующий конфликт-код или новый — свериться с реестром; если нужен новый — молчание=СТОП). Уточнить, что именно кидает `override_tomorrow_block` (прочитать 5.6b).
- **Д3 (date-валидация):** override только для будущей даты (прошлое обходить нечего→400); верхняя граница разумная (напр. ≤ горизонт+31д).
- **Д4 (протухшие laggards):** фильтровать в 6.10b через core-селектор existence [дефолт] vs делегировать admin 2.3/2.8.
- **Д5 (override permission роли):** `daily_report.override_block` держат ORGD/OMD (как `generate`). Подтвердить у Bratan, кто вправе обходить блок.

### Границы (что 6.10b НЕ делает)

- **Выпуск/чтение расхода за дату/период, date-before-data (REPORT_NO_DATA_FOR_DATE) → 6.10a.**
- **Derive-блок `tomorrow_block` (5.6a) + модель/сервис override (5.6b)** — готовы, реюз.
- **Аудит `TOMORROW_BLOCK_OVERRIDDEN` → 5.9** (эмитится в 5.6b, не дублировать).
- **Скачивание файла → 6.7; фронт → E10.**
- **Новых моделей/миграций нет** (`TomorrowBlockOverride` из 5.6b).

### References

- [Source: epics.md стр. 891-900 (AC-2 + блокквота Bratan L900 — вся HTTP-«на завтра»); FR-18 стр. 51; 5.6a/5.6b стр. 747-749; 5.9 стр. 788 (аудит)]
- [Source: architecture.md :445-454 Layer Contract/scope-в-сервисе; :433-435 §Format/DomainError; :410-412 POST-verb; :318 ARCH-SEC-031; :634 RBAC-матрица «endpoint без строки не проходит»; :469 Admin; :33-34,:400 молчание=СТОП]
- [Source: Backend/VAPS/apps/operations/submissions/tomorrow_block.py:7,20,51,65,66 (tomorrow_block/laggards/override-consult); services/block_override.py:28,38 (override_tomorrow_block/ValueError)]
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py (RequirePermissionMixin/ensure_division_scope/amend-action прецедент); apps/core/clock.py (today_local/override)]
- [Source: docs/registries/error-codes.yaml (+TOMORROW_BLOCKED); audit-events.yaml:104 (TOMORROW_BLOCK_OVERRIDDEN уже есть); seed_operations.py (+daily_report.override_block)]

### Открытые вопросы (для Bratan — дефолты активны)

- **Q1 (ValueError-маппинг Д2):** какой код на дубль активного override — 409 существующий или новый? (прочитать точное поведение `override_tomorrow_block` в 5.6b).
- **Q2 (протухшие laggards Д4):** фильтровать в 6.10b или делегировать admin 2.3/2.8?
- **Q3 (override-роли Д5):** `daily_report.override_block` держат ORGD/OMD — верно, или иной набор?

### Процессный гейт

- Зависит от 6.10a (view/scope-паттерн, ExpenseReportViewSet) — dev 6.10b ПОСЛЕ 6.10a; проставить baseline-SHA 6.10a.
- ⚠️ Вводит новый permission + новый error-код + бизнес-гейт — ревьюить внимательно (cross-model). Fresh-context валидация спеки после написания.
- `make gate` из `Backend/VAPS` (Postgres :5433).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + fresh-context валидация + dev-story (TDD)

### Debug Log References

- **make gate зелёный:** 2189 passed (+18 к 6.10a: 9 tomorrow-тестов + параметризованные RBAC/audit/seed по новому роуту+праву), 56 deselected, `makemigrations --check` «No changes detected» (TomorrowBlockOverride мигрирован в 5.6b — новой миграции НЕТ), schema-drift ок (регенерирован), ruff чист, 50s.
- Fresh-валидация применена: C1 `DomainError(detail=…)` (singular; на проводе `details`); C2 `[str(d) for d in laggards]` (UUID→JSON); C3/матрицы (RBAC `_Gate` + AUDIT `_Audited` для override-роута); E1 блок-проверка = wrapper ПЕРЕД issue (сервис хука не имеет), только future; E3 все ValueError override → 400 (дубль и bad-input не различимы по типу).

### Completion Notes List

- **Task 1 (TOMORROW_BLOCKED на выпуске-на-завтра) — DONE.** `tomorrow_gate.assert_tomorrow_not_blocked(business_date, today)` (новый сервис): только `business_date>today` (FR-18 прошлое/сегодня не блокируем) → `tomorrow_block` (5.6a) → при blocked: фильтр протухших id (`CoreDivisionTreeSelector.divisions_map`) + `str()`-коэрция laggards → `DomainError("TOMORROW_BLOCKED",422,detail={"laggards":[...]})`. Вшито в `ExpenseReportViewSet.create` ПОСЛЕ scope, ПЕРЕД date-before-data/issue.
- **Task 2 (POST override-эндпоинт) — DONE.** `@action override_block` (url `override-tomorrow-block`, гейт `daily_report.override_block`): `TomorrowBlockOverrideSerializer` → date-валидация (не-future → 400) → `override_tomorrow_block` (5.6b) → все `ValueError`→400 VALIDATION_ERROR (E3) → 201. Scope не применяется (обход уровня дня, без division).
- **Task 3 (фильтр протухших laggards) — DONE.** В `assert_tomorrow_not_blocked` через `divisions_map` (несуществующие id выпадают). Тест `test_stale_laggard_is_filtered_out`.
- **Task 4 (реестр + RBAC) — DONE.** `TOMORROW_BLOCKED` (422 business_hard) в error-codes.yaml; `daily_report.override_block` в seed_operations (ORGD+OMD) + строки RBAC-матрицы (`_Gate`) и AUDIT-матрицы (`_Audited`); `test_seed` обновлён (OMD 7→8). Аудит `TOMORROW_BLOCK_OVERRIDDEN` НЕ дублируется (эмитит 5.6b/5.9).
- **Task 5 (тесты + гейт) — DONE.** 9 тестов (`test_tomorrow_block_api.py`): blocked→422+laggards, все-сдали→не-блок(201), прошлое→не-блок(409), протухший-id→отфильтрован, override снимает блок, override без права→403, override прошлое→400, дубль→400, пустая причина→400. `clock.override` для детерминизма «завтра». Гейт зелёный.
- **Границы:** derive-блок/override-модель (5.6) — реюз; аудит=5.9; выпуск/чтение/период=6.10a; фронт=E10. Новых моделей/миграций нет.
- **Q1/Q2/Q3 (дефолты активны):** дубль→400 [Д2]; фильтр в 6.10b [Д4]; override-роли ORGD/OMD [Д5]. ⚠️ ревью cross-model (новый permission + error-код + бизнес-гейт).

### File List

- `Backend/VAPS/apps/operations/submissions/services/tomorrow_gate.py` (создан — assert_tomorrow_not_blocked)
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` (изменён — +экспорт)
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (изменён — +TomorrowBlockOverrideSerializer)
- `Backend/VAPS/apps/operations/submissions/api/views.py` (изменён — block-check в create + override_block action)
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (изменён — +daily_report.override_block + ORGD/OMD)
- `Backend/VAPS/apps/operations/submissions/tests/test_tomorrow_block_api.py` (создан — 9 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (изменён — +override-строка)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (изменён — +override _Audited)
- `Backend/VAPS/apps/operations/tests/test_seed.py` (изменён — OMD 7→8 + override_block)
- `docs/registries/error-codes.yaml` (изменён — +TOMORROW_BLOCKED)
- `Backend/VAPS/schema.yaml` (регенерирован — override-эндпоинт)
