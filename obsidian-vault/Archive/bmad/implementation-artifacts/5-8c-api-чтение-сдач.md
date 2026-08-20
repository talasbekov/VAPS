---
baseline_commit: 6f49ec245bccb3aacd39ad8071f896c90c6d5573
---
# Story 5.8c: API чтение сдач (`GET /api/operations/daily-submissions/` + `GET /{id}/`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления (держатель `daily_report.mark_update`)**,
I want **`GET /api/operations/daily-submissions/` (история сдач, actor-scoped) и `GET /api/operations/daily-submissions/{id}/` (деталь версии)**,
so that **цепочки сдач и их снапшоты читаются по паттернам API проекта — с видимостью строго по поддереву ролей, лёгким list-конвертом и детальной проекцией версии**.

> **Место в сплите 5.8** (реш. Bratan 2026-07-02): 5.8a (POST сдача, DONE d0d4af6) → 5.8b (POST /{id}/amend/, DONE пост-ревью) → **5.8c (GET list + detail)** — ЗАВЕРШАЕТ сплит. TOMORROW_BLOCKED/override-API → 6.10 (вне сплита). List+detail в одной стори — санкционировано epics-нотой (зеркало 4.5 audit read-API: один ViewSet, один гейт-код, один сьют).

> **Решения create-story (зафиксированы в epics-ноте 2026-07-02, epics.md:778,784):**
> - **Чтение = реюз `daily_report.mark_update`** (код `daily_report.view` НЕ заводим; seed НЕ меняется; руководству чтение приедет с деревом 10.4). Держатели: DIVISION_OPERATOR (+ADMIN `*`). ORGD/OMD держат `generate`, НЕ `mark_update` → 403 (дискриминатор чтения).
> - **Новый actor-scoped list-селектор** — канон architecture.md#L451: селектор принимает `actor` ПЕРВЫМ аргументом и САМ сужает видимость; ViewSet по правам не фильтрует.
> - **list БЕЗ snapshot (`defer`)**; отдача snapshot в detail — решение этой стори (Д1 ниже).
> - **LimitOffset 50/200 + ordering с tie-breaker `id`** (architecture.md#L427).

## Acceptance Criteria

1. **Роуты обслуживаются, старые «until 5.8c»-пины переписаны, urls.py НЕ трогается.** **Given** запущенный API, **When** `GET /api/operations/daily-submissions/` и `GET /api/operations/daily-submissions/{id}/`, **Then** роуты обслуживаются (`http_method_names` += `"get"`; `ops-daily-submission-list`/`-detail` генерятся router'ом — регистрация 5.8a уже есть); **When** PUT/PATCH/DELETE на ОБА URL (authed И anon), **Then** `405`; **When** GET/HEAD на amend-URL, **Then** `405` (amend-route остаётся post-only — тесты 5.8b целы). **And** ровно ТРИ старых теста переписаны под новый контракт (они помечены «until 5.8c» и упадут сами): `test_get_is_405` + `test_anonymous_get_is_405` (test_daily_submission_api.py:118-126 — GET collection теперь 200 держателю / 403 анониму) и `test_detail_route_absent_404` (test_daily_submission_amend_api.py:168-175 — GET /{id}/ теперь 200 держателю). Остальные тесты 5.8a/5.8b НЕ трогаются.

2. **Гейт права (coarse, view).** **Given** аноним, **When** GET list или detail, **Then** `403 PERMISSION_DENIED` (с `"get"` в `http_method_names` аноним получает 403 гейта, НЕ 405); **Given** actor без `daily_report.mark_update` (VIEWER — `status.view`; ORGD — `daily_report.generate`), **Then** `403`; **Given** держатель (DIVISION_OPERATOR, ADMIN `*`), **Then** гейт пройден. Механизм: `permission_map` += `{"list": _SUBMIT_PERMISSION, "retrieve": _SUBMIT_PERMISSION}` (реюз константы 5.8a — mixin fail-closed на отсутствие ключа).

3. **Actor-scoped видимость list (канон L451) — вне скоупа строки ОТСУТСТВУЮТ, не 403.** **Given** оператор, скоупленный на дивизион A, **When** GET list, **Then** в выдаче ТОЛЬКО сдачи поддерева A (A и потомки); сдачи вне поддерева отсутствуют молча; **Given** child-скоупленный оператор, **Then** сдачи РОДИТЕЛЯ не видны (upward-гвард — урок ревью 5.8b); **Given** глобальная роль или ADMIN `*`, **Then** видно всё. Механизм: НОВЫЙ `PermissionService.visible_division_ids(user_id, permission_code) -> None | set[UUID]` (`None` = глобальная видимость; единый источник скоуп-правды с `has_permission` — та же резолюция ролей + temp-duty) + НОВЫЙ селектор `DailySubmissionSelector.list(actor, *, division_id=None, business_date=None)` — actor первым, сам зовёт `visible_division_ids` и применяет `division_id__in` (или без сужения при `None`), `.defer("snapshot")`, ordering из AC-4. ViewSet по правам НЕ фильтрует.

4. **List-контракт: конверт, пагинация, ordering, фильтры, лёгкая проекция.** **Then** ответ — конверт `{count, next, previous, results}`; пагинация `DailySubmissionPagination(LimitOffsetPagination)` default 50 / max 200 (копия канона AuditLogPagination/NotificationPagination — общий класс проект сознательно не выделил); ordering `-business_date, -version, id` (tie-breaker `id` ПОСЛЕДНИМ — L427, иначе пагинация молча теряет строки; Meta.ordering у модели НЕТ — задаётся в селекторе); элементы results — 9-полевой `DailySubmissionSerializer` БЕЗ snapshot. **And** опциональные query-фильтры `division_id` (UUIDField) и `business_date` (DateField) через НОВЫЙ `DailySubmissionFilterSerializer` (канон AuditLogFilterSerializer); мусорные значения → `400 VALIDATION_ERROR`; `?division_id=X&business_date=Y` отдаёт ВСЕ версии цепи (историю, включая не-current) — версионная история и есть смысл list.

5. **Detail-контракт: pk-резолв → скоуп → ЗАПРОШЕННАЯ версия.** **Given** несуществующий/мусорный `{id}`, **Then** `404 ENTITY_NOT_FOUND` + `details={"submission_id": str(pk)}` + §36-конверт (РЕЮЗ `DailySubmissionSelector.by_id` — закалён ревью 5.8b: non-int/alias-написания абсорбируются); **Given** сдача чужого поддерева, **Then** `403 PERMISSION_DENIED` + `details={"division_id"}` (РЕЮЗ `ensure_division_scope(actor, _SUBMIT_PERMISSION, submission.division_id)` ПОСЛЕ pk-резолва — порядок и trade-off «phantom pk → 404 любому, 403 несёт server-resolved division_id» ПРИНЯТЫ Bratan на ревью 5.8b, не пересматривать); **Given** pk устаревшей версии (не is_current), **Then** отдаётся ИМЕННО ЭТА версия (⚠️ КОНТРАСТ с amend: там pk идентифицирует цепь и amend_day берёт head; retrieve — точечное чтение строки, `latest_for` НЕ звать). **Then** проекция detail — НОВЫЙ `DailySubmissionDetailSerializer`: 9 полей list-проекции + `snapshot` + `reason` + `sanction` + `triggered_by_status_id` (13 полей; Д1 — detail единственный HTTP-канал снапшота).

6. **Ошибки/реестр: НИЧЕГО нового.** Новые коды в реестр НЕ добавляются (`VALIDATION_ERROR`/`PERMISSION_DENIED`/`ENTITY_NOT_FOUND` — реюз); БЕЗ try/except и ручных error-Response (unified handler); view тонкая — читает ТОЛЬКО через селекторы (канон L442-452).

7. **RBAC-матрица: 1 строка обновлена + 1 новая; AUDIT_MATRIX НЕ трогается.** **Then** `MATRIX["ops-daily-submission-list"]` → `_MethodGate({"get": "daily_report.mark_update", "post": "daily_report.mark_update"})` (GET и POST на одном URL/имени роута); НОВАЯ `MATRIX["ops-daily-submission-detail"] = _MethodGate({"get": "daily_report.mark_update"})`; `test_matrix_covers_every_registered_route` и `test_method_gates_cover_exactly_served_methods` зелёные (served list = ровно `{get, post}`, detail = ровно `{get}`). AUDIT_MATRIX: read-роуты НЕ мутируют — `_served_mutating` их не видит, строк НЕ добавлять (POST-часть list-строки уже есть; исключение из «урока 2 строки» 5.8a/b — он про write-роуты).

8. **Гейт.** **Then** `make gate` зелёный (база 1750 — пост-ревью 5.8b); `ruff format` per-file + `ruff check` (E,F) чисты; `makemigrations --check` пуст (миграций НЕТ); сьюты 5.4a/b (32), 5.8a (25) и 5.8b (40) целы, кроме РОВНО трёх переписанных тестов из AC-1.

## Tasks / Subtasks

- [x] **Task 1 — PermissionService.visible_division_ids** (AC: 3)
  - [x] Новый classmethod в `apps/operations/services.py` РЯДОМ с `has_permission`: `visible_division_ids(user_id, permission_code) -> None | set[UUID]`. Резолюция ЗЕРКАЛИТ `effective_permissions` (тот же источник: `OpsUserRoleSelector.active_for_user` + активные temp-duty гранты): роль/грант, чей набор permission-кодов содержит код или `*`: `scope_division_id is None` → вернуть `None` (глобально, дальше не собирать); иначе union `CoreDivisionTreeSelector.subtree_ids(scope_division_id)`. Нет ни одной роли с кодом → пустой `set()` (list отдаст 0 строк — гейт AC-2 уже отсёк не-держателей, но метод обязан быть fail-closed сам по себе).
  - [x] Docstring: point-check остаётся за `has_permission`; этот метод — ОБРАТНЫЙ вопрос для list-селекторов (канон L451). НЕ звать в цикле.
- [x] **Task 2 — Селектор list** (AC: 3, 4)
  - [x] `DailySubmissionSelector.list(actor, *, division_id=None, business_date=None)` → QuerySet: `visible_division_ids(actor, "daily_report.mark_update")` → `None`: без сужения / `set`: `filter(division_id__in=...)`; затем опциональные фильтры-равенства; `.defer("snapshot")` (строки по десятки–сотни КБ); `order_by("-business_date", "-version", "id")`. Образец сортировки — `previous_for` (selectors.py:103-120), образец actor-first — `AuditLogSelector.list`/`NotificationSelector.list`.
  - [x] ⚠️ Код права в селекторе — та же константа, что во view: НЕ хардкодить дважды с риском дрейфа (импортировать/пробросить единый источник).
- [x] **Task 3 — Сериализаторы: Detail + Filter** (AC: 4, 5)
  - [x] `DailySubmissionDetailSerializer(ModelSerializer)`: 9 полей `DailySubmissionSerializer` + `snapshot`, `reason`, `sanction`, `triggered_by_status_id`; `read_only_fields = fields`. Обновить docstring 9-полевого («Whether the detail view returns the snapshot is 5.8c's decision» — решение состоялось: detail отдаёт).
  - [x] `DailySubmissionFilterSerializer(serializers.Serializer)`: `division_id = UUIDField(required=False)`, `business_date = DateField(required=False)` (канон AuditLogFilterSerializer, serializers.py аудита :30-45). Мусор → 400 через `is_valid(raise_exception=True)`.
- [x] **Task 4 — list/retrieve во ViewSet + пагинация** (AC: 1, 2, 4, 5, 6)
  - [x] `DailySubmissionPagination(LimitOffsetPagination)`: `default_limit=50`, `max_limit=200` (копия AuditLogPagination, apps/audit/api/views.py:24-29).
  - [x] `http_method_names = ["get", "post", "options"]` (БЕЗ `head` — Д4); `permission_map` += `{"list": _SUBMIT_PERMISSION, "retrieve": _SUBMIT_PERMISSION}`.
  - [x] `def list(self, request)`: `DailySubmissionFilterSerializer(data=request.query_params)` → `is_valid(raise_exception=True)` → `DailySubmissionSelector.list(request.actor_id, **validated)` → ручная пагинация (`paginator.paginate_queryset(qs, request, view=self)` → `get_paginated_response([9-полевой serializer].data)`). ViewSet остаётся `viewsets.ViewSet` (НЕ ReadOnly/ModelViewSet — queryset-магия мимо селекторов; list/retrieve руками, канон 5.8a/b).
  - [x] `def retrieve(self, request, pk=None)`: `by_id(pk)` → None → `DomainError("ENTITY_NOT_FOUND", 404, detail={"submission_id": str(pk)}, message="Сдача не найдена.")` (зеркало amend) → `ensure_division_scope(request.actor_id, _SUBMIT_PERMISSION, submission.division_id)` → `Response(DailySubmissionDetailSerializer(submission).data)` (200).
  - [x] ⚠️ БЕЗ try/except; `latest_for` в retrieve НЕ звать (AC-5); module-docstring views.py обновить (5.8a/5.8b → 5.8a/b/c, «list/detail arrive with 5.8c» протухает).
- [x] **Task 5 — Строка матрицы обновлена + новая** (AC: 7)
  - [x] `test_rbac_matrix.py`: `MATRIX["ops-daily-submission-list"]` → `_MethodGate({"get": "daily_report.mark_update", "post": "daily_report.mark_update"})` (комментарий: чтение = mark_update, epics-реш. 2026-07-02, daily_report.view не заводим) + НОВАЯ строка `MATRIX["ops-daily-submission-detail"] = _MethodGate({"get": "daily_report.mark_update"})` (комментарий: scope-видимость — в селекторе/сервис-гарде, матрицей не проверяется; pk=0 у держателя → 404 = ALLOW ПО КАНОНУ — у retrieve формы нет, в отличие от amend).
  - [x] AUDIT_MATRIX НЕ трогать (AC-7).
- [x] **Task 6 — Переписать РОВНО три «until 5.8c»-теста** (AC: 1)
  - [x] `test_daily_submission_api.py`: `test_get_is_405` → `test_get_list_200_for_holder` (200 + конверт); `test_anonymous_get_is_405` → `test_anonymous_get_403`.
  - [x] `test_daily_submission_amend_api.py`: `test_detail_route_absent_404` → УДАЛИТЬ (detail-контрактом владеет новый сьют 5.8c; комментарий теста сам это предсказывал).
- [x] **Task 7 — Тесты read-API** (AC: 1–7)
  - [x] Создать `apps/operations/submissions/tests/test_daily_submission_read_api.py` — СВОИ копии фикстур 5.8a/b (`frozen_clock`/`tree`/`scoped_op`/`child_scoped_op`/`global_op`/`viewer`/`_client`; вынос в conftest — отдельная гигиена, НЕ здесь) + `_submitted(division)` через `submit_day` + хелперы `_list(actor, **params)`/`_detail(actor, pk)`.
  - [x] Кейсы list: 200 конверт `{count,next,previous,results}` · results = 9 полей БЕЗ snapshot · ordering пинится (два дивизиона/даты/версии → порядок `-business_date,-version,id`) · default limit 50 / cap `?limit=5000` → 200 строк максимум (канон-тест аудита :191-199) · фильтры division_id/business_date (+история: после amend выдача содержит v1 И v2) · мусорные `?division_id=abc` / `?business_date=мусор` → 400 VALIDATION_ERROR · anon → 403 · VIEWER → 403 · scoped-op видит root+child, НЕ other · child_scoped_op НЕ видит root (upward) · global видит всё · вне скоупа = ОТСУТСТВИЕ строк, не 403.
  - [x] Кейсы detail: 200 держателю + РОВНО 13 полей (snapshot/reason/sanction/triggered_by_status_id присутствуют; на v1 reason/sanction="" и triggered_by=None; на amended-версии — заполнены) · stale-pk → та самая версия (version==1 после amend) · чужой дивизион → 403 + details · phantom pk → 404 + §36-конверт (5 ключей) · non-int pk → 404 (пин реюза by_id) · anon → 403 · VIEWER → 403.
  - [x] Кейсы 405: PUT/PATCH/DELETE на collection и detail URL (authed и anon, параметризовано).
  - [x] НЕ перетестировать: домен сдачи/amendment (5.3b/5.4a), by_id-гварды пином целиком (закалены 5.8b — 1-2 пина достаточно), пагинационную математику DRF.
- [x] **Task 8 — Гейт** (AC: 8)
  - [x] `ruff format` по КАЖДОМУ тронутому файлу (per-file, feedback_vaps_ruff_format_scoping), `ruff check` (E,F).
  - [x] `make gate` зелёный; зафиксировать число тестов и время (база 1750).

### Review Findings

Проход 1 (bmad-code-review, Fable 5 ×3 слоя — Blind/Edge/Auditor; **same-model caveat** vs dev Fable 5; scoped-дифф 5.8c vs `6f49ec2`). Acceptance Auditor: **8/8 AC SATISFIED**, отклонение №2 (mixin) ПРИНЯТО как обоснованное и полное. Edge: пробы подтвердили duty-ветку end-to-end, «дыры 403→200» в mixin НЕТ ни на одном ViewSet. 0 decision · 5 patch · 1 defer · 11 dismiss.

- [x] [Review][Patch] **Mixin: `action is None` → `raise MethodNotAllowed` вместо `return`** — blind+edge, Med. Голый `return` оставляет 405 «на надежде», что DRF не найдёт хендлер: будущий ViewSet с методом-атрибутом `get`/`post` (APIView-паттерн) исполнил бы незамапленный глагол БЕЗ гейта; явный raise делает контракт детерминированным на уровне mixin. + пин чужого post-only @action-роута (GET ops-temp-duty-expire → 405) [Backend/VAPS/apps/core/api/permissions.py:54-55]
- [x] [Review][Patch] **`visible_division_ids`: честное зеркало + один full-scan дерева** — blind+edge, Med. (а) «Mirrors … can never drift» — сейчас две ручные копии перечисления грантов; извлечь общий `_active_grants(user_id)` для `effective_permissions` И `visible_division_ids`; (б) `subtree_ids` в цикле по scoped-грантам = K full-scan'ов `children_map` (контракт «call ONCE and reuse», Ловушка №4) — аддитивный optional-параметр `children_map=None` в `CoreDivisionTreeSelector.subtree_ids` + одна карта на вызов; query-count пин на 2 scoped-гранта [apps/operations/services.py:74-99 + apps/core/selectors.py:99-109]
- [x] [Review][Patch] **`by_id`: ведущие нули — остаточный алиас-класс 5.8b** — edge, Low. `[0-9]+` пропускает `/006/` → 200 тем же ресурсом, что `/6/` (кеш/логи/аудит-идентичность URL); ужесточить до `0|[1-9][0-9]*` + пин `"0<pk>"` → 404 [apps/operations/submissions/selectors.py:45]
- [x] [Review][Patch] **Тест-гэпы видимости и метод-поверхности** — blind+edge+auditor, Med (сводный). Duty-грант scoped (list+detail), unscoped duty → глобальная видимость, ADMIN wildcard, union двух scoped-ролей; positive subtree-detail (root-scoped → child 200 — паритет point-check↔visibility); scoped + `?division_id=<чужой>` → 200 пусто (не 403); POST/HEAD на detail-URL и HEAD на collection → 405; канон-пин cap'а `get_limit(limit=5000)==200`; anon-варианты write-verbs на collection в read-сьюте [test_daily_submission_read_api.py]
- [x] [Review][Patch] **File List: стори-файл — «создан», не «изменён»** — auditor I-6, косметика [этот файл]
- [x] [Review][Defer] **Неизвестный/опечатанный query-ключ молча игнорируется → полная выборка вместо отфильтрованной** (`?divsion_id=X` → 200 со всей видимой историей; для parallel-run сверки — тихое искажение) — blind+edge, Low. Класс ВСЕХ read-API проекта (audit 4.5 и notifications 5.7c ведут себя так же — DRF-Serializer отбрасывает лишние ключи); фикс — общий strict-query-паттерн отдельной гигиеной, не per-endpoint [serializers.py + канон 4.5/5.7c] — deferred, pre-existing class

**Все 5 патчей ПРИМЕНЕНЫ (2026-07-02):** (1) mixin `raise MethodNotAllowed(request.method)` + пин `test_unmapped_method_on_action_route_is_405` (GET employee-archive, anon+authed) — TemporaryDutyViewSet не годился (старый инлайн-гейт, не mixin); (2) `_active_grants` извлечён и разделён между `effective_permissions`/`visible_division_ids` + `subtree_ids(..., children_map=None)` аддитивно в core-селекторе + query-count пин ==4 на 2 scoped-гранта; (3) `by_id` → `0|[1-9][0-9]*` + пин `"0<pk>"` → 404; (4) +14 тестов (duty scoped/unscoped, ADMIN wildcard, union двух ролей, parity detail-child-200, foreign-filter-пусто-200, anon write-verbs ×3, POST/HEAD-405, cap get_limit(5000)==200, leading-zero); (5) File List поправлен. Пост-патч: `make gate` — **1812 passed** (1797+15), 25 deselected, ruff чист, makemigrations пуст, 38s.

Ключевые dismiss (11): «мёртвая duty-ветка» ОПРОВЕРГНУТА (duty_role_code — CharField, rbac/models.py:74; Edge-проба duty end-to-end 200); «GET/amend-405 не запинен» ОПРОВЕРГНУТ (пины 5.8b [get,head] живы); «оракул pk/division_id расширен на read» — аудитория ИДЕНТИЧНА (DIVISION_OPERATOR держит mark_update И correct; trade-off 5.8b покрывает, запинено сознательно); дубль литерала mark_update — два CONCERN'а (write-гейт/read-гейт), каждый канал внутренне един, связывание создало бы ложную зависимость; retrieve поднимает snapshot до scope — закрытый контур, defer-цена на happy-path хуже; ordering без division — Д3 спеки; сырой pk в 404-details — канон Д4 5.8b; limit=0/мусор-offset — DRF-канон 4.5/5.7c; дубль-параметр last-wins — QueryDict-канон; «403→405 на чужих unmapped-роутах» — дыры нет (хендлеры не биндятся, проверено перебором), контракт станет явным с патчем №1; формат-churn services.py — санкционирован Task 8.

## Dev Notes

### Эталоны — всё уже в кодовой базе
- **Read-ViewSet целиком:** `apps/audit/api/views.py` (стори 4.5) — пагинация-подкласс (:24-29), permission_map list+retrieve (:38), фильтр-сериализатор → селектор (:40-52), retrieve через селектор с маппингом в 404 (:54-69). ⚠️ Он на `ReadOnlyModelViewSet` — НЕ копировать базу, только паттерны: 5.8c остаётся на `viewsets.ViewSet` (канон файла 5.8a/b, руками написанные тонкие методы).
- **Actor-first селекторы:** `AuditLogSelector.list` (actor первым, НЕ сужает — audit.view плоский) и `NotificationSelector.list` (сужает сам, personal-scope `recipient=actor`) — 5.8c ПЕРВЫЙ division-scoped read-селектор проекта: actor первым + сужение по поддереву. Прецедента «visible_division_ids» НЕТ — Task 1 создаёт его.
- **Скелет ViewSet:** `apps/operations/submissions/api/views.py` (пост-5.8b) — mixin первым в MRO, константы кодов, порядок «form → by_id → scope → сервис» в amend (:60-97) — retrieve зеркалит резолв/скоуп-часть.
- **Тест-сьют зеркало:** `test_daily_submission_amend_api.py` (40 тестов, пост-ревью) — фикстуры вкл. `child_scoped_op` (upward-гвард), канон 403/404/§36-кейсов.

### Сервис-слой ГОТОВ — ничего в нём не менять, кроме +1 метода
`submit_day`/`amend_day`/хук 5.4b/`ensure_division_scope`/`by_id` — НЕ меняются. Единственное новое в сервис-слое: `PermissionService.visible_division_ids` (Task 1). `ensure_division_scope` реюзается с read-кодом как есть.

### ⚠️ ЛОВУШКА №1 (ГЛАВНАЯ): матрица полноты покраснеет ДВАЖДЫ без правок Task 5
Добавление `"get"` в `http_method_names` меняет served-набор: (а) `ops-daily-submission-list` станет `{get, post}` — существующая строка `_MethodGate({"post": ...})` провалит `test_method_gates_cover_exactly_served_methods` (methods == served РОВНО, test_rbac_matrix.py:277-285); (б) появится served-роут `ops-daily-submission-detail` — без новой строки красный `test_matrix_covers_every_registered_route` (:254-263). Обе правки — В ТОЙ ЖЕ сессии, что и код (TDD: матричные тесты и есть red-фаза).

### ⚠️ ЛОВУШКА №2: три старых теста «until 5.8c» упадут САМИ — править ровно их
`test_get_is_405`/`test_anonymous_get_is_405` (5.8a, test_daily_submission_api.py:118-126) и `test_detail_route_absent_404` (5.8b, test_daily_submission_amend_api.py:168-175) написаны с комментариями-предсказаниями. Их падение при добавлении GET — ОЖИДАЕМАЯ red-фаза, НЕ регрессия. Не трогать ничего сверх них (в т.ч. `test_non_post_verbs_405` 5.8b — amend-URL остаётся post-only: GET/HEAD там 405, т.к. у amend-роута в actions только post).

### ⚠️ ЛОВУШКА №3: snapshot в list = OOM/трафик-бомба
Строка snapshot — десятки–сотни КБ (docstring модели/сериализатора); 50 строк по умолчанию = мегабайты на страницу. `.defer("snapshot")` в list-селекторе ОБЯЗАТЕЛЕН (epics-нота: «list БЕЗ snapshot (defer)»), сериализатор list — 9-полевой (snapshot не читает → deferred-поле не догружается). Тест пинит отсутствие ключа snapshot в results.

### ⚠️ ЛОВУШКА №4: видимость НЕ через point-check в цикле
НЕ звать `has_permission`/`ensure_division_scope` по дивизиону в цикле (N+1 класс, donor anti-pattern; та же дисциплина, что 5.5b bulk). Один вызов `visible_division_ids` → один `division_id__in`. `subtree_ids` на роль — допустимо (ролей у актора единицы); при >1 scoped-роли НЕ пере-сканировать дерево на каждую без нужды (children_map уже один запрос на вызов).

### ⚠️ ЛОВУШКА №5: retrieve отдаёт ЗАПРОШЕННУЮ версию — НЕ head
Amend-семантика Д1 5.8b (pk идентифицирует цепь, сервис берёт latest) НЕ переносится на чтение: `GET /{id}/` — это точечное чтение строки. `latest_for` в retrieve не звать. Тест stale-pk пинит `version == 1` после amend.

### ⚠️ ЛОВУШКА №6: «урок 2 реестровые строки» (5.8a/b) НЕ применяется к read
AUDIT_MATRIX покрывает только мутирующие роуты (`_served_mutating`, `_WRITE_METHODS`, test_audit_coverage.py:255-276); GET-роуты туда НЕ попадают. Добавление строки для detail/GET — ошибка (сломает ничего, но это мусор в реестре). RBAC-строки — да (Task 5), AUDIT — нет.

### Двойная проверка кода — канон L450 (как 5.8a/b)
Mixin проверяет `daily_report.mark_update` глобально (resolver division-free); видимость/скоуп: list — селектор (L451), retrieve — `ensure_division_scope`. Дискриминаторы гейта: VIEWER (`status.view`) и ORGD (`daily_report.generate`) — оба «есть роль, нет кода». Держатель mark_update-без-видимости не существует (mark_update и определяет видимость).

### Что уже есть (НЕ переизобретать)
- `by_id` — закалён 5.8b (fullmatch ASCII-digits, docstring прямо обещает реюз 5.8c) — НЕ дублировать гварды во view.
- `ensure_division_scope` — как есть (scope_gate.py; falsy → ValueError, str → UUID).
- Trade-off 403-details/`division_id` + phantom-pk-404 — ПРИНЯТ Bratan (ревью 5.8b, опц. A) — детальный комментарий уже в test_foreign_division_403; в read-сьюте достаточно короткой ссылки на него.
- `OpsUserRoleSelector.active_for_user` (operations/selectors.py:7-13), `CoreDivisionTreeSelector.subtree_ids` (core/selectors.py:99-109), `RolePermission`-резолюция внутри `effective_permissions` (operations/services.py:26-49) — кирпичи Task 1.
- Коды ошибок — ВСЕ в реестре; §36-конверт — unified handler; seed НЕ трогается (mark_update посеян, DIVISION_OPERATOR держит).
- Пагинационный канон-тест — `test_pagination_caps_limit_and_defaults` (test_audit_read_api.py:191-199) и конверт-тест (:167) — калька для read-сьюта.

### Дефолты (приняты мной — поднять на вопросах, если не согласен)
- **Д1 (ГЛАВНЫЙ, схемо-влияющий):** detail отдаёт `snapshot` + `reason`/`sanction`/`triggered_by_status_id` (13 полей). Rationale: detail — единственный HTTP-канал снапшота (экраны расхода/amendment-флоу 10.5/10.6, parallel-run сверка); list остаётся лёгким. Альтернатива (без снапшота, отдельный экшен `/snapshot/` позже) отвергнута: плодит третий GET без выигрыша.
- **Д2:** list-фильтры — только `division_id` + `business_date` (равенство). Без `is_current`/диапазонов дат/`event` — MVP, добавится по нужде экранов (10.3/10.5).
- **Д3:** ordering `-business_date, -version, id` (новейшие дни, свежие версии сверху, id-стабилизация последней — L427).
- **Д4:** `head` в `http_method_names` НЕ добавляется (минимум 5.8a/b; HEAD → 405 всюду, пины 5.8b целы; audit включил head — прецедент не переносим, консистентность файла дороже).
- **Д5:** пустая видимость (`set()`) → пустой list, НЕ 403 (гейт кода уже отработал; пустой скоуп — легальное «ничего не видно»).
- **Д6:** `DailySubmissionPagination` — свой подкласс в views.py (канон: каждый read-API свой; выделение общего класса — отдельная гигиена, НЕ здесь).

### Границы (что 5.8c НЕ делает)
НЕ аудит чтения · НЕ `daily_report.view`/правки seed · НЕ фильтры сверх Д2 · НЕ дерево-светофор (10.4) и не руководящее чтение · НЕ TOMORROW_BLOCKED/override (6.10) · НЕ трогает `submit_day`/`amend_day`/хук 5.4b/модель/миграции/реестры/urls.py · НЕ conftest-рефактор фикстур · НЕ общий pagination-класс · НЕ throttle/OpenAPI · НЕ WS (E11).

### Previous Story Intelligence (5.8b, review 2026-07-02 — ПРИМЕНИТЬ СРАЗУ)
- **Ревью 5.8b: 1 decision + 4 patch.** Уроки, вшитые в AC выше: (1) upward-scope — обязательный кейс (child-скоуп НЕ видит root; в list это «строки отсутствуют», фикстура `child_scoped_op` уже есть в amend-сьюте — копировать); (2) границы формы: JSON null/list/dict и non-dict payload → 400 (для read-пути аналог — мусорные query-params, закрыто Filter-сериализатором); (3) out-of-range/alias pk — закрыто в `by_id`, НЕ переизобретать, 1-2 пина реюза; (4) trade-off 403-details принят — НЕ поднимать заново; (5) `ruff format` строго per-file; (6) 405-пины на authed И anon.
- **MAJOR-класс «граница пропускает мусор → 500 глубже»:** у 5.8c кандидаты — мусорные query-params (закрыто Filter-сериализатором → 400) и мусорный pk (закрыто by_id). Транспортный вариант (giant payload → 500) — известный defer 5.8b, к GET не применим.
- `make gate` база: **1750 passed / 37s** (пост-ревью 5.8b, НЕ закоммичено на момент create-story).

### Git Intelligence
- `d0d4af6` feat 5.8a — скелет ViewSet/роутер; рабочее дерево содержит НЕЗАКОММИЧЕННЫЙ 5.8b (пост-ревью, 1750 passed) — **5.8c стартует ПОСЛЕ коммита 5.8b**; проставить `baseline_commit` этой спеки SHA-ой коммита 5.8b.
- Паттерн коммита: `feat(E5): 5.8c GET list+detail сдач — ...` + Co-Authored-By.

### Project Structure Notes
- Создаётся: `apps/operations/submissions/tests/test_daily_submission_read_api.py`.
- Модифицируются: `apps/operations/services.py` (+`visible_division_ids`), `submissions/selectors.py` (+`list`), `submissions/api/serializers.py` (+Detail, +Filter, docstring-правка), `submissions/api/views.py` (+pagination, +list/retrieve, permission_map, http_method_names, docstring), `operations/tests/test_rbac_matrix.py` (1 строка обновлена + 1 новая), `submissions/tests/test_daily_submission_api.py` (2 теста), `submissions/tests/test_daily_submission_amend_api.py` (−1 тест).
- Счёт: 1 create + 7 modify; из них содержательных нон-тест — 4 (services/selectors/serializers/views), одна ответственность (read-поверхность ресурса + её видимость). Миграций НЕТ, seed/реестры/urls НЕ трогаются.

### References
- [Source: epics.md:769-784 — стори 5.8, декомпозиционная нота: 5.8c GET list+detail; чтение = mark_update + actor-scoped селектор, daily_report.view НЕ заводим]
- [Source: architecture.md:427 — конверт {count,next,previous,results}, default 50/max 200, ordering + tie-breaker id ПОСЛЕДНИМ; :450-451 — scope в сервисе; list-селектор принимает actor первым и сам сужает; :437 — тест на каждый код]
- [Source: apps/audit/api/{views,serializers}.py + apps/audit/selectors.py — эталон read-API 4.5 (пагинация :24-29, permission_map :38, фильтры :40-52, retrieve→404 :54-69, ordering с id :57)]
- [Source: apps/notifications/{api/views.py,selectors.py} — 5.7c: селектор сужает сам (recipient=actor), фильтр-сериализатор, та же пагинация]
- [Source: apps/operations/services.py:17-56 — PermissionService._scope_matches/effective_permissions/has_permission (кирпичи visible_division_ids)]
- [Source: apps/operations/submissions/selectors.py — by_id (:26-40, «reused by the 5.8c detail view»), previous_for (:103-120, образец ordering); selectors.py:154,200 — ремарки «no actor — права на API 5.8»]
- [Source: apps/operations/submissions/api/serializers.py:37-57 — 9-полевой DailySubmissionSerializer, docstring делегирует snapshot-решение 5.8c]
- [Source: apps/operations/submissions/services/scope_gate.py — ensure_division_scope целиком]
- [Source: apps/core/api/permissions.py — RequirePermissionMixin (fail-closed, list/retrieve — отдельные ключи map)]
- [Source: apps/operations/tests/test_rbac_matrix.py:83-98,138,219-245,254-263,277-285,326-330 — _MethodGate, текущая list-строка, served-интроспекция, completeness/method-гейты, _url_for pk=0]
- [Source: apps/audit/tests/test_audit_coverage.py:255-276 — _served_mutating: read-роуты вне AUDIT_MATRIX]
- [Source: docs/registries/error-codes.yaml — VALIDATION_ERROR/PERMISSION_DENIED/ENTITY_NOT_FOUND (реюз, ничего нового)]
- [Source: _bmad-output/implementation-artifacts/5-8b-api-amend-сдачи.md — Review Findings (upward-гвард, by_id-харднинг, trade-off принят)]
- [Source: memory feedback_vaps_ruff_format_scoping, feedback_vaps_arch_guards]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (`claude-fable-5`), bmad-dev-story, 2026-07-02.

### Debug Log References

- Пререквизит Q4 выполнен до старта: 5.8b закоммичен (`4bcc00e`), граф отдельно (`6f49ec2` = baseline этой стори).
- RED-прогон: ImportError на `DailySubmissionPagination` + NoReverseMatch detail-роута + красная completeness RBAC-матрицы — тесты валидны до имплементации.
- Промежуточный GREEN: 725 passed / 3 failed — два падения вскрыли взаимодействие mixin×http_method_names (см. Implementation Plan п.2), одно — ошибка теста (вчерашняя дата вне окна submit_day → заменена на TOMORROW из окна {today, today+1}).
- `make gate` финальный: **1797 passed** (база 1750 − 1 удалённый + 30 read-тестов + 18 поведенческих матричных), 25 deselected, 39s; `makemigrations --check` пуст; ruff чист (format per-file по 9 файлам).

### Implementation Plan / Decisions

TDD red→green строго по Tasks: сначала весь read-сьют (30 тестов) + 2 строки матрицы + переписка трёх «until 5.8c»-тестов (RED), затем visible_division_ids → селектор → сериализаторы → ViewSet (GREEN). Решения сверх буквы стори (в её духе):

1. **Константа read-кода живёт в selectors.py (`READ_PERMISSION`), view импортирует её** — селектор не может импортировать из api/views (слои), а «единый источник против дрейфа» (Task 2) требует одной константы для видимости селектора И гейта view.
2. **⚠️ ОТКЛОНЕНИЕ (обоснованное): +1 файл вне заявленного списка — `apps/core/api/permissions.py`.** С `"get"` в `http_method_names` GET на post-only amend-URL стал резолвиться в `action=None` → fail-closed mixin отвечал **403 вместо 405**, ломая пины 5.8b (`test_non_post_verbs_405[get]` ×2) и урок 5.7c («метод-поверхность = 405, не вводящий в заблуждение 403»). Фикс на правильном слое: early-return `if self.action is None` в mixin → DRF даёт канонический 405. Fail-closed цел: любой ЗАМАППЛЕННЫЙ action по-прежнему требует код; unmapped action = метод, который данный РОУТ не обслуживает. Комментарий в mixin объясняет сценарий. Альтернатива (переписать пины 5.8b на 403) отвергнута — контракт 5.8b менять нельзя, стори разрешала трогать ровно 3 теста.
3. Ordering-тест использует TOMORROW (в окне submit_day) вместо вчерашней даты — вторая business_date без манипуляций клоком.
4. `visible_division_ids` возвращает `None` early при первом глобальном гранте (не собирает поддеревья зря); пустой `set()` при отсутствии кода — fail-closed сам по себе (Д5: пустая видимость = пустой list, не 403).

### Completion Notes List

- Все 8 AC удовлетворены; все 8 Tasks закрыты. Ловушки целы: матрица ×2 обновлена в той же сессии (№1); переписаны РОВНО 3 старых теста (№2); snapshot deferred + 9-полевой list (№3, тест пинит отсутствие ключа); одна visible_division_ids → один `__in`, без point-check в цикле (№4); retrieve отдаёт запрошенную версию — stale-pk тест пинит version==1 (№5); AUDIT_MATRIX не тронута (№6).
- Дефолты Д1–Д6 реализованы как записаны (snapshot В detail — 13 полей; фильтры MVP; ordering `-business_date,-version,id`; без head; пустая видимость = пустой list; свой pagination-класс).
- Реюз: `by_id` (1 пин non-int, полная матрица гвардов — за amend-сьютом), `ensure_division_scope` с read-кодом, trade-off 403-details унаследован без пересмотра (короткая ссылка в тесте на rationale amend-сьюта).
- Регрессия нулевая: 32 теста 5.4a/b, 25 тестов 5.8a (2 переписаны), 40 тестов 5.8b (1 удалён по AC-1) — целы; core-сьют зелёный после правки mixin.
- Артефакты НЕ закоммичены (канон: коммит после code-review).

### File List

- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_read_api.py` — создан (30 тестов read-контракта).
- `Backend/VAPS/apps/operations/services.py` — изменён (+`PermissionService.visible_division_ids`).
- `Backend/VAPS/apps/operations/submissions/selectors.py` — изменён (+`READ_PERMISSION`, +`DailySubmissionSelector.list`).
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` — изменён (+`DailySubmissionFilterSerializer`, +`DailySubmissionDetailSerializer`, docstring-правки).
- `Backend/VAPS/apps/operations/submissions/api/views.py` — изменён (+`DailySubmissionPagination`, +list/retrieve, permission_map+={list,retrieve}, http_method_names+=get, module-docstring 5.8a/b/c).
- `Backend/VAPS/apps/core/api/permissions.py` — изменён (mixin: action=None → DRF 405; отклонение №2, обосновано).
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` — изменён (list-строка → {get,post} + новая detail-строка).
- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_api.py` — изменён (2 «until 5.8c»-теста переписаны: 200-конверт / anon-403).
- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_amend_api.py` — изменён (−test_detail_route_absent_404, комментарий-тумбстоун).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — изменён (статус 5.8c, dev-activity-нота).
- `_bmad-output/implementation-artifacts/5-8c-api-чтение-сдач.md` — создан (create-story) и ведётся по ходу (baseline, чекбоксы, Dev Agent Record, Review Findings, Status).

## Change Log

| Дата | Версия | Изменение | Автор |
|------|--------|-----------|-------|
| 2026-07-02 | 0.1 | Создана стори (bmad-create-story, Fable 5): 5.8c = GET list+detail по epics-ноте сплита 5.8 (завершение сплита); 2 research-агента (read-API канон 4.5/5.7c + ground-truth submissions/RBAC); уроки ревью 5.8b вшиты (upward-scope, by_id-реюз, принятый trade-off 403-details); Ловушки №1-6 (матрица полноты ×2, три «until 5.8c»-теста, snapshot-defer, no-N+1-видимость, retrieve≠head, AUDIT_MATRIX-не-трогать), Д1-Д6 (snapshot в detail, фильтры MVP, ordering, без head, пустая видимость = пустой list) | Bratan |
| 2026-07-02 | 1.0 | Имплементация (bmad-dev-story, Fable 5, TDD red→green): visible_division_ids + actor-scoped list-селектор (defer snapshot) + Filter/Detail-сериализаторы + list/retrieve + пагинация 50/200 + матрица ×2 + 30 тестов; фикс mixin (action=None → 405, отклонение обосновано); make gate 1797 passed/39s, регрессия нулевая; Status → review | Bratan |
| 2026-07-02 | 1.1 | Code-review проход 1 (Fable 5 ×3 слоя, same-model caveat): 8/8 AC SATISFIED, отклонение mixin принято; 0 decision · 5 patch применены (MethodNotAllowed-харднинг, _active_grants+children_map-реюз, by_id ведущие нули, +15 тестов, File List) · 1 defer (strict-query класс) · 11 dismiss; make gate 1812 passed/38s; Status → done | Bratan |
