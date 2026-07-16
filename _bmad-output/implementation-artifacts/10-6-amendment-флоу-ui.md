# Story 10.6: Amendment-флоу UI

Status: done
baseline_commit: 826b022

> Ultra-ревью НЕ предписано (ретро E9 AI-2 называет поимённо только 10.2/10.4/10.10) — обычный цикл ревью, но **красные пробы (AI-1) — бинарный гейт** для каждого важного ассерта; File List сверяется с `git diff --name-only 826b022..HEAD` ДО ревью (AI-3).

## Story

As a **держатель `daily_report.correct`** (epics-персона «руководитель»; по seed право несёт DIVISION_OPERATOR — см. Q-персона),
I want **запрос пересдачи сданного дня с обязательными причиной и санкцией прямо из панели «Сдача дня», различимую индикацию версий v1/v2+ (пересдача видна, её причина/санкция читаемы) и маркер «сводка протухла», когда ребёнок пересдал под собранной сводкой**,
so that **поправки задним числом проходят видимым путём — с причиной, санкцией и аудитом, а не молчаливой перезаписью, и протухшая консолидация не выдаёт себя за актуальную**.

## Goal

Amendment-флоу в UI поверх ГОТОВОЙ бэк-поверхности: `POST /api/operations/daily-submissions/{id}/amend/` (5.4a/5.8b) уже живой, оттестированный (25+ тестов `test_daily_submission_amend_api.py`) и присутствует в `schema.d.ts` (`operations_daily_submissions_amend_create`). Стори добавляет ОДНО тонкое additive-расширение read-модели day-state (10.3): блоки `amendment` (причина/санкция текущей AMENDED-версии) и `summary` (derived-свежесть сводки 5.11 — сервис `summary_freshness` существует, HTTP-поверхности у него НЕТ, проверено кодом `api/views.py`). Зеркало прецедента 10.3/10.4/10.5: экранная стори E10 везёт свой тонкий read-слой. Плюс фиксы двух deferred-багов панели 10.3, адресованных ревью прямо в 10.6.

## Scope

1. **Бэк — additive-расширение day-state detail (единственное изменение API):** в `DayStateDetailSerializer` + `day_state`-view (`Backend/VAPS/apps/operations/submissions/api/views.py`) два новых nullable-поля detail-режима (только при `division_id`; list-режим не меняется — `detail: null` как был):
   - `amendment: {reason, sanction} | null` — из ТЕКУЩЕЙ submitted-строки, если её `event == AMENDED`; иначе `null`. Источник — уже загруженная map `current_for_many` (строки полные, `reason`/`sanction` — колонки модели, доп. запросов НЕТ). `triggered_by_status_id` НЕ выдавать (внутренний provenance-ref, фронту не нужен).
   - `summary: {status, superseded, missing, unpinned} | null` — проекция `summary_freshness(division_id, business_date)` (`services/summary_service.py:273`); сервис возвращает `None` (нет current ИЛИ current без ключа `sources` — обычная сдача) → `null`. `status ∈ {FRESH, STALE}`; оси: `superseded` `[{division_id, pinned_version, current_version}]`, `missing` `[{division_id, pinned_version}]`, `unpinned` `[str]` — форма dataclass `SummaryFreshness` как есть. Дубль-чтение `current_for` внутри сервиса — принять (самодостаточный сервис 5.11, бюджет — 4 канала чтения, инвариантно числу детей); НЕ звать freshness в list-режиме и не звать по всем видимым (NFR-4).
   - Права/гейты НЕ меняются: `day_state` остаётся под `READ_PERMISSION` (`daily_report.mark_update`); порядок scope-403 → existence-404 не трогается; новых строк RBAC-матрицы НЕТ (`ops-daily-submission-day-state` и `ops-daily-submission-amend` уже есть). Read-only → аудит НЕ добавляется.
   - `make schema` + `npm run generate:api` (обе половины).
2. **Фронт — запрос пересдачи в `DaySubmissionPanel`** (`frontend/src/features/daily-grid/DaySubmissionPanel.tsx`; модуль фичи daily-grid — там же, где живёт панель 10.3; НОВАЯ фича не создаётся):
   - В submitted-состоянии — кнопка «Запросить пересдачу», гейт `usePermissions().hasPermission("daily_report.correct")`: без права — disabled с подсказкой «нет права на пересдачу», НЕ скрывать (обнаружимость — зеркало download-гейта 10.5).
   - Клик → модальный диалог (нативный `<dialog>` + `showModal`, зеркало `SubmitPreviewDialog` того же файла: guard по `.open`, Esc/onCancel): textarea «Причина» (без лимита — model TextField) + input «Санкция» (`maxLength=255` — model CharField(255)) + предупреждение «пересдача создаст версию N+1; снапшот пересобирается из текущей БД; действующий расход потребует нового выпуска „взамен"». «Подтвердить» disabled при пустых (после trim) полях И на `isPending`.
   - Подтверждение → `useApiMutation` POST `/api/operations/daily-submissions/{id}/amend/` с телом ровно `{reason, sanction}`; `{id}` = `state.submission.id` (протухший pk легален: amend сам ре-резолвит head цепочки через `latest_for` — комментарий view L350-351).
   - 201 (`DailySubmissionSerializer` — 9 полей, БЕЗ reason/sanction) → состояние «пересдано» из ответа (версия/время/event=AMENDED), reason/sanction — из только что отправленной формы (локально, до рефетча), инвалидация `['day-state']`, диалог закрыт.
   - Ошибки (ВСЕ коды non-overridable → канал `mutation.error`; ConflictDialog НЕ участвует): 400 → сообщение формы В диалоге (диалог не закрывать — ввод не терять); 409 `DAY_ALREADY_SUBMITTED` (гонка конкурентных amendments, CONSTRAINT_ERROR_MAP) → НЕ тупик: invalidate day-state + сообщение «состояние обновлено» (зеркало Решения №6 стори 10.3); 422 `NO_SUBMISSION_TO_AMEND` → баннер + invalidate (день оказался несдан); 403/404 → баннер `ApiError`; 5xx/сеть → generic-тост хука; 401 → цепь 8.6 мимо панели.
