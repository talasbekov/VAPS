---
baseline_commit: d0d4af6c33ab4b3de4f15d40a52d640fc7a5c14c
---
# Story 5.8b: API amend сдачи (`POST /api/operations/daily-submissions/{id}/amend/`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления (держатель `daily_report.correct`)**,
I want **`POST /api/operations/daily-submissions/{id}/amend/` — HTTP-эндпоинт ручной пересдачи дня, гейченный правом и скоупом подразделения**,
so that **amendment-flow (FR-DS, сервис `amend_day` 5.4a) доступен по паттернам API проекта — с 403 на чужое подразделение, §36-конвертом и БЕЗ поломки системного пути (хук 5.4b)**.

> **Место в сплите 5.8** (реш. Bratan 2026-07-02): 5.8a (POST сдача, DONE d0d4af6) → **5.8b (POST /{id}/amend/)** → 5.8c (GET история/детали). 5.8b реюзит api-скелет и сервис-гард 5.8a; создаёт прецедент custom `@action` на новом each-канонном ViewSet. TOMORROW_BLOCKED/override-API → 6.10 (вне сплита).

> **Решения create-story (зафиксированы в epics-ноте 2026-07-02):**
> - **amend-право = реюз `daily_report.correct`** — УЖЕ посеян (seed_operations.py:18, DIVISION_OPERATOR :60-63 держит ОБА кода, ADMIN `*`); seed НЕ меняется.
> - **input = `{reason, sanction}`**, `triggered_by_status_id` в API НЕ принимается (ручной amendment = None; системный путь с этим полем — хук 5.4b, не HTTP).
> - **⚠️ Хук 5.4b (`enforce_amendment_on_retro_edit` → `amend_day`) обязан остаться БЕЗ гейта** — гейт на API-пути, НЕ внутри `amend_day` (зеркало Д1 5.8a).

## Acceptance Criteria