3. **Фронт — индикация версий v1/v2+:** в submitted-состоянии панели: `eventLabel('AMENDED')` → человекочитаемое «пересдано (amendment)» (сейчас падает в сырой код — фикс); при `version >= 2` ИЛИ `event === 'AMENDED'` — визуальный бейдж «Пересдача» рядом с «версия N» (v1 остаётся без бейджа — различимость); при наличии `detail.amendment` — строки «Причина: …» / «Санкция: …» (санкция — то, что делает поправку ВИДИМЫМ путём). `dayState.ts`: `SelectedDayState.submitted` расширить полями `amendment`/`summary` из ответа (defensive-чтение — зеркало `readDrift`).
4. **Фронт — маркер протухшей сводки:** при `detail.summary` ненулевом: `status === 'STALE'` → маркер «Сводка протухла» (`role="alert"`) с осями: пересдавшие дети («подразделение X: пин vN → текущая vM» из `superseded`), `missing` («сдача ребёнка отозвана»), `unpinned` («появился несведённый ребёнок»); имена детей резолвить по словарю `divisions` ответа day-state (id вне словаря → показать id — fallback-канон 10.3); `FRESH` → тихая строка «Сводка актуальна»; `null` → ничего (строка — не сводка).
5. **Фронт — фиксы deferred-багов 10.3 (оба адресованы ревью в 10.6, deferred-work.md L667-668):**
   - `submittedNow` затмевает более свежую серверную строку: state-деривация предпочитает серверную submitted-строку, когда `server.version >= submittedNow.version` (чужой amendment после «Обновить» показывает СВЕЖИЕ версию/время/drift, а не застывший локальный 201).
   - Гонка «201 чужой дивизии»: в `onSuccess` мутаций (submit И amend) — гард `data.division_id === selected` (ref текущего выбора) — ответ, прилетевший после смены селекта, НЕ красит панель другой дивизии.
6. **Фронт — `supersedesLabel` с годом (defer ревью 10.5, L681):** `frontend/src/features/expense-report/expenseReport.ts` — «взамен исх.№ {number}/{year}» (`supersedes.year` уже в ответе history; Д-формат — Q-формат ниже, не стоп); тест кросс-годовой цепочки.

## Out of Scope

- **HTTP-роуты сводки (`assemble_summary`/`rebuild_summary`)** — сервис 5.11 сознательно без API («Д8: роуты — будущая стори»); UI пересборки сводки требует policy-выбора permission-кода (нового или существующего — гранты PROVISIONAL, Bratan) → отдельная стори. AC 10.6 требует «протухшая сводка ПОМЕЧЕНА», не «пересобрана» — литера epics.
- **Перевыпуск расхода после amendment:** уже работает БЕЗ новой работы — `issue_expense_document` при `prev.submission_version < locked.version` сам гасит прежний выпуск (`ISSUED→SUPERSEDED`) и создаёт новый с `supersedes=prev` и `reason = reason сдачи` (`document_release_service.py:277-315`); кнопка — экран 10.5 (`/reports`, POST). 10.6 выпуск НЕ трогает; предупреждение в диалоге лишь называет следствие.
- **Amendment-UI для сводки как отдельный режим:** HTTP-amend сводки легален (тот же endpoint; пины `sources` едут VERBATIM из вытесняемой версии — `amendment_service.py:138-139`), но НЕ освежает пины — это работа `rebuild_summary`. Кнопка по типу строки не блокируется (система сама корректна), rebuild-UI — стори сводки (см. выше).
- **Полный журнал версий дня** (список v1..vN с причинами): «версии различимы» закрывается бейджем/версией/причиной текущей; история — read API `list` 5.8c существует, UI-журнал — UX-полировка позже.
- **reason/sanction в списочной проекции `DailySubmissionSerializer`:** НЕ добавлять — 9-полевой контракт потребляется 10.3/10.4/грид-сюитами; причина текущей версии едет новым detail-блоком day-state (additive), контракт списка стабилен.
- **`preview_event` enum в схеме (defer 10.3, L674): НЕ триггерится** — amendment НЕ проходит через preview несданного дня (`preview_day_event` зовётся только при `current is None`), словарь preview-событий 10.6 не расширяет. Defer остаётся с прежним триггером «первое расширение событий preview».
- **Эскалация санкции** («выше после ухода расхода наверх») — forward-seam E6/бэк; UI фиксирует ввод как есть.
- **Подключение прочих путей ретро-правки к amendment-хуку** (deferred-work.md L322: `update_status`/`extend_status`/… не зовут `mark_days_for_amendment`) — бэк-стори полного покрытия путей правки, НЕ UI.
- **Кнопка «Напомнить» / уведомления о протухании** — E11.
- **Seed-гранты ролей** — PROVISIONAL, только Bratan (в т.ч. НЕ выдавать ORGD `daily_report.correct`, даже если «руководитель» из epics намекает — см. Q-персона).
- **Печатная форма** — 10.7; **личный экспорт** — 10.8; **e2e целиком** — 10.10; **стори 10.4 (review, ждёт ultra)** — её файлы/статус НЕ трогать (readiness-tree не пересекается с daily-grid).

## Acceptance Criteria

Источник: epics.md §Story 10.6; raise-сайты `amendment_service.py::amend_day` (400 VALIDATION_ERROR :40,51 — actor/reason/sanction пусты, HTTP-слой отбивает blank раньше DRF-формой; 404 ENTITY_NOT_FOUND :94; 422 NO_SUBMISSION_TO_AMEND :107; гонка версий → IntegrityError → 409 DAY_ALREADY_SUBMITTED через CONSTRAINT_ERROR_MAP — докстринг :77), `api/views.py::amend` (404 фантомный/мусорный pk :353; 403 scope ПОСЛЕ резолва pk :363 — осознанный trade-off 5.8b), `DailySubmissionAmendSerializer` (400: required+trim_whitespace+allow_blank=False; sanction max_length=255; `triggered_by_status_id` НЕ принимается), `summary_service.py::summary_freshness` (None | SummaryFreshness{status FRESH/STALE, superseded, missing, unpinned}).

1. - [x] **AC-1 (бэк: amendment-блок day-state).** Given день сдан и амендирован (current v2, event=AMENDED, reason/sanction непусты), When `GET day-state?business_date=&division_id=`, Then `detail.amendment == {reason, sanction}` (значения из строки); Given current v1 (CONFIRMED_NO_CHANGES/CHANGED) → `detail.amendment == null`; Given день не сдан → `detail.amendment == null` (preview-ветка не меняется); list-режим (без division_id) → `detail == null` как в 10.3. `triggered_by_status_id` в ответе ОТСУТСТВУЕТ.
2. - [x] **AC-2 (бэк: summary-блок day-state).** Given подразделение-родитель с собранной сводкой (current со `snapshot.sources`) и ребёнок пересдал (пин-версия < текущей), Then `detail.summary.status == "STALE"` и `superseded` несёт `{division_id, pinned_version, current_version}` ребёнка; Given пины актуальны → `FRESH` с пустыми осями; Given у запиненного ребёнка не осталось current («ноль текущих») → ось `missing`; Given обычная сдача листа (без `sources`) → `detail.summary == null`.
3. - [x] **AC-3 (бэк: NFR-пин).** Given detail-режим day-state по сводке с N детьми, Then число SQL-запросов — константа (`assertNumQueries` одинаков на малом и большом числе детей/версий): freshness — один вызов сервиса (его 4 канала), никаких per-child/per-version запросов из view.
4. - [x] **AC-4 (схема).** Given регенерация, Then `Backend/VAPS/schema.yaml` и `frontend/src/shared/api/schema.d.ts` несут `amendment`/`summary`-блоки detail; типы фронта — только из `schema.d.ts` (ARCH-FE-011), ручных дублей контракта нет; amend-роут в схеме уже был — НЕ пересоздаётся.
5. - [x] **AC-5 (фронт: кнопка и гейт).** Given сданный день под держателем `daily_report.correct`, Then кнопка «Запросить пересдачу» активна; Given права нет (`hasPermission=false`) → кнопка disabled с подсказкой и запрос НЕ уходит; Given день не сдан → кнопки нет вовсе.
6. - [x] **AC-6 (фронт: диалог).** When кнопка, Then модальный `<dialog>` с полями «Причина» и «Санкция»; «Подтвердить» disabled, пока любое из полей пусто после trim; Esc и «Отмена» закрывают диалог БЕЗ запроса; ровно один POST на `/{id}/amend/` c телом `{reason, sanction}` (id = текущая submission из day-state; запёрто тестом — ни actor, ни triggered_by_status_id в теле нет).
7. - [x] **AC-7 (фронт: успех).** When 201, Then панель показывает состояние ИЗ ОТВЕТА: «версия N+1», бейдж «Пересдача», время; причина/санкция отображаются (локально из формы до рефетча); `['day-state']` инвалидирован; диалог закрыт; кнопка «Подтвердить» disabled на `isPending`.
8. - [x] **AC-8 (фронт: ошибки по кодам).** Given 400 → сообщение об отклонённой форме ВНУТРИ диалога (ввод не потерян); Given 409 `DAY_ALREADY_SUBMITTED` → НЕ тупик: invalidate day-state + «состояние обновлено»; Given 422 `NO_SUBMISSION_TO_AMEND` → баннер с сообщением бэка + invalidate; Given 403/404 → баннер; ни один код НЕ открывает ConflictDialog и НЕ уходит в generic-тост; 401 — цепь 8.6 мимо панели.
9. - [x] **AC-9 (фронт: версии различимы).** Given submitted-строка v1 → «версия 1» БЕЗ бейджа пересдачи; Given v2/AMENDED → бейдж «Пересдача» + «версия 2» + `eventLabel` даёт человекочитаемое «пересдано…» (НЕ сырой `AMENDED`) + строки «Причина/Санкция» из `detail.amendment`; различимость запёрта одним тестом с обеими строками.
10. - [x] **AC-10 (фронт: протухшая сводка).** Given `detail.summary.status == "STALE"` с непустыми осями, Then маркер «Сводка протухла» (`role="alert"`) с построчной детализацией superseded (имя ребёнка из `divisions`-словаря, «пин vN → текущая vM»), missing и unpinned; Given `FRESH` → тихая пометка «Сводка актуальна» (не alert); Given `summary == null` → ни маркера, ни пометки.
11. - [x] **AC-11 (фронт: deferred-фиксы 10.3).** (а) Given панель показывает `submittedNow` v1 и рефетч принёс серверную v2, Then рендерятся серверные версия/время/drift (v2), не локальный застывший 201; (б) Given мутация в полёте и оператор сменил подразделение, When 201 прежней дивизии прилетает, Then панель НОВОЙ дивизии НЕ показывает «сдано/пересдано» чужого ответа (гард division_id).
12. - [x] **AC-12 (фронт: supersedesLabel с годом).** Given цепочка выпусков через границу года (№5/2026 ← «взамен №247/2025»), Then журнал 10.5 рендерит «взамен исх.№ 247/2025» — год различает одноимённые номера смежных лет.
13. - [x] **AC-13 (гейты).** `make gate` из `Backend/VAPS` зелёный; `npm run gate` из `frontend` зелёный; существующие сюиты 10.3 (`test_day_state_api.py`, `DaySubmissionPanel.test.tsx`), 5.8b (`test_daily_submission_amend_api.py`) и 10.5 (expense-report) зелёные (правки — только там, где AC этой стори их меняют); `makemigrations --check` чисто (миграций нет — API/UI-стори).

## Technical Tasks