1. **Endpoint смонтирован, POST-only, urls.py НЕ трогается.** **Given** запущенный API, **When** `POST /api/operations/daily-submissions/{id}/amend/`, **Then** роут обслуживается (custom `@action(detail=True, methods=["post"])` на `DailySubmissionViewSet` → route `ops-daily-submission-amend` генерится router'ом автоматически — регистрация 5.8a уже есть); **When** GET/PUT/PATCH/DELETE на amend-URL (authed И anon), **Then** `405`; **When** `GET /{id}/` (detail), **Then** `404` — retrieve-роута НЕТ вовсе (приедет 5.8c), это НЕ 405-кейс.

2. **Гейт права (coarse, view).** **Given** аноним, **Then** `403 PERMISSION_DENIED`; **Given** actor без `daily_report.correct` (например VIEWER — держит `status.view`, НЕ correct), **Then** `403`; **Given** держатель (DIVISION_OPERATOR, ADMIN `*`), **Then** гейт пройден. Механизм: та же `permission_map` ViewSet'а пополняется `{"amend": "daily_report.correct"}` (ключ = имя action; mixin fail-closed на отсутствие ключа — БЕЗ ключа amend был бы 403 всем).

3. **Scope: чужое подразделение → 403.** **Given** actor с ролью, скоупленной на дивизион A, **When** amend сдачи дивизиона B вне поддерева A (резолв по `{id}`), **Then** `403 PERMISSION_DENIED` + `details={"division_id"}`; **When** amend сдачи A или потомка A, **Then** проходит; **Given** глобальная роль/ADMIN, **Then** любой дивизион. Механизм: РЕЮЗ `ensure_division_scope(actor, "daily_report.correct", submission.division_id)` (закалён ревью 5.8a: falsy → ValueError, str → UUID-нормализация; `division_id` из БД — уже UUID). Порядок в action: validate form → resolve pk → scope → `amend_day`.

4. **Валидация формы (400) + игнор системных полей.** **Given** payload без `reason` / без `sanction` / с пустыми или пробельными значениями (DRF `trim_whitespace` дефолтно превращает `"   "` → `""` → `allow_blank=False` отбивает), **Then** `400 VALIDATION_ERROR` через input-сериализатор. **And** `sanction` длиннее 255 → `400` (сериализатор ОБЯЗАН `max_length=255` — модельное поле `CharField(255)`; без лимита длинная санкция = DataError → 500, тот же класс бага, что whitespace-500 из ревью 5.8a). **And** `submitted_by`/`actor`/`triggered_by_status_id` в payload игнорируются: identity — ТОЛЬКО `request.actor_id` (ARCH-SEC-030), `triggered_by_status_id` созданной версии = `None` (проверить в БД).

5. **Доменные коды как есть (thin view).** **Given** несуществующий `{id}`, **Then** `404 ENTITY_NOT_FOUND` (резолв через НОВЫЙ селектор `DailySubmissionSelector.by_id` → None → `DomainError`); **Given** race конкурентных amendment, **Then** `409 DAY_ALREADY_SUBMITTED` — backstop УЖЕ замаплен (`CONSTRAINT_ERROR_MAP`), через API НЕ тестируется (гонка доказана на сервис-уровне 5.4a). Ответ — §36-конверт. ⚠️ **`NO_SUBMISSION_TO_AMEND` (422) через этот эндпоинт НЕДОСТИЖИМ**: существующий pk ⇒ цепь версий существует ⇒ `latest_for` непуст. Код остаётся сервис-уровневым; вакуумный API-тест на 422 НЕ писать (урок 5.7c). Новые коды в реестр НЕ добавляются.

6. **201 + та же 9-полевая проекция, chain-семантика.** **Given** валидный amend сданного дня, **Then** `201` с РЕЮЗОМ `DailySubmissionSerializer` (ровно 9 полей 5.8a — БЕЗ snapshot и БЕЗ reason/sanction/triggered_by_status_id: echo клиенту не нужен, детальная проекция — решение 5.8c): `version == prev+1`, `event == AMENDED`, `is_current is True`, `late is False` (Решение №5 из 5.4a), `submitted_by == actor_id`. **And** amend по pk СТАРОЙ версии (не is_current) амендит ТУ ЖЕ цепь (`amend_day` сам берёт `latest_for`) → `201` с `version == head+1` — chain-семантика запинена тестом.

7. **RBAC- и AUDIT-матрицы зелёные (2 строки — урок 5.8a).** **Then** `MATRIX["ops-daily-submission-amend"] = _MethodGate({"post": "daily_report.correct"})` + `AUDIT_MATRIX["ops-daily-submission-amend"] = _DeferredAudit("аудит amendment (DAILY_SUBMISSION_AMENDED) — стори 5.9")` (yaml-ссылка `docs/registries/audit-events.yaml` — в комментарии над строкой, конвенция файла; правка ревью 5.8b); `test_matrix_covers_every_registered_route` и `test_method_gates_cover_exactly_served_methods` зелёные (served у amend-роута = ровно `{post}`); поведенчески — канон матрицы (`pk=0` у держателя: payloadless POST → `400` формы = ALLOW — форма валидируется ДО pk-резолва по порядку AC-3; правка ревью 5.8b — раньше тут стояло «404», противореча AC-3).

8. **Гейт.** **Then** `make gate` зелёный (база 1701); `ruff format` per-file + `ruff check` (E,F) чисты; `makemigrations --check` пуст (миграций НЕТ); 32 теста 5.4a/5.4b (`test_amendment_service.py` + `test_amendment_enforcement.py`) и 25 тестов 5.8a НЕ тронуты и зелёные.

## Tasks / Subtasks

- [x] **Task 1 — Селектор by_id** (AC: 5)
  - [x] `DailySubmissionSelector.by_id(submission_id)` → `DailySubmission | None` (`filter(pk=...).first()`), docstring: канал pk-резолва для API (5.8b amend; реюз 5.8c detail). Канон L442-452: view читает ТОЛЬКО через селектор (НЕ копировать `UserRole.objects...first()` из UserRoleViewSet.destroy — старый паттерн).
- [x] **Task 2 — Input-сериализатор** (AC: 4)
  - [x] `DailySubmissionAmendSerializer(serializers.Serializer)`: `reason = serializers.CharField()` (TextField в модели — без max_length), `sanction = serializers.CharField(max_length=255)` (модель CharField(255) — иначе 500-класс). DRF-дефолты уже дают trim + `allow_blank=False`.
  - [x] Docstring: `triggered_by_status_id` НЕ принимается (системное поле хука 5.4b); лишние поля payload игнорируются (DRF-канон 5.8a Д5).
- [x] **Task 3 — @action amend во ViewSet** (AC: 1, 2, 3, 5, 6)
  - [x] `_AMEND_PERMISSION = "daily_report.correct"` рядом с `_SUBMIT_PERMISSION` (единый источник — ревью-паттерн 5.8a); `permission_map = {"create": _SUBMIT_PERMISSION, "amend": _AMEND_PERMISSION}`.
  - [x] `@action(detail=True, methods=["post"])` `def amend(self, request, pk=None)`: form.is_valid(raise_exception=True) → `by_id(pk)` → None → `DomainError("ENTITY_NOT_FOUND", 404, detail={"submission_id": str(pk)})` → `ensure_division_scope(request.actor_id, _AMEND_PERMISSION, submission.division_id)` → `amend_day(division_id=submission.division_id, business_date=submission.business_date, actor=request.actor_id, reason=..., sanction=...)` → `Response(DailySubmissionSerializer(new).data, 201)`.
  - [x] ⚠️ БЕЗ try/except и ручного error-Response (unified handler); `triggered_by_status_id` НЕ прокидывать (kwarg остаётся None); `http_method_names` уже `["post", "options"]` — не трогать.
- [x] **Task 4 — Строки матриц** (AC: 7)
  - [x] `test_rbac_matrix.py`: `MATRIX["ops-daily-submission-amend"] = _MethodGate({"post": "daily_report.correct"})` + комментарий (amend сдачи, scope в сервис-гарде).
  - [x] `test_audit_coverage.py`: `AUDIT_MATRIX["ops-daily-submission-amend"] = _DeferredAudit(...)` — каждый write-роут = 2 реестровые строки (урок 5.8a).
- [x] **Task 5 — Тесты API-контракта** (AC: 1–7)
  - [x] Создать `apps/operations/submissions/tests/test_daily_submission_amend_api.py` — СВОИ копии фикстур 5.8a (`frozen_clock`/`tree`/`scoped_op`/`global_op`/`_client`; вынос в conftest.py — отдельная гигиена, здесь НЕ делать) + helper `_submitted(division)` (сдача через `submit_day` сервисом — быстрее и не зависит от API 5.8a) и `_amend(actor, pk, extra=None)`.
  - [x] Кейсы: 201 happy (9 полей, version=2, event=AMENDED, late=False, submitted_by=actor) · amend по pk старой версии → 201 v3 (chain) · GET/PUT/PATCH/DELETE amend-URL → 405 (authed И anon, параметризовано) · GET /{id}/ → 404 (роута нет) · anon POST → 403 · VIEWER (без correct) → 403 · чужой дивизион (scoped) → 403 + details · своё поддерево → 201 · own-division root → 201 · global → 201 · 400×4+ (reason/sanction missing/blank/"   "/sanction 256) · payload `submitted_by`/`triggered_by_status_id` игнорируются (в БД None) · несуществующий pk → 404 + §36-конверт.
  - [x] НЕ перетестировать домен: re-snapshot/flip/lock/409-гонка — доказано 5.4a (32 теста); 422 — недостижим (AC-5), вакуумный тест НЕ писать.
- [x] **Task 6 — Гейт** (AC: 8)
  - [x] `ruff format` по КАЖДОМУ тронутому файлу (per-file, feedback_vaps_ruff_format_scoping), `ruff check` (E,F).
  - [x] `make gate` зелёный; зафиксировать число тестов и время. → **1738 passed (база 1701 + 37), 25 deselected, 27s; makemigrations пуст; ruff чист.**

### Review Findings

Проход 1 (bmad-code-review, Fable 5 ×3 слоя — Blind/Edge/Auditor; **same-model caveat** vs dev Fable 5; scoped-дифф 5.8b vs `d0d4af6`). Acceptance Auditor: 7/8 AC SATISFIED, AC-7 PARTIAL (косметика литерала note). Ловушки №1–4 соблюдены, границы целы. 1 decision · 3 patch · 3 defer · 14 dismiss.

- [x] [Review][Decision] **403 на чужой сдаче раскрывает вычисленный сервером division_id (оракул «pk → подразделение»)** — blind+edge, Med. `ensure_division_scope` кидает 403 с `details={"division_id": <UUID чужого дивизиона>}`; в 5.8a это был echo клиентского инпута, здесь division_id РЕЗОЛВИТСЯ сервером из чужой сдачи. В связке с осознанной pk-энумерацией (404 phantom vs 403 чужой) держатель `daily_report.correct` перебором pk строит карту «pk сдачи → division_id» по всей организации. Спека AC-3 сама предписывает `details={"division_id"}` — вопрос к контракту, не к коду. [views.py:81-83 → scope_gate.py:41-43; закреплено test_daily_submission_amend_api.py:195] → **РЕШЕНО Bratan (2026-07-02), опц. A: trade-off принят** — закрытый контур, division_id не секрет внутри организации, диагностируемость 403 («на какое подразделение не хватило скоупа») дороже сокрытия; осознанность задокументировать в комментарии теста (расширить существующий trade-off-комментарий с pk-энумерации на division_id-в-details) — ушло в патчи.
- [x] [Review][Patch] Тест-гэпы контракта: upward-scope (child-скоуп → root-сдача → 403 — единственный DENY-кейс сейчас несвязанный дивизион), HEAD в 405-параметрайзе, sanction ровно 255 → 201, JSON null/non-dict payload → 400, negative/overflow pk → 404 (сейчас живут на поведении Django, не запинены) [Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_amend_api.py] — ✅ ПРИМЕНЁН: +фикстура child_scoped_op + test_parent_division_403_for_child_scoped, +head в оба 405-параметрайза, +test_sanction_at_model_limit_201, +3 параметра bad_form (null/list/dict) + test_non_dict_payload_400, +test_out_of_range_pk_404 (-1/0/9×30)
- [x] [Review][Patch] `by_id`: `int()` нормализует алиасы pk (`+123`, `" 123 "`, `1_23`, `"١٢٣"`; bool/float у программных вызывателей) → write-эндпоинт отвечает 201 на неканонические URL вопреки контракту docstring «garbage → None»; ужесточить до `re.fullmatch(r"[0-9]+", str(...))` + тест [Backend/VAPS/apps/operations/submissions/selectors.py:33-36] — ✅ ПРИМЕНЁН: fullmatch-гвард канонических ASCII-цифр (docstring дополнен), +test_alias_pk_spellings_404 (`+pk`/`" pk "`/арабские цифры того же pk → 404)
- [x] [Review][Patch] Текст стори AC-7: литерал note `_DeferredAudit` короче предписанного (yaml-ссылка ушла в комментарий — конвенция файла, семантика цела) + парентеза «pk=0 → 404 у держателя = ALLOW» противоречит порядку AC-3 (форма первой → 400 = ALLOW) [_bmad-output/implementation-artifacts/5-8b-api-amend-сдачи.md AC-7] — ✅ ПРИМЕНЁН: AC-7 переписан под фактический литерал + порядок AC-3
- [x] [Review][Patch] (из Decision, опц. A) Trade-off-комментарий в test_foreign_division_403 расширен: server-resolved division_id в 403-details — осознанно принят (закрытый контур, диагностируемость) — ✅ ПРИМЕНЁН

Пост-патч верификация: amend-сьют 28 → **40 тестов**; `make gate` зелёный — **1750 passed** (1738 + 12), 25 deselected, 37s; ruff format/check per-file чисты; makemigrations пуст.
- [x] [Review][Defer] Payload > `DATA_UPLOAD_MAX_MEMORY_SIZE` (дефолт 2.5 МБ) → `RequestDataTooBig` → 500 INTERNAL_ERROR — нет ветки SuspiciousOperation в unified handler; unbounded `reason` делает amend удобной точкой входа, но класс проектный (все POST-эндпоинты) [Backend/VAPS/apps/core/api/exception_handler.py:169-176] — deferred, pre-existing
- [x] [Review][Defer] «Невидимый» unicode (`\u200b`/`\ufeff`/`\u00ad`) проходит trim/allow_blank/`_require_text`/CheckConstraint → AMENDED с визуально пустыми reason/sanction; класс всех текстовых инпутов проекта (5.4a/5.6b) [serializers.py + services/amendment_service.py:44-47] — deferred, pre-existing
- [x] [Review][Defer] Осиротевшая сдача после hard-delete Division: скоуп-роль → 403, глобальная → 404 «Подразделение не найдено» на существующий pk (роль-зависимая семантика, 404 маскирует причину); класс ARCH-003 flat-UUID + живой hard-delete дивизионов [views.py:70-83 + amendment_service.py:86-92] — deferred, pre-existing

## Dev Notes

### Эталоны — всё уже в кодовой базе 5.8a (свежайший канон, коммит d0d4af6)
- **ViewSet-скелет:** `apps/operations/submissions/api/views.py` — mixin ПЕРВЫМ в MRO, константа кода, явный вызов сервиса, 201 без envelope. 5.8b ДОБАВЛЯЕТ action в этот же класс.
- **Сервис-гард:** `apps/operations/submissions/services/scope_gate.py` — реюз как есть (закалён ревью: `not division_id` → ValueError, str→UUID). НЕ менять.
- **Custom action прецедент:** `TemporaryDutyViewSet.expire` (`apps/operations/api/views.py:115-119`) — @action(detail=True, methods=["post"]) и авто-route `ops-temp-duty-expire`. ⚠️ НО он на старом `require_permission()` инлайном — НЕ копировать механизм гейта, только форму @action; гейт 5.8b — mixin+permission_map (канон 2.13/5.8a).
- **Тест-сьют зеркало:** `test_daily_submission_api.py` (25 тестов) — фикстуры, `_client`, канон 405/403/400/404-кейсов уже с уроками ревью 5.8a.

### Сервис ГОТОВ — view остаётся тонкой
`amend_day(*, division_id, business_date, actor, reason, sanction, triggered_by_status_id=None)` (`amendment_service.py:51`) сам даёт: 400 (пустые actor/reason/sanction после strip) / 404 ENTITY_NOT_FOUND (existence дивизиона) / 422 NO_SUBMISSION_TO_AMEND / race → сырой IntegrityError → 409 через handler. Окно дат НЕ применяется (amendment — про прошлые даты; `frozen_clock` в тестах нужен только для `submit_day`-предпосылки). `late=False` всегда. **`amend_day` НЕ меняется вообще.**

### ⚠️ ЛОВУШКА №1 (ГЛАВНАЯ): хук 5.4b — системный путь БЕЗ прав
`enforce_amendment_on_retro_edit` (`amendment_enforcement.py:47`) зовёт `amend_day` внутри транзакции ретро-правки статуса, БЕЗ HTTP-актора и БЕЗ RBAC-сида — гейт внутри `amend_day` сломал бы enforcement 3.9→5.4b и 32 теста. Гейт (право+scope) — ТОЛЬКО на API-пути (view + `ensure_division_scope`). Это зеркало Д1 5.8a, уже подтверждённого Bratan.

### ⚠️ ЛОВУШКА №2: sanction CharField(255) — граница формы обязана её нести
Модель: `reason = TextField`, `sanction = CharField(max_length=255)` (`models/daily_submission.py:89-90`). Сериализатор без `max_length=255` пропустит длинную санкцию до Postgres → DataError → 500 (класс «unbounded input → DB error», родной брат whitespace-500 из ревью 5.8a). Тест на 256 символов обязателен.

### ⚠️ ЛОВУШКА №3: NO_SUBMISSION_TO_AMEND недостижим — не писать вакуумный тест
pk-резолв гарантирует существование цепи (строка есть ⇒ `latest_for` непуст). «Тест на каждый код из спеки эндпоинта» (architecture L437) применяется к ДОСТИЖИМЫМ кодам: 400/403/404/(409-race). Урок 5.7c: вакуумные тесты (проверяют ничего) не пишем; вместо этого — комментарий в тест-файле, почему 422 в контракте отсутствует.

### ⚠️ ЛОВУШКА №4: `triggered_by_status_id` — НЕ API-поле
Это ссылка системного хука на ретро-правку (5.4b). Ручной amendment через HTTP = None. Принимать его из payload = дать клиенту писать произвольные ссылки на EmployeeStatus (ложная провенанс-цепочка). Игнор + тест (в БД None).

### Двойная проверка кода — канон L450 (как 5.8a)
Mixin проверяет `daily_report.correct` глобально (resolver division-free); `ensure_division_scope` — код+scope по поддереву. VIEWER — дискриминатор «есть роль, нет кода»; держатель mark_update-без-correct в seed НЕ существует (DIVISION_OPERATOR держит оба) — не изобретать такого актора.

### Что уже есть (НЕ переизобретать)
- `daily_report.correct` посеян (seed_operations.py:18; DIVISION_OPERATOR :60-63, ADMIN `*`) — seed НЕ трогать.
- Коды: `NO_SUBMISSION_TO_AMEND` (error-codes.yaml:230), `ENTITY_NOT_FOUND`, `DAY_ALREADY_SUBMITTED`, `VALIDATION_ERROR`, `PERMISSION_DENIED` — ВСЕ уже в реестре; реестр НЕ трогать.
- 409-backstop: `unique_daily_submission_current`/`_version` уже в `CONSTRAINT_ERROR_MAP` (exception_handler.py:27-38).
- Роутер: `daily-submissions` зарегистрирован (5.8a) — @action добавляет вложенный URL сам, `urls.py`/`config` НЕ трогаются.
- `DailySubmissionSelector.latest_for/current_for` — есть; НЕТ только `by_id` (Task 1).

### Дефолты (Д1, Д2 — подтверждены Bratan на create-story 2026-07-02)
- **Д1 (ГЛАВНЫЙ, chain-семантика):** `{id}` идентифицирует сдачу, amendment применяется к её цепи `(division_id, business_date)` — `is_current` у pk НЕ требуем: `amend_day` сам берёт head через `latest_for` (lock). Ссылка на старую версию не вредит и не создаёт вторую цепь. Альтернатива (409 на не-current pk) отвергнута: усложняет контракт без выигрыша в целостности.
- **Д2:** ответ 201 = реюз 9-полевой `DailySubmissionSerializer` БЕЗ amend-полей (echo не нужен — клиент их прислал; детальная проекция со snapshot/reason/sanction — решение 5.8c).
- **Д3:** `reason` без max_length (модель TextField); `sanction` max_length=255 (модель).
- **Д4:** 404-detail = `{"submission_id": str(pk)}` (зеркало division_id-детали гарда).
- **Д5:** новый тест-файл со СВОИМИ фикстурами (копия ~30 строк из 5.8a); вынос в conftest — отдельная гигиена, не здесь.
- **Д6:** pk-резолв через новый `DailySubmissionSelector.by_id` (канон селекторного чтения; реюз 5.8c).

### Границы (что 5.8b НЕ делает)
НЕ GET list/detail/пагинация (5.8c) · НЕ аудит DAILY_SUBMISSION_AMENDED (5.9) · НЕ TOMORROW_BLOCKED/override (6.10) · НЕ санкция-эскалация (E6 forward-seam) · НЕ трогает `amend_day`/`submit_day`/`enforce_amendment_on_retro_edit`/модель/миграции/seed/реестры · НЕ notify() · НЕ Admin · НЕ conftest-рефактор фикстур · НЕ throttle/OpenAPI.

### Previous Story Intelligence (5.8a, review 2026-07-02 — ПРИМЕНИТЬ СРАЗУ, не патчами)
- **Все 8 AC 5.8a — satisfied; 6 ревью-патчей**, уроки вшиты в AC выше: (1) write-глаголы 405 тестировать authed И anon и ВСЕ (не только GET); (2) own-division root — обязательный кейс; (3) fail-closed контраст (у 5.8b: phantom pk → 404 ЛЮБОМУ держателю — существование сдач по integer-pk перечислимо; это осознанный REST-trade-off, отметить комментарием в тесте); (4) границы инпута = границы модели (Ловушка №2); (5) константа кода — единый источник для map и гарда; (6) каждый write-роут = 2 реестровые строки (RBAC + AUDIT); (7) `ruff format` строго per-file.
- MAJOR-урок ревью: класс «граница пропускает мусор → 500 глубже» — у 5.8a это был whitespace X-User-Id (пофикшен strip'ом в auth, 97fc029), у 5.8b кандидат — sanction>255 (закрыт Ловушкой №2).
- `make gate` база: 1701 passed / 27s (после d0d4af6).

### Git Intelligence
- `d0d4af6` feat 5.8a — весь реюз-скелет этой стори; `97fc029` fix 5.7c-tail — strip X-User-Id (auth-канон теперь: blank actor_id не существует).
- Паттерн коммита: `feat(E5): 5.8b POST /{id}/amend/ — ...` + Co-Authored-By.

### Project Structure Notes
- Создаётся: `apps/operations/submissions/tests/test_daily_submission_amend_api.py`.
- Модифицируются: `submissions/api/views.py` (+action, +константа, +map-ключ), `submissions/api/serializers.py` (+AmendSerializer), `submissions/selectors.py` (+by_id), `operations/tests/test_rbac_matrix.py` (+строка), `audit/tests/test_audit_coverage.py` (+строка).
- Счёт: 1 create + 5 modify — одна ответственность (amend-эндпоинт + его гейты); `urls.py`/`config`/`services/__init__.py` НЕ трогаются (гард уже экспортирован, роут авто).
- Миграций НЕТ.

### References
- [Source: epics.md:769-790 — стори 5.8, декомпозиционная нота 5.8b (реш. Bratan 2026-07-02)]
- [Source: apps/operations/submissions/services/amendment_service.py:51-139 — контракт amend_day (400/404/422/race-409, late=False, окно не применяется)]
- [Source: apps/operations/submissions/amendment_enforcement.py:47-66 — системный вызыватель amend_day (Ловушка №1)]
- [Source: apps/operations/submissions/models/daily_submission.py:85-94 — amend-поля (reason TextField, sanction CharField 255, triggered_by_status_id nullable); :98-138 — констрейнты (409-backstop, chk_amended_requires_reason_sanction)]
- [Source: apps/operations/submissions/api/{views,serializers}.py + services/scope_gate.py — скелет/гард 5.8a (пост-ревью, d0d4af6)]
- [Source: apps/operations/api/views.py:115-119 — @action-прецедент expire (форма, НЕ гейт)]
- [Source: apps/core/api/permissions.py:21-52 — RequirePermissionMixin (fail-closed на отсутствие action в map)]
- [Source: apps/operations/tests/test_rbac_matrix.py:280-292 — test_method_gates_cover_exactly_served_methods; :320-326 — _url_for(pk=0) для detail-роутов]
- [Source: apps/operations/management/commands/seed_operations.py:18,60-63 — daily_report.correct и держатели]
- [Source: docs/registries/error-codes.yaml:230 — NO_SUBMISSION_TO_AMEND (422); все коды стори в реестре]
- [Source: architecture.md L409-411/427/431-437/442-452/463 — URL/envelope/§36/layer-contract/тест-на-код/идемпотентность]
- [Source: _bmad-output/implementation-artifacts/5-8a-api-post-сдачи-дня.md — Review Findings (уроки, применённые в AC)]
- [Source: memory feedback_vaps_ruff_format_scoping, feedback_vaps_arch_guards]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (`claude-fable-5`), bmad-dev-story, 2026-07-02.

### Debug Log References

- RED-прогон: 29 failed (NoReverseMatch на `ops-daily-submission-amend` + красная completeness RBAC-матрицы) — тесты валидны до имплементации.
- GREEN-прогон (6 сьютов: amend + 5.8a + 5.4a/b + обе матрицы): 497 passed, 17s.
- `make gate` финальный: 1738 passed, 25 deselected, 27s; `makemigrations --check` пуст; ruff чист.

### Implementation Plan / Decisions

TDD red→green строго по Tasks: сначала весь API-сьют (28 тестов) + 2 строки матриц (RED), затем селектор → сериализатор → @action (GREEN). Решения сверх буквы стори (в её духе):

1. **`by_id` абсорбирует не-int pk → None → 404.** Router-паттерн pk (`[^/.]+`) пропускает нечисловой мусор; голый `filter(pk="abc")` = ValueError → 500 — тот же класс «граница пропускает мусор → 500 глубже» (MAJOR-урок ревью 5.8a, Ловушка №2 стори). Гвард в селекторе (не во view) — 5.8c detail унаследует. +тест `test_non_integer_pk_404`.
2. **Перефраз docstring сериализатора:** literal «X-User-Id» в docstring завалил `test_x_user_id_literal_only_in_core_auth` (AST-скан строковых констант ВКЛЮЧАЯ docstrings вне core/auth) → «actor header». Урок: упоминание header-имени словом = нарушение ARCH-SEC-030-гварда.
3. Порядок в action: form → by_id → scope → amend_day (AC-3); phantom pk → 404 любому держателю — комментарий-trade-off в тесте (контраст fail-closed 403 5.8a, урок №3).
4. Module-docstring `views.py` обновлён на 5.8a/5.8b (endpoint добавлен в существующий файл — описание «create-only» протухло бы).

### Completion Notes List

- Все 8 AC удовлетворены; все 6 Tasks закрыты. `amend_day`/`submit_day`/хук 5.4b/модель/миграции/seed/реестры/urls.py — НЕ тронуты (границы стори соблюдены; Ловушка №1 цела — гейт только на API-пути).
- Chain-семантика Д1 запинена тестом: amend по pk устаревшей v1 даёт v3 той же цепи, ровно одна is_current.
- 422 NO_SUBMISSION_TO_AMEND не тестируется через endpoint (недостижим: существующий pk ⇒ цепь есть) — объяснение в docstring сьюта (урок 5.7c, вакуумных тестов нет).
- 2 реестровые строки добавлены (RBAC `_MethodGate({"post": "daily_report.correct"})` + AUDIT `_DeferredAudit(DAILY_SUBMISSION_AMENDED → 5.9)`); completeness- и method-гейты матриц зелёные; amend-роут добавил 9 поведенческих кейсов в матрицу.
- Регрессия нулевая: 32 теста 5.4a/5.4b и 25 тестов 5.8a целы; `make gate` 1738 passed (база 1701 + 28 новых + 9 матричных), 27s.
- Артефакты НЕ закоммичены (канон: коммит после code-review).

### File List

- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_amend_api.py` — создан (28 тестов API-контракта amend).
- `Backend/VAPS/apps/operations/submissions/api/views.py` — изменён (+`_AMEND_PERMISSION`, +map-ключ `amend`, +`@action amend`; module-docstring 5.8a→5.8a/5.8b).
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` — изменён (+`DailySubmissionAmendSerializer`).
- `Backend/VAPS/apps/operations/submissions/selectors.py` — изменён (+`DailySubmissionSelector.by_id`).
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` — изменён (+строка `ops-daily-submission-amend`).
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` — изменён (+строка `ops-daily-submission-amend`).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — изменён (статус 5.8b → review, dev-activity-нота).
- `_bmad-output/implementation-artifacts/5-8b-api-amend-сдачи.md` — изменён (чекбоксы, Dev Agent Record, Status).

## Change Log

| Дата | Версия | Изменение | Автор |
|------|--------|-----------|-------|
| 2026-07-02 | 0.1 | Создана стори (bmad-create-story, Fable 5): 5.8b = POST /{id}/amend/ по epics-ноте сплита 5.8; уроки ревью 5.8a вшиты в AC (405-глаголы/own-division/границы инпута/2 реестровые строки); зафиксированы Ловушки №1-4 (хук без гейта, sanction 255, недостижимый 422, triggered_by не из payload) и Д1-Д6 (chain-семантика pk, реюз 9-полевой проекции, by_id-селектор) | Bratan |
| 2026-07-02 | 1.0 | Имплементация (bmad-dev-story, Fable 5, TDD): @action amend + by_id-селектор (с гвардом не-int pk → 404) + AmendSerializer (sanction≤255) + 2 строки матриц + 28 тестов; make gate 1738 passed/27s, регрессия нулевая; Status → review | Bratan |
| 2026-07-02 | 1.1 | Code-review проход 1 (Fable 5 ×3 слоя, same-model caveat): 7/8 AC SATISFIED + AC-7 PARTIAL→исправлен; 1 decision (403-details division_id — принят Bratan опц. A) · 4 patch применены (тест-гэпы +12, by_id fullmatch-гвард, AC-7 текст, trade-off-комментарий) · 3 defer → deferred-work.md · 14 dismiss; make gate 1750 passed/37s; Status → done | Bratan |