- [x] **Task 1 (RED, бэк):** `Backend/VAPS/apps/operations/submissions/tests/test_day_state_amendment_api.py` — AC-1..3 (amendment-блок на v1/v2/несдан; summary null/FRESH/STALE/missing; NFR-пин на двух размерах; отсутствие triggered_by_status_id). Сюита реально красная (KeyError/assert по отсутствующим полям ответа) ДО реализации.
- [x] **Task 2 (бэк, API):** `DayStateAmendmentSerializer` + `DayStateSummarySerializer` (+вложенные оси) в `api/serializers.py`; `DayStateDetailSerializer` — поля `amendment`/`summary` (`allow_null=True`); `day_state`-view — заполнение обоих блоков в detail-ветке (amendment — из уже загруженной `submissions`-map; summary — `summary_freshness(division_id, business_date)`); `@extend_schema`-description дополнить. Никаких новых permission/матричных строк.
- [x] **Task 3 (бэк, схема):** `make schema`; `npm run generate:api`.
- [x] **Task 4 (RED, фронт):** `DaySubmissionPanel.test.tsx` (AC-5..11, msw: 201/400/409/422/403) + `dayState.test.ts` (defensive-чтение amendment/summary, деривация server-vs-submittedNow) + `expenseReport.test.ts` (AC-12 кросс-годовой лейбл). Красная фаза до реализации.
- [x] **Task 5 (фронт, dayState):** `dayState.ts` — типы amendment/summary из `schema.d.ts`, `SelectedDayState.submitted` + `amendment`/`summary`, defensive-ридеры (зеркало `readDrift`), правило «серверная строка побеждает при `server.version >= local.version`».
- [x] **Task 6 (фронт, панель):** `DaySubmissionPanel.tsx` — кнопка с гейтом `daily_report.correct`, `AmendRequestDialog` (в том же файле, зеркало `SubmitPreviewDialog`), amend-мутация с каналами AC-8, бейдж версии/причина/санкция (AC-9), маркер сводки (AC-10), гарды AC-11 (server-priority деривация + division-гард в onSuccess обеих мутаций).
- [x] **Task 7 (фронт, expense-report):** `supersedesLabel` → «взамен исх.№ N/год»; обновить существующие ассерты формата в тестах 10.5.
- [x] **Task 8 (трекинг):** deferred-work.md — отметить закрытыми L667 (submittedNow), L668 (гонка 201), L681 (supersedesLabel год); L674 (preview_event enum) — явно «не триггерится 10.6, причина» в самой defer-строке.
- [x] **Task 9 (гейты):** `make gate` из `Backend/VAPS` (5433; занят чужим контейнером → НЕ трогать чужое, изолированный postgres:16 на 5434, vaps/vaps/vaps, `VAPS_DB_PORT=5434`, эквивалент отметить в стори — прецеденты 10.1a–10.5) + `npm run gate` из `frontend`; `ruff format` — только по изменённым файлам; File List vs `git diff --name-only 826b022..HEAD` (ретро-AI-3) ДО ревью.

## Files To Create

- `Backend/VAPS/apps/operations/submissions/tests/test_day_state_amendment_api.py`

## Files To Modify

- `Backend/VAPS/apps/operations/submissions/api/serializers.py` — amendment/summary-сериализаторы detail
- `Backend/VAPS/apps/operations/submissions/api/views.py` — заполнение блоков в `day_state`
- `Backend/VAPS/schema.yaml` — REGEN (`make schema`)
- `frontend/src/shared/api/schema.d.ts` — REGEN (`npm run generate:api`)
- `frontend/src/features/daily-grid/dayState.ts` — типы/ридеры/деривация
- `frontend/src/features/daily-grid/dayState.test.ts`
- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx` — amend-флоу, бейджи, маркер сводки, гарды
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx`
- `frontend/src/features/expense-report/expenseReport.ts` — supersedesLabel с годом
- `frontend/src/features/expense-report/expenseReport.test.ts` / `ExpenseReportPage.test.tsx` — ассерты формата
- `_bmad-output/implementation-artifacts/deferred-work.md` — статусы defer'ов

_(Объём > 5 файлов — осознанно, прецедент 10.3/10.4/10.5: экранная стори E10 везёт тонкое API-расширение; всё делимое вынесено в Out of Scope: роуты сводки, rebuild-UI, журнал версий, эскалация санкции.)_

## Dependencies

- Depends on: 5.4a/5.8b (amend_day + POST /{id}/amend/ — done), 5.11 (summary_freshness — done), 5.9 (аудит DAILY_SUBMISSION_AMENDED — done, эмитится сервисом), 10.3 (панель + day-state — done), 10.5 (журнал/supersedes + прецедент permission-гейта кнопки — done), 8.4–8.6 (client/useApiMutation/usePermissions/401-цепь — done).
- Blocks: 10.10 (e2e-флоу может шагать по пересдаче), будущие стори «роуты/UI сводки», «журнал версий дня».
- НЕ зависит от: 10.4 ultra-ревью (readiness-tree не трогается), 10.7/10.8.

## Dev Notes (ground truth — из кода worktree, НЕ из error-codes.yaml/макетов)

- **Amend-поверхность готова целиком** (`api/views.py::DailySubmissionViewSet.amend`, 5.8b): `POST /api/operations/daily-submissions/{id}/amend/`, `permission_map["amend"] = "daily_report.correct"`; порядок: форма-400 (DRF: required/blank/whitespace → 400; sanction >255 → 400) → резолв pk (`by_id`: мусор/фантом → 404 ENTITY_NOT_FOUND) → `ensure_division_scope` 403 по РЕЗОЛВЛЕННОЙ дивизии (pk-existence раскрывается раньше scope — осознанный trade-off 5.8b) → `amend_day`. 201 = `DailySubmissionSerializer` (id, division_id, business_date, version, is_current, event, submitted_by, submitted_at, late — БЕЗ reason/sanction/snapshot).
- **`amend_day`** (`services/amendment_service.py`): пересобирает СВЕЖИЙ снапшот из БД (не копия v1), `version = latest+1`, flip-before-insert, event=AMENDED, `late=False`; 422 `NO_SUBMISSION_TO_AMEND` если ни одной версии; конкурентная пересдача → IntegrityError → 409 `DAY_ALREADY_SUBMITTED` (CONSTRAINT_ERROR_MAP). Аудит `DAILY_SUBMISSION_AMENDED` эмитится СЕРВИСОМ (5.9) — фронту/вью ничего аудировать не надо. Пины `sources` сводки едут verbatim (НЕ ре-пиновка) — освежение пинов = `rebuild_summary` (вне scope).
- **`summary_freshness`** (`services/summary_service.py:273`): чистое чтение, `None` | `SummaryFreshness(status, superseded, missing, unpinned)`; `STALE` ⇔ хоть одна ось непуста; бюджет 4 канала чтения, инвариантно числу детей. Протухание по уровням, не транзитивно (докстринг модуля). HTTP-поверхности у сводки НЕТ ни read, ни write — эта стори добавляет ТОЛЬКО read-проекцию freshness внутрь day-state.
- **day-state view уже держит всё нужное:** `current_for_many` возвращает ПОЛНЫЕ строки (defer("snapshot") — только у `list`-селектора), так что `current.reason`/`current.sanction`/`current.event` в detail-ветке бесплатны; freshness — один доп. вызов сервиса только в detail-режиме.
- **Перевыпуск «взамен» уже встроен в выпуск** (`document_release_service.py:256-315`): prev той же (division, date) c `submission_version < locked.version` → prev `SUPERSEDED` (+аудит DOCUMENT_SUPERSEDED), новый `supersedes=prev`, `reason = locked.reason` (потому reason выпуска amended-сдачи непуст). 409 `DOCUMENT_ALREADY_ISSUED` — только при повторе ТОЙ ЖЕ версии сдачи. Экран 10.5 это уже обслуживает — 10.6 не трогает.
- **Права (seed_operations.py, ground truth):** `daily_report.correct` — ТОЛЬКО DIVISION_OPERATOR (+ADMIN `*`); ORGD/OMD НЕ несут ни correct, ни mark_update (на `/day` не попадают — роут гейтен mark_update). Epics-персона «руководитель» ↔ seed расходятся → Q-персона (policy, не стоп).
- **Панель 10.3 — канон, который НЕ ломать:** remount по `key={businessDate}` (смена даты = новый цикл), деривация `selected` (автовыбор единственного), `keepPreviousData`+`isPlaceholderData`-гвард, `gcTime: Infinity` list-ключа, reset() при смене селекта, dirty-гейт сдачи. Amend-мутация — ВТОРАЯ мутация панели: у неё свой reset при смене селекта/даты; division-гард AC-11(б) ставить в onSuccess ОБЕИХ.
- **Фронт-канон:** типы только из `schema.d.ts` (ARCH-FE-011); каналы ошибок ARCH-FE-015 (все amend-коды non-overridable — не в `OVERRIDABLE_CODES` → `mutation.error`; ветвить по `error.errorCode`); ESLint boundaries: daily-grid НЕ импортирует expense-report и наоборот (Task 7 — отдельный файл фичи 10.5, связи нет).
- **Ловушка контракта (ревью 10.1 P2):** не изобретать полей сверх фактических сериализаторов — никаких «статус заявки», «согласование», «ожидает подтверждения» из мокапов: amend синхронный, «запрос пересдачи» = сама пересдача (201 сразу несёт v+1).
- **Ловушка ревью:** бэкап мутируемых файлов красных проб — `cp`, НИКОГДА `git checkout` (инцидент 9.6).

## Открытые вопросы (Д-дефолты приняты, НЕ стопы; policy — Bratan)

- **Q-персона:** epics называет актёра «руководитель», но `daily_report.correct` по seed несёт только DIVISION_OPERATOR (и роут `/day` гейтен mark_update, которого у ORGD нет). Д: UI гейтится ПРАВОМ, не ролью; seed не трогать. Если пересдачу должен запускать именно руководитель — грант ORGD (и вопрос доступа к `/day`) решает Bratan.
- **Q-формат-supersedes:** Д: «взамен исх.№ N/год» (year уже в ответе; зеркало формата «Исх.№ N/год» из `issueLabel`). Формат подтвердить у Bratan (defer 10.5 просил «решить формат с Bratan»).
- **Q-сводка-amend:** кнопка пересдачи доступна и на строке-сводке (endpoint легален; пины едут verbatim) — Д: не блокировать по типу строки; полноценный rebuild-UI со свежими пинами — отдельная стори.
- **Q-санкция-подсказка:** содержательных требований к тексту санкции в коде нет (только непустота/255). Д: свободный ввод с placeholder; словарь/шаблоны санкций — по решению Bratan.

## Tests

- Unit (бэк): amendment/summary-блоки detail через API-тесты (сериализаторы отдельно не гоняются — thin-проекции).
- Integration (бэк): `test_day_state_amendment_api.py` — AC-1..3 (v1/v2/несдан; сводка null/FRESH/STALE/missing; `assertNumQueries` на двух размерах; отсутствие `triggered_by_status_id` в ответе).
- Unit (фронт): `dayState.test.ts` — defensive-ридеры amendment/summary, «серверная строка побеждает» (AC-11а как чистая деривация).
- Component (фронт): `DaySubmissionPanel.test.tsx` — AC-5..11 (msw: 201/400/409/422/403; гейт кнопки; диалог; бейджи версий; STALE/FRESH/null-маркер; division-гард). `expenseReport.test.ts` — AC-12.
- Manual: `/day` под DIVISION_OPERATOR — сдать день, пересдать с причиной/санкцией (версия 2, бейдж), под родителем со сводкой — увидеть STALE после пересдачи ребёнка; `/reports` — перевыпустить расход, в журнале «взамен исх.№ N/год».

## Review-гейт: красные пробы (бинарный DoD, ретро E9 AI-1)

Каждая проба: `cp`-бэкап → мутация прод-кода → целевой тест ПОКРАСНЕЛ → откат. Зелёная проба = ассерт вакуумен = стори не done.

- (а) **amendment-блок:** отдавать `amendment: null` безусловно (не читать event) → AC-1-тест v2 красный.
- (б) **свежесть сводки:** заглушить вызов `summary_freshness` (всегда `null`) ИЛИ хардкодить `FRESH` → AC-2/AC-10-тесты красные.
- (в) **NFR-пин:** звать `summary_freshness`/`current_for` в цикле по видимым (или в list-режиме) → AC-3-тест красный.
- (г) **Гейт кнопки:** убрать `hasPermission("daily_report.correct")`-гейт → AC-5-тест красный.
- (д) **Валидация диалога:** убрать disabled по пустым reason/sanction → AC-6-тест красный.
- (е) **409 = состояние:** убрать invalidate на `DAY_ALREADY_SUBMITTED` → AC-8-тест красный.
- (ж) **Различимость версий:** убрать бейдж/лейбл AMENDED (сырой код события) → AC-9-тест красный.
- (з) **Division-гард:** убрать сверку `data.division_id === selected` в onSuccess → AC-11(б)-тест красный.
- (и) **Server-priority:** вернуть безусловный приоритет `submittedNow` → AC-11(а)-тест красный.

## Definition of Done

- [x] Код реализован (Task 1–9), TDD: RED-фазы Task 1/4 реально краснели до реализации (см. Dev Agent Record — RED-протокол)
- [x] Все AC покрыты тестами и зелёные
- [x] Красные пробы (а)–(и) исполнены и запротоколированы (мутация → красный → откат) — см. Review Findings; проба (е) вскрыла вакуумный 422-ассерт (запатчен RED→GREEN)
- [x] `make gate` из `Backend/VAPS` зелёный (5433 занят чужим `masterqalakz-db_test-1` → эквивалент на 5434: ruff check + pytest 2346 passed + makemigrations --check — см. Dev Agent Record)
- [x] `npm run gate` из `frontend` зелёный
- [x] `make schema` + `npm run generate:api` прогнаны, обе половины схемы в диффе
- [x] `ruff format` — только по изменённым файлам (3 файла; переформатирован только новый тест)
- [x] File List сверен с `git diff --name-only 826b022..HEAD` (ретро-AI-3), чекбоксы = фактический код
- [x] Архгварды целы: operations↛core.models (только core-селекторы), features↛features/app, Admin/seed/RBAC-матрица не тронуты, list-проекция DailySubmissionSerializer не расширена
- [x] Defer'ы L667/L668/L681 отмечены закрытыми в deferred-work.md; L674 — «не триггерится» с причиной
- [x] Нет новых зависимостей, нет хардкод-секретов
- [x] Status → review; секция Review Findings заполняется ревью

## Environment

- Тестовая БД: Postgres из `Backend/VAPS/docker-compose.yml` на `:5433`. Если порт занят чужим контейнером (напр. `masterqalakz-db_test-1`) — НЕ останавливать чужое; поднять изолированный `postgres:16` на `:5434` (креды vaps/vaps/vaps) и гонять pytest/spectacular с `VAPS_DB_PORT=5434`; эквивалент `make gate` отметить в стори (прецеденты 10.1a–10.5).

## Dev Agent Record

### Implementation Plan (как реализовано)

- **Бэк (Task 1–3):** `DayStateAmendmentSerializer` + `DayStateSummarySerializer` (+вложенные `DayStateSummarySuperseded/Missing`) в `api/serializers.py`; `DayStateDetailSerializer` дополнен `amendment`/`summary` (`allow_null=True`). Во view detail-ветка: amendment — из уже загруженной `current_for_many`-map (`current.reason/sanction` при `event == AMENDED`, доп. запросов 0); summary — один вызов `summary_freshness(division_id, business_date)` только в submitted-detail-ветке (в preview-ветке НЕ зовётся: map уже сказала `current is None` — сервис вернул бы None тем же чтением). Точечный импорт `summary_freshness` из `services.summary_service` (Д8 5.11: сводка сознательно не экспортируется через `services/__init__`).
- **Схема (Task 3):** `make schema` + `npm run generate:api`; `DayStateAmendment`/`DayStateSummary*` в обеих половинах.
- **Фронт dayState (Task 5):** типы `AmendDayRequest`/`AmendDayResponse` из `schema.d.ts`; `SelectedDayState.submitted` + `amendment`/`summary`; defensive-ридеры `readAmendment`/`readSummary` (зеркало `readDrift`); `resolvePanelState` — чистая server-priority деривация (`server.version >= local.version` → серверная строка); `summaryRows` — оси STALE в строки с резолвом имён по `divisions`-словарю (fallback id).
- **Фронт панель (Task 6):** кнопка «Запросить пересдачу» в submitted-ветке (`usePermissions().hasPermission('daily_report.correct')`; без права — disabled + title-подсказка, не скрыта); `AmendRequestDialog` в том же файле (зеркало `SubmitPreviewDialog`: `<dialog>`+showModal, guard `.open`, Esc/onCancel; textarea «Причина» + input «Санкция» maxLength=255 + предупреждение о версии N+1/снапшоте/«взамен»; «Подтвердить» disabled при пустых после trim И на isPending). Amend-мутация: тело ровно `{reason, sanction}` (submissionId — только в URL); каналы AC-8: 400 — в диалоге (диалог не закрывается, ввод жив), 409 `DAY_ALREADY_SUBMITTED`/422 `NO_SUBMISSION_TO_AMEND` — invalidate + сообщение/баннер, 403/404 — баннер `ApiError`, 5xx/сеть — тост хука, 401 — цепь 8.6. Бейдж «Пересдача» при `version >= 2 || event === 'AMENDED'`; `eventLabel('AMENDED') → «пересдано (amendment)»`; строки «Причина/Санкция» — серверный `detail.amendment`, до рефетча — локальная мета формы, привязанная к версии. Маркер сводки: STALE → `role="alert"` + оси, FRESH → тихая «Сводка актуальна», null → ничего. Гарды AC-11: `resolvePanelState` (а) + division-гард `data.division_id === selectedRef.current` в onSuccess ОБЕИХ мутаций (б); смена селекта сбрасывает и amend-цикл (reset, диалог, мета).
- **Фронт expense-report (Task 7):** `supersedesLabel` → «взамен исх.№ N/год»; кросс-годовой тест; обновлены ассерты формата 10.5 (2 строки ExpenseReportPage.test.tsx + 1 expenseReport.test.ts).
- **Трекинг (Task 8):** deferred-work.md — L667/L668/L681 «ЗАКРЫТ (10.6)», L674 — «НЕ ТРИГГЕРИТСЯ в 10.6» с причиной (amendment не проходит через preview).

### RED-протокол (TDD)

- **Task 1 (бэк):** `test_day_state_amendment_api.py` до реализации — 7/9 упали `KeyError: 'amendment'/'summary'` (AC-1/AC-2 целиком). 2 теста (`test_list_mode_detail_stays_null`, `test_detail_query_count_invariant_to_children`) зелёные до реализации ПО ПОСТРОЕНИЮ — пины инвариантов «ничего не сломано/не N+1», их красная фаза — ревью-пробы (в).
- **Task 4 (фронт):** до реализации — dayState.test.ts 11 failed (отсутствующие экспорты + новые поля вью-модели), DaySubmissionPanel.test.tsx 18/18 новых failed (нет кнопки/диалога/бейджа/маркера/гардов), expenseReport 3 failed (формат года). Все существующие тесты в красной фазе оставались зелёными.

### Решения и отклонения

1. **`@extend_schema` на amend-экшене** — формально сверх литеры «единственное изменение API — day-state»: БЕЗ аннотации amend в схеме был дегенератом (`requestBody: never`, 200 без тела), и AC-4 («типы фронта только из schema.d.ts, ручных дублей нет») был невыполним — тело `{reason, sanction}` пришлось бы дублировать руками. Аннотация не меняет поведение роута (зеркало create), только схему. Существующая сюита 5.8b зелёная байт-в-байт.
2. **`summary_freshness` НЕ зовётся в preview-ветке** (день не сдан): `current_for_many`-map уже дала `current is None` — сервис тем же чтением вернул бы `None`; `summary: null` ставится без лишнего канала чтения (NFR-4). В submitted-ветке — один вызов как в спеке (дубль-чтение current_for внутри сервиса принято).
3. **`selectedRef` синхронизируется эффектом**, не присваиванием в рендере — ESLint-гейт `react-hooks/refs` (Cannot access refs during render); для async-колбэков мутаций эквивалентно (эффект коммитится до прихода сетевого ответа).
4. **Порт БД:** 5433 занят чужим `masterqalakz-db_test-1` — гейт бэка прогнан эквивалентом `make gate` на изолированном `vaps-db-5434` (`VAPS_DB_PORT=5434`): `ruff check .` чисто → pytest `-m "not property and not concurrency and not slow and not golden"` **2346 passed** → `makemigrations --check` чисто. Прецедент 10.1a–10.5.
5. **`npm run gate` зелёный целиком:** deps-gate, schema-check, tsc -b, eslint, lint-canon, schema-check.test, vitest **403 passed (32 файла)**, vite build, size-gate 172.8 KB gzip ≤ 300 KB.
6. **Красные пробы (а)–(и) НЕ исполнялись** — это бинарный гейт ревью-шага (ретро E9 AI-1); DoD-чекбокс оставлен пустым честно.
7. `ruff format` — точечно по 3 изменённым py-файлам; переформатирован только новый тест (2 line-join), прод-файлы не тронуты форматтером.

### File List (сверено с `git diff --name-only 826b022..HEAD` + untracked)

- `Backend/VAPS/apps/operations/submissions/tests/test_day_state_amendment_api.py` (NEW)
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (MOD — amendment/summary-сериализаторы detail)
- `Backend/VAPS/apps/operations/submissions/api/views.py` (MOD — заполнение блоков в day_state; @extend_schema amend — отклонение №1)
- `Backend/VAPS/schema.yaml` (REGEN)
- `frontend/src/shared/api/schema.d.ts` (REGEN)
- `frontend/src/features/daily-grid/dayState.ts` (MOD)
- `frontend/src/features/daily-grid/dayState.test.ts` (MOD)
- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx` (MOD)
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx` (MOD)
- `frontend/src/features/expense-report/expenseReport.ts` (MOD)
- `frontend/src/features/expense-report/expenseReport.test.ts` (MOD)
- `frontend/src/features/expense-report/ExpenseReportPage.test.tsx` (MOD — 2 ассерта формата)
- `_bmad-output/implementation-artifacts/deferred-work.md` (MOD — Task 8)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MOD — трекинг)
- `_bmad-output/implementation-artifacts/10-6-amendment-флоу-ui.md` (этот файл)

### Change Log

- 2026-07-16: Story 10.6 реализована (dev-story, Fable 5): amendment/summary-блоки day-state (бэк+схема), amend-флоу панели (кнопка+гейт, диалог, каналы ошибок, бейдж версий, маркер сводки), фиксы defer'ов 10.3 (server-priority, division-гард), supersedesLabel с годом. Гейты: бэк 2346 passed (эквивалент на 5434), фронт 403 passed. Status → review.

## Review Findings

Проход 1 (bmad-code-review, 2026-07-16, три слоя в одной ревью-сессии Fable 5 — same-model caveat; дифф = uncommitted против `826b022`).

### Вердикты слоёв

- **Blind Hunter:** блокеров нет. Кандидаты («двойной баннер 400», «selectedRef отстаёт») опровергнуты кодом — см. dismiss. Транзитная связка «локальный 201 v2 + серверный светофор v1» до рефетча — принятый паттерн 10.3, не дефект.
- **Edge Case Hunter:** 1 реальная находка — вакуумный ассерт инвалидации в 422-тесте (см. patch, вскрыто пробой (е)); 2 defer (вакуумные `before` в 10.3-тестах того же файла; серверный `unsubmitted` не гасит локальный 201 — сценарий отзыва сдачи без API/UI). Санитария подтверждена: `Event.AMENDED`-сравнение со str-колонкой корректно (TextChoices), оси freshness JSON-сериализуемы (str/int), ключи `summaryRows` уникальны по построению (оси дизъюнктны).
- **Acceptance Auditor: ACCEPT.** AC-1..13 сверены с фактическим кодом и тестами построчно; чекбокс-дрейф НЕ найден; File List = `git status` против 826b022 (13 M + 2 новых, байт-в-байт). Отклонения Dev Agent Record №1–3 правомерны: №1 `@extend_schema` на amend — без него AC-4 невыполним (дегенерат `requestBody: never`), поведение роута не тронуто, сюита 5.8b зелёная; №2 пропуск `summary_freshness` в preview-ветке — семантика идентична (сервис вернул бы `None` тем же чтением `current_for`, которое map уже сделала), NFR-положительно; №3 `selectedRef` эффектом — для асинхронных сетевых колбэков эквивалентно присваиванию в рендере (эффект коммитится до макротаска ответа), ESLint-гейт `react-hooks/refs` не оставляет альтернативы.

### Счёт: 0 decision · 1 patch · 2 defer · 2 dismiss

- **PATCH (применён, RED→GREEN):** три вакуумных `before`-захвата счётчика инвалидации в 10.6-тестах панели (AC-7 успех, AC-8 409, AC-8 422): `before = urls.length` снимался ДО initial-фетчей (list+detail), и порог `> before + 1` удовлетворялся стартовой парой запросов БЕЗ инвалидации — проба (е) оставила 422-тест зелёным. Захват перенесён после посадки фетчей (`openAmendDialog` дождался кнопки), порог → `> before`. RED-подтверждение: с мутацией (е) оба теста 409/422 красные; после отката — файл целиком зелёный (41 passed).
- **DEFER:** (1) тот же вакуумный класс в 10.3-тестах L510/L536 того же файла — вне scope 10.6; (2) серверный `unsubmitted` не гасит локальный 201 в `resolvePanelState` (сценарий отзыва сдачи, у которого нет ни API, ни UI). Оба — в deferred-work.md §10.6.
- **DISMISS:** (1) «двойной баннер 400 при открытом диалоге» — `ValidationError.kind === 'validation' ≠ 'api'`, внешний баннер не рендерится (подтверждено 400-тестом: сообщение только внутри диалога); (2) «selectedRef-эффект может отстать от ответа сети» — эффект коммитится синхронно после рендера, ответ сети — макротаск; окна нет.
- **Policy (Bratan, зафиксировано, НЕ стопы):** Q-персона (грант `daily_report.correct` для ORGD — seed не тронут), Q-формат «взамен исх.№ N/год» (Д-формат принят, подтвердить), Q-сводка-amend (кнопка не блокируется по типу строки), Q-словарь санкций (свободный ввод).

### Красные пробы (а)–(и) — бинарный гейт, все исполнены (`cp`-бэкап → мутация → красный → откат байт-в-байт)

| Проба | Мутация | Результат |
|---|---|---|
| (а) amendment ≡ null (event не читается) | `views.py` | КРАСНАЯ: test_amendment_block_on_amended_current + test_summary_null_on_plain_submission |
| (б-бэк) freshness ≡ null | `views.py` | КРАСНАЯ: 3 AC-2-теста (stale/fresh/missing) |
| (б-фронт) STALE-маркер заглушён | `DaySubmissionPanel.tsx` | КРАСНАЯ: 2 STALE-теста AC-10 |
| (в) per-child `current_for` в detail-ветке (N+1) | `views.py` | КРАСНАЯ: test_detail_query_count_invariant_to_children |
| (г) гейт права снят (`canAmend = true`) | `DaySubmissionPanel.tsx` | КРАСНАЯ: AC-5 «без права — disabled» |
| (д) disabled по пустым полям снят | `DaySubmissionPanel.tsx` | КРАСНАЯ: AC-6 «Подтвердить disabled при пустых» |
| (е) invalidate на 409/422 снят | `DaySubmissionPanel.tsx` | КРАСНАЯ 409; 422 остался ЗЕЛЁНЫМ → вакуумный ассерт → patch; после патча ОБА красные |
| (ж1) AMENDED-лейбл снят (сырой код) | `DaySubmissionPanel.tsx` | КРАСНАЯ: AC-9 |
| (ж2) бейдж «Пересдача» снят | `DaySubmissionPanel.tsx` | КРАСНАЯ: AC-9 |
| (з) division-гард onSuccess снят | `DaySubmissionPanel.tsx` | КРАСНАЯ: AC-11(б) |
| (и) server-priority снят (локальный 201 всегда) | `dayState.ts` | КРАСНАЯ: 2 юнита resolvePanelState + AC-11(а) панели |

Откаты: `cmp` подтвердил идентичность всех трёх мутированных файлов dev-версии (бэкапы `cp` в scratchpad; `git checkout` не использовался).

### Финальные гейты (после патча)

- Бэк (эквивалент `make gate` на изолированном 5434, 5433 занят чужим `masterqalakz-db_test-1`): `ruff check .` чисто → pytest **2346 passed** → `makemigrations --check` чисто; целевая сюита 10.6 — 9 passed.
- Фронт `npm run gate` целиком: deps-gate, schema-check, tsc -b, eslint, lint-canon, vitest **403 passed (32 файла)**, vite build, size-gate 172.8 KB gzip ≤ 300 KB.

Status → done.
