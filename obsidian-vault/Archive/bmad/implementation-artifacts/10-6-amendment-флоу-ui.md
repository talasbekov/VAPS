---
baseline_commit: |
  101cc01 (HEAD на момент написания спеки; chore(graphify) поверх 39dd517
  «story-11.5: kill-switch WS» и ad59582 «story-10.5: экран расхода»).
  ⚠️ Пока писалась спека, в этот же worktree закоммитились две параллельные
  стори. Разбор поверхностей вёлся на ad59582; проверено, что 11.5 тронула
  только `Backend/VAPS/apps/notifications/**`, `config/settings.py` и свои
  артефакты, а 101cc01 — только `graphify-out/**`. Ни один файл, на который
  опирается 10.6 (`features/daily-grid/**`, `shared/api/**`, `shared/auth/**`),
  не изменился ⇒ все цитаты `file:line` ниже действительны на 101cc01.
  Коммит стори **ограничивать путями** — чужую историю не переписывать.
  Стори фронтовая целиком: `Backend/**` НЕ трогается, `schema.d.ts`/`schema.yaml`
  НЕ трогаются (это 10.1c).
prerequisite: |
  Частичный блокер по данным — epic-AC 10.6 состоит из ТРЁХ обещаний, и третье
  сегодня невыполнимо ни одной строкой фронта:
    1. «UI ведёт через причину+санкцию» — ГОТОВО к реализации.
       `POST /api/operations/daily-submissions/{id}/amend/` живой (5.8b),
       право `daily_report.correct` заведено (seed_operations.py:18).
    2. «версии v1/v2 различимы» — ГОТОВО. `GET ?division_id&business_date`
       возвращает ВСЕ версии дня (селектор по `is_current` не фильтрует).
    3. «протухшая сводка помечена» — ❌ **ПОВЕРХНОСТИ НЕТ**. `summary_freshness`
       /`assemble_summary`/`rebuild_summary` (5.11) не экспортированы из
       `submissions/services/__init__.py` (`__all__` :17-27), не подключены ни к
       одному view/url/serializer, в `schema.d.ts` нет ни `summary`, ни
       `freshness`, ни `sources`. Это тот же класс блокера, что гейтил 10.4 на
       10.3a. Backfill вынесен в поимённых преемников **10.6a** (бэк-роут
       свежести) → **10.6b** (UI-метка) — см. §«Что вынесено и почему».
  Вывод: стори НЕ заблокирована, но её скоуп УЖЕ epic-AC. Дев-агент обязан
  прочитать §«Что вынесено» ДО написания кода и не рисовать метку сводки.
context:
  - _bmad-output/planning-artifacts/epics.md#L1186-1192 (Story 10.6 — AC эпика, три строки)
  - _bmad-output/planning-artifacts/architecture.md#L290 (ARCH-DATA-021 — amendment-flow, санкция) · #L294 (фрактальность: «пересдача внизу протухает сводку — видимо, не молча») · #L235-242 (ARCH-FE-010…015) · #L375 (Glossary: «Amendment»; Resubmission/Retake/Correction ЗАПРЕЩЕНЫ)
  - Backend/VAPS/apps/operations/submissions/api/views.py:88,128-137,186-219 · api/serializers.py:24-38,51-72,82-90 · services/amendment_service.py:40,51,94,106 · services/scope_gate.py:41-43 (ЕДИНСТВЕННЫЙ источник кодов и shape'ов — сверено с raise-сайтами, не со словарём)
  - Backend/VAPS/apps/operations/submissions/models/daily_submission.py:60-63,66-94,132-138 (Event, поля, CHECK на reason/sanction)
  - frontend/src/features/daily-grid/daySubmission.ts:1-20,24-61,237-263 · DaySubmissionPanel.tsx:14-23,106-158,264-321 (панель-предшественник; 10.6 НАЗВАНА в её шапке)
  - _bmad-output/implementation-artifacts/10-3-экран-сдачи-дня.md (Решения №1/№5/№7, красная проба 5/5, ревью HIGH про «активную обманку»)
  - _bmad-output/implementation-artifacts/10-5-экран-расхода.md#L385-397,#L399-404,#L509-515 (красная проба как гейт, четыре ловушки окружения, ревью Fable 5)
  - _bmad-output/implementation-artifacts/5-8b-api-amend-сдачи.md (Д1 семантика цепочки, ЛОВУШКИ №2/№3/№4)
  - _bmad-output/implementation-artifacts/5-11-фрактальная-сводка.md#L24,#L85,#L97,#L111 (семантика STALE/FRESH/None — для 10.6b, не для этой стори)
  - _bmad-output/implementation-artifacts/deferred-work.md#L322 (прочие пути ретро-правки amendment НЕ триггерят — в UI-копии не обещать)
  - _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L72-74 (AI-1 красная проба = гейт; AI-3 сверка File List с git diff)
---

# Story 10.6: Amendment-флоу UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор подразделения с правом `daily_report.correct`**,
I want **на уже сданном дне запросить исправление сдачи, назвав причину и санкцию, и увидеть, что появилась новая версия, а прежняя осталась в истории**,
so that **поправка проходит видимым путём: у каждой версии есть автор, время и основание, а не «день молча переписали»**.

## Acceptance Criteria

**AC-1 · Вход в флоу есть ровно там, где он законен.**
**Given** день сдан (`current !== null`) и у актора есть право `daily_report.correct`,
**Then** в панели сдачи есть кнопка **«Исправить сдачу»**.
**Given** день НЕ сдан, **Then** кнопки нет (амендить нечего).
**Given** права `daily_report.correct` нет, **Then** кнопки нет — но 403 с сервера всё равно обработан (AC-6) как backstop: скрытие кнопки не заменяет обработку отказа.

**AC-2 · Форма собирает РОВНО два поля, оба обязательные.**
**Given** открытая форма исправления,
**Then** в ней textarea «Причина» и однострочное поле «Санкция»;
**And** кнопка подтверждения неактивна, пока хоть одно поле пусто после `trim()`;
**And** у санкции виден счётчик и предел **255** символов (зеркало `CharField(max_length=255)`);
**And** правило «10–500 символов» из `ConflictDialog` сюда **НЕ переносится** — у amendment такого правила нет.

**AC-3 · Отправка — одна, тело — РОВНО `{reason, sanction}`.**
**Given** заполненная форма, **When** оператор подтверждает,
**Then** уходит `POST /api/operations/daily-submissions/{id}/amend/`, где `{id}` — `id` действующей версии дня;
**And** тело содержит только `reason` и `sanction` (обрезанные `trim()`);
**And** `triggered_by_status_id`, `submitted_by`, `division_id`, `business_date` в теле **отсутствуют**;
**And** двойной клик и повторное подтверждение дают **один** POST (гард `isPending`).

**AC-4 · Успех виден как новая версия.**
**Given** ответ **201** с 9-полевой проекцией,
**Then** панель показывает «День сдан: v{version} · Исправлено» с автором и временем из ответа;
**And** форма закрыта;
**And** инвалидированы оба ключа: `['day-submission', divisionId, businessDate]` и `['division-submissions', divisionId]`;
**And** наблюдаемый эффект инвалидации — **перечитанный список версий** (AC-5): шапка «День сдан: v2» рисуется из локального ответа и от инвалидации не зависит;
**And** фикстура 201 обязана отличаться от пропа v1 по ВСЕМ трём осям — `version: 2`, `event: 'AMENDED'`, другой `submitted_by`, — иначе ассерт сравнивает состояние с самим собой и переживёт удаление `onSuccess` (класс «сравнение с самим собой», ретро E9);
**And** экран НЕ обещает `reason`/`sanction` в ответе — 201 их не возвращает (Д2 5.8b), показываем то, что отправили, из локального состояния.

**AC-5 · Версии дня различимы.**
**Given** у дня больше одной версии,
**Then** панель показывает список версий за эту дату — `v{n} · {событие} · {время} · {автор}`, действующая помечена словом (не только цветом, `DESIGN.md:366,371`);
**And** источник — уже существующий запрос дня `['day-submission', divisionId, businessDate]` (фильтр по дате точный, `is_current` не фильтруется ⇒ приходят ВСЕ версии). Новый запрос заводить **запрещено**;
**And** порядок — как отдаёт бэк (`-business_date, -version, id`), своей сортировки не заводим.

**AC-6 · Отказы объясняют себя, каждый своим каналом.**
**Given** ответ сервера, **Then** ветвление по `status`, затем по `errorCode` (порядок как в `describeSubmitFailure`):
| ответ | поведение |
|---|---|
| `403 PERMISSION_DENIED` | фикс-текст про право `daily_report.correct`; **не** `error.message` — бэк кладёт в `message` **сам код** (`DomainError.message = message or code`; DRF-путь — `PermissionDenied("PERMISSION_DENIED")`, `core/api/permissions.py:15,18,60`), т.е. оператор увидел бы «PERMISSION_DENIED». Фикстура 403 обязана нести `message: 'PERMISSION_DENIED'` — как на проводе |
| `404 ENTITY_NOT_FOUND` | «Сдача не найдена.» + перечитка состояния дня; форма закрывается той же производной, что у 409 |
| `400 VALIDATION_ERROR` | сообщение + детали по полям (`parseValidationDetails`) |
| `409 DAY_ALREADY_SUBMITTED` | гонка версий: перечитать состояние дня (`invalidateQueries` **в эффекте** — это не `setState`, прецедент `DaySubmissionPanel.tsx:153-158`); форма закрывается **чистой производной в рендере**, не стейтом: `const formOpen = amending && failure?.kind !== 'conflict' && failure?.kind !== 'not-found'`. ⚠️ Гард `confirming && current === null` из панели сдачи здесь **неприменим**: после гонки день остаётся сданным (`current !== null`), и форма не закрылась бы никогда. `setState` в эффекте и в рендере — оба eslint **error**. **`ConflictDialog` НЕ открывать** — кода нет в `OVERRIDABLE_CODES` |
| `5xx`, `401`, обрыв сети | `silent` — уже обслужены тостом `useApiMutation` и цепью logout |

**AC-7 · Клавиатурный путь.**
**Given** фокус на кнопке «Исправить сдачу», **When** пройти форму только с клавиатуры (`userEvent.tab()` + ввод + `Enter`/`Space` на кнопке отправки),
**Then** MSW-счётчик POST равен **1**, а тело равно `{reason, sanction}` (NFR-8: «RTL keyboard-path в DoD формо-стори», `architecture.md:262`).
⚠️ Ассерт — на **отправленном запросе**, не на `document.activeElement`: «фокус куда-то встал» — известная вакуумная форма (инциденты 9.9, 11.4).

**AC-8 · Красная проба — ГЕЙТ, не отчёт (AI-1 ретро E9).**
Каждый несущий ассерт обязан покраснеть от точечной мутации. В Dev Agent Record — построчно «мутация X → тест Y покраснел». Зелёная проба = вакуумный ассерт = стори **не** `done`.
Обязательный минимум мутаций:
1. убрать гард `isPending` → тест двойного клика;
2. снять `trim()` перед проверкой пустоты → тест пробельной причины;
3. убрать инвалидацию `['day-submission', …]` → тест **«после 201 в списке версий видны ОБЕ версии (v1 и v2)»**. ⚠️ НЕ «видна новая версия»: шапка рисуется из локального ответа (AC-4) и от инвалидации не зависит — такая проба осталась бы зелёной. Красит только СПИСОК (AC-5), живущий в query-кэше. Фикстура GET дня обязана быть последовательной (счётчик вызовов в хендлере): до POST — `[v1]`, после — `[v2(is_current), v1]`; иначе перечитка вернёт дефолтный пустой конверт `handlers.ts:200` и тест покраснеет по инфраструктуре, а не по логике;
4. заменить фикс-текст 403 на `error.message` → тест 403 (фикстура несёт `message: 'PERMISSION_DENIED'`);
5. убрать фильтр по `business_date` в списке версий → тест «версии чужого дня не показываются». Фикстура здесь **намеренно противоречит бэку** (сервер фильтрует по дате сам) — она пинит гард от смены пропа, а не поведение API; в контрактных утверждениях её не использовать.
⚠️ Бэкап правленых файлов — `cp` в scratchpad, **никогда `git checkout`** (урок 9.6: сотрёт незакоммиченные правки).

## Tasks / Subtasks

- [x] **Task 1 — Чистая модель `amendment.ts` (AC-2, AC-3, AC-6)**
  - [x] Создать `frontend/src/features/daily-grid/amendment.ts` — ни React, ни `apiClient` (тестируется в env `node`)
  - [x] Шапка файла обязана объяснить, почему тип рукописный: `operations_daily_submissions_amend_create` в `schema.d.ts:2560-2579` имеет `requestBody?: never` и 200 `content?: never`, тогда как живой view отдаёт **201** — схема пуста ⇒ ARCH-FE-011 не нарушен. Прецедент — `daySubmission.ts:1-20`. Замещается схемными типами в **10.1c**
  - [x] `export type DayAmendBody = { reason: string; sanction: string }` — **`type`, не `interface`** (индекс-сигнатура для `TVariables`, ловушка 10.3/10.5)
  - [x] `SANCTION_MAX = 255`; чистый валидатор — `reason.trim().length > 0 && sanction.trim().length > 0 && sanction.trim().length <= SANCTION_MAX`. **Меряем ПОСЛЕ `trim()`**: DRF `trim_whitespace=True` отрабатывает в `to_internal_value` до `MaxLengthValidator`, поэтому 260 символов с 10 хвостовыми пробелами бэк принимает — наивный валидатор по сырой длине заблокировал бы законное значение
  - [x] Кейс 256 символов держать в **юнит**-тесте `amendment.test.ts`: если в Task 2 на поле стоит `maxLength={255}`, в компоненте он недостижим, и компонентный тест под него был бы мёртвым
  - [x] Канон-строки модульными константами с ссылкой на источник (как `EVENT_LABELS`, `PERMISSION_MESSAGE`)
  - [x] `describeAmendFailure(error: ApiFailure)` — порядок ветвления **дословно** как в `daySubmission.ts:237-263`: `kind === 'network'` первым (у `NetworkError` нет `.status`), затем по `status`, внутри 409 — по `errorCode`, в хвосте `other` как catch-all (405/406/415/429 приходят без конверта, `errorCode === null`)
  - [x] Тесты `amendment.test.ts` (env `node`, кириллические фикстуры — латиница даёт зелень на сломанном коде)

- [x] **Task 2 — Компонент формы `DayAmendmentForm.tsx` (AC-2, AC-7)**
  - [x] Создать `frontend/src/features/daily-grid/DayAmendmentForm.tsx` — **инлайн-панель, НЕ модалка** (Решение №5 стори 10.3: модальность в jsdom не эмулируется, модальный ассерт был бы вакуумным до e2e)
  - [x] `ConflictDialog` **не использовать**: amendment — не override-путь (`error-codes.yaml:130` — «НЕ override»), а ARCH-FE-015 запрещает свои override-диалоги, но не запрещает форму причины на своём пути. Прецедент отдельной формы причины — 10.5a
  - [x] Разметка — `<form onSubmit={…}>` с кнопкой `type="submit"`. Без `<form>` `Enter` не отправляет ничего: у панели-прецедента все кнопки `type="button"` и формы нет (`DaySubmissionPanel.tsx:267,303,311`). В `textarea` `Enter` — перевод строки, поэтому клавиатурный путь AC-7 идёт либо `tab()` до кнопки + `Enter`/`Space`, либо implicit submission из однострочной «Санкции»
  - [x] Поля через `useId()` + `<Label htmlFor>` + `<Input>`/textarea; ошибки — `role="alert"`
  - [x] Кнопка подтверждения `disabled` пока валидатор Task 1 не пропустил; кнопка «Отмена» закрывает форму
  - [x] Тесты `DayAmendmentForm.test.tsx` — `// @vitest-environment jsdom` **первой строкой** файла (Vitest 4 убрал `environmentMatchGlobs`), `afterEach(cleanup)`, `import '@testing-library/jest-dom/vitest'`

- [x] **Task 3 — Врезка в панель сдачи (AC-1, AC-3, AC-4, AC-6)**
  - [x] `DaySubmissionPanel.tsx`: кнопка «Исправить сдачу» в блоке сданного дня; гейт — `hasPermission('daily_report.correct')` из `shared/auth/usePermissions`
  - [x] `useApiMutation<DaySubmission, DayAmendBody>` c `mutationFn: (v) => apiClient.post(...)`; URL строится от `current.id` — **`{id}` адресует ЦЕПОЧКУ** `(division_id, business_date)`, а не конкретную версию (Д1 5.8b): даже устаревший pk амендит тот же день
  - [x] `onSuccess`: сохранить ответ в локальный стейт (как `submitted` для сдачи), закрыть форму, инвалидировать **оба** ключа
  - [x] Сброс состояния при смене дня/подразделения — **ремаунт по `key`** на экране (уже есть, `DailyUpdatePage.tsx:555`), **не** `setState` в эффекте (`react-hooks/set-state-in-effect` — eslint **error**)
  - [x] Обновить строку 409 в `daySubmission.ts:248-254`: путь пересдачи теперь не только назван, но и проходим — текст не должен утверждать, что кнопки нет.
        ⚠️ Текст запинен **тремя** ассертами: `DaySubmissionPanel.test.tsx:309,362` (полная строка дословно) и `daySubmission.test.ts:262` (`toContain('День уже сдан')`). Менять синхронно с ними; сохранить префикс «День уже сдан» дешевле, чем править три места
  - [x] Расширить `DaySubmissionPanel.test.tsx`

- [x] **Task 4 — Список версий дня (AC-5)**
  - [x] `DailyUpdatePage.tsx`: рядом с `daySubmission` прокинуть в панель **весь** разобранный список новым пропом. Владелец запроса остаётся ЭКРАН (Решение №7 стори 10.3) — второй `useQuery` с тем же ключом заводить запрещено
  - [x] Разбор — **одним** мемо, не двумя: сейчас на `:219-222` уже есть `currentSubmission(parseSubmissionList(...))`. Свести к `const daySubmissions = useMemo(() => parseSubmissionList(daySubmissionQuery.data), [daySubmissionQuery.data])` и дальше `currentSubmission(daySubmissions)` — один разбор, одна идентичность, без лишних ре-рендеров панели
  - [x] Прогнать `vitest run src/features/daily-grid/DailyUpdatePage.test.tsx` **до** правок панели и записать baseline-счётчик в Dev Agent Record: список версий может сломать существующие ассерты неоднозначностью (ловушка №8)
  - [x] В панели отрисовать версии за дату; действующую пометить словом
  - [x] Отфильтровать по `business_date` явно: запрос уже точечный, но фильтр — защита от смены пропа и предмет мутации №5

- [x] **Task 5 — Красная проба (AC-8) и гейт**
  - [x] Пять мутаций из AC-8 + все прочие несущие ассерты; каждая — записью в Dev Agent Record
  - [x] `npm run gate` **из папки `frontend/`** (из корня vitest молча возьмёт чужой конфиг → ложный красный)
  - [x] Сверить File List с `git diff --name-only` до ревью (AI-3 ретро E9); чекбоксы ставить только по факту кода

## Dev Notes

### 🚨 Что вынесено из скоупа и почему (читать ДО кода)

**«Протухшая сводка помечена» — третья треть epic-AC — в этой стори НЕ делается.**
`summary_freshness` (5.11) существует как сервис и НЕ имеет HTTP-поверхности:
не в `__all__` (`submissions/services/__init__.py:17-27`), не подключён ни к
одному view/url, в `schema.d.ts` нет ни `summary`, ни `freshness`, ни `sources`.
Сама стори 5.11 это фиксирует: «Сервис-слой без API/RBAC (Д8) … роуты — будущая
стори» (`summary_service.py:34`).

Это ровно тот класс фантома, на котором 10.5 обожглась с `supersedes`, а 10.1 —
с `MARKS_INCOMPLETE` (урок: сверять с raise-сайтом, а не со словарём/макетом).
Поимённые преемники заведены в `sprint-status.yaml`:
- **10.6a** — бэк: роут свежести сводки (`@extend_schema` + сериализатор
  `SummaryFreshness`: `status` FRESH/STALE + три оси `superseded`/`missing`/`unpinned`);
- **10.6b** — UI: метка протухшей сводки поверх 10.6a.

Дев-агент **не** рисует метку сводки, **не** выводит её из светофора и **не**
изобретает клиентский `summary_freshness`. Свежесть пинов — **отдельная ось от
цвета светофора** (`5-11:97`): сводка, которая есть, — «сдана» ⇒ не RED, при этом
пины могут быть протухшими. Вывести одно из другого нельзя.

**Также вне скоупа:**
| Что | Почему | Преемник |
|---|---|---|
| `reason`/`sanction` исторических версий | список даёт 9 полей без них; нужен `GET /{id}/` (13 полей) на каждую версию — N+1 | **10.6c** |
| `snapshot`-дифф между версиями | требует клиентского `resolve_status` — реинвент серверной логики | 10.1b |
| «взамен исх.№» в расходе после amendment | `IssuedDocument.supersedes` нет ни в одном сериализаторе | 10.5b → 10.5c |
| Серверный drift-маркер подразделения | роут не построен | 10.3c → 10.3b |
| `@extend_schema` для `DailySubmissionViewSet` + regen | `schema-check.mjs` сверяет байт-в-байт ⇒ трогать `schema.d.ts` **нельзя** | 10.1c |
| Правило «санкция выше после ухода расхода наверх» | forward-seam: автоматической эскалации нет нигде, санкция — свободный текст | — |
| Флейк `DailyGrid.perfsmoke` `window is not defined` | пред-существующий, воспроизводится и без стори | test-hygiene |

**И отдельно — чего UI не должен обещать словами:** amendment триггерят **только**
ретро-правки через хук 3.9 (`resolve_pending_clarification`). `update_status`,
`complete_status_early`, `extend_status`, `cancel_status`, увольнение под сданным
днём amendment **не** вызывают (`deferred-work.md:322`, осознанный скоуп 5.4b).
Копия вида «любая правка задним числом создаст исправление» была бы ложью.

### Живой контракт бэка (сверено с raise-сайтами, не со словарём)

```
POST /api/operations/daily-submissions/{id}/amend/     views.py:186-219
  право: daily_report.correct                          views.py:88,132
  scope: ensure_division_scope(actor, право, submission.division_id)  views.py:203-205
  тело:  {reason: CharField(), sanction: CharField(max_length=255)}   serializers.py:24-38
         оба required, allow_blank=False, trim_whitespace=True
         triggered_by_status_id НЕ принимается (ЛОВУШКА №4 5.8b — подделка провенанса)
         лишние поля игнорируются (ARCH-SEC-030: actor из auth-контракта)
  ответ: 201 CREATED, DailySubmissionSerializer — РОВНО 9 полей            views.py:216-219
         id, division_id, business_date, version, is_current, event,
         submitted_by, submitted_at, late
         version = prev+1 · event = "AMENDED" · is_current = true · late = false ВСЕГДА
         ⚠️ reason/sanction в ответе НЕТ (Д2 5.8b)
```

Коды отказов — только те, что реально достижимы по HTTP:

| код | HTTP | raise-сайт | сообщение бэка |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | DRF `is_valid(raise_exception=True)`, views.py:189 | «Проверьте заполнение формы.» |
| `PERMISSION_DENIED` | 403 | `scope_gate.py:41-43` + `permissions.py:15,18,60` | `message` = **сам код** (`DomainError.message = message or code`) ⇒ фикс-текст на фронте |
| `ENTITY_NOT_FOUND` | 404 | `views.py:194-199` | «Сдача не найдена.», `details={"submission_id": …}` |
| `DAY_ALREADY_SUBMITTED` | 409 | `CONSTRAINT_ERROR_MAP`, `exception_handler.py:32,37` | гонка двух amendment на один день |

⚠️ **`NO_SUBMISSION_TO_AMEND` (422) по этому роуту НЕДОСТИЖИМ** — существующий pk
гарантирует цепочку (ЛОВУШКА №3 5.8b; сам бэк-тест это фиксирует комментарием и
теста на него не пишет). Вакуумный тест под него писать **запрещено** (урок 5.7c).
То же для 404 `ENTITY_NOT_FOUND` из `amendment_service.py:94` — по HTTP не всплывает.

### Модель версий (что делает v1 и v2 различимыми)

`DailySubmission` (`models/daily_submission.py`): `version` (`PositiveIntegerField`,
`version >= 1` CHECK), `is_current` (partial-unique на `(division_id, business_date)
WHERE is_current`), `event ∈ {CONFIRMED_NO_CHANGES, CHANGED, AMENDED}`.
`superseded_by`/`supersedes` на модели сдачи **нет** — вытеснение выражено
`version` + `is_current`, и «цепочка» читается порядком, а не ссылкой. Не искать
поля, которого нет (класс ошибки 10.5).

Запись v2 — flip-before-insert в одной транзакции (`amendment_service.py:147-166`):
старая `is_current → False`, потом вставка новой. Для фронта это значит: после 201
в списке дня ровно одна `is_current`, а прежняя версия остаётся видимой.

### Что уже готово и переписывать НЕ надо (анти-реинвент)

| Нужно | Уже есть | Где |
|---|---|---|
| Тип сдачи, разбор списка, текущая версия | `DaySubmission`, `parseSubmissionList`, `currentSubmission` | `daySubmission.ts:27,119,137` |
| Подпись «Исправлено» | `EVENT_LABELS.AMENDED` | `daySubmission.ts:60` |
| Фикс-текст 403 (образец формы) | `PERMISSION_MESSAGE` | `daySubmission.ts:69-70` |
| Разбор `details` в строки | `parseValidationDetails` | `bulkErrors.ts` |
| Мутация + тост + 401 + конфликт | `useApiMutation` | `shared/api/useApiMutation.ts` |
| Проверка права | `const { hasPermission } = usePermissions()` — модульного экспорта `hasPermission` НЕТ, только деструктуризация; wildcard `*` (ADMIN) учтён внутри | `shared/auth/usePermissions.ts:27-49` |
| Строка «День сдан: v{n} · {событие}» | уже отрисована — достаточно, чтобы `current` стал ответом amendment | `DaySubmissionPanel.tsx:252-257` |
| Счётчик POST + тест двойного клика | хелпер `capturePost` и готовый тест | `DaySubmissionPanel.test.tsx:97-100,429` |
| Все версии дня | запрос `['day-submission', …]` уже точечный по дате и НЕ фильтрует `is_current` | `DailyUpdatePage.tsx:206-215` |
| Ремаунт-сброс | `key={divisionId}-{businessDate}` | `DailyUpdatePage.tsx:555` |

Ни новый роут в `shared/routes.ts`, ни новая feature-папка **не нужны**: флоу живёт
в панели сдачи на `/daily-expense`.

### Решения (ПРИНЯТО = A; менять осознанно и с записью)

1. **Где живёт код.** A: внутри `features/daily-grid/`. B: своя feature-папка.
   → **A**. ARCH-FE-013 запрещает `features/A → features/B`; из отдельной папки
   нельзя импортировать `daySubmission.ts` (типы, `EVENT_LABELS`, парсер) — пришлось
   бы либо дублировать, либо поднимать в `shared/`. Прецедент — `DaySubmissionPanel`
   (Решение №1 стори 10.3), который лёг в `daily-grid` по той же причине.
2. **Поверхность подтверждения.** A: инлайн-форма. B: `<dialog>`-модалка.
   → **A**. Модальность в jsdom не эмулируется, ассерт был бы вакуумным до e2e 10.10.
3. **Диалог конфликта.** A: свой. B: `ConflictDialog`.
   → **A**. `DAY_ALREADY_SUBMITTED` нет в `OVERRIDABLE_CODES` ⇒ `useApiMutation.conflict`
   по нему не поднимется и `ConflictDialog` физически не откроется. Amendment — это
   не override: `{reason, sanction}` ≠ `{override, override_reason}`.
4. **Источник версий.** A: существующий запрос дня. B: новый запрос истории.
   → **A**. `?division_id&business_date` уже возвращает все версии дня; второй запрос
   был бы лишней сетью и вторым владельцем кэша.
5. **Длина причины.** A: только «непусто после trim». B: 10–500 как у override.
   → **A**. Правило 10–500 — собственность `ConflictDialog`; бэк для amendment
   проверяет только непустоту (`_require_text`, `amendment_service.py:51-53`).
   Придуманный на фронте нижний предел отбивал бы законные короткие причины.

### Архитектурные правила (developer guardrails)

- **ARCH-FE-010** — состояние только TanStack Query + `useState`; дублировать кэш в `useState` нельзя (локальный «ответ последней мутации» — разрешённое исключение, прецедент `submitted` в панели)
- **ARCH-FE-011** — `schema.d.ts` не редактировать; рукописное зеркало легально **только** там, где схема пуста, и обязано это объяснить в шапке
- **ARCH-FE-013** — `features/A → features/B` запрещено; баррельные `index.ts` запрещены; новых папок верхнего уровня в `src/` не заводить (`no-unknown-files` — error)
- **ARCH-FE-014** — только токенные Tailwind-классы (`bg-amber-100 text-amber-800` и т.п.); `tailwindcss/no-custom-classname` — **error**; инлайн-стили и CSS-in-JS запрещены
- **ARCH-FE-015** — HTTP только через `apiClient` (`fetch`/XHR вне `shared/api/**` — eslint error); сырой `useMutation` в `features/**` запрещён; try/catch вокруг `mutate` запрещён
- **ARCH-FE-012** — литеральные пути маршрутов вне `routes.ts` — eslint error (на URL API это не распространяется)
- `react-hooks/set-state-in-effect` — **error**; сброс состояния делается ремаунтом по `key`
- Цвет никогда не единственный сигнал — состояние названо словами (`DESIGN.md:349,371`)
- snake_case на проводе end-to-end: `apiClient` имена не преобразует

### Ловушки окружения (споткнуться легко, отладка дорогая)

0. **⚠️ ГЛАВНАЯ: право в тестах не появляется само — нужны ДВЕ вещи.** `useMe` гейтится `enabled: credential !== null` (`usePermissions.ts:23`), а дефолтная фикстура прав (`handlers.ts:29`) содержит только `daily_report.mark_update` и `status.view` — **`daily_report.correct` в ней НЕТ**. Ни один тест в `features/daily-grid/` сегодня credential не ставит. Без обоих шагов `hasPermission('daily_report.correct')` возвращает `false` **всегда**, и позитивный тест AC-1 недостижим — дев решит, что гейт неверен, и либо выкинет проверку права, либо полезет править `handlers.ts` (запрещено). Прецедент — `features/expense/ExpenseReportPage.download.test.tsx:22,66,72`:
   ```ts
   import { setCredential, clearCredential } from '../../shared/auth/credential'
   beforeEach(() => {
     setCredential({ kind: 'dev', userId: 'operator-1' })
     server.use(
       http.get('*/api/operations/my-permissions/', () =>
         HttpResponse.json({ permissions: ['daily_report.mark_update', 'daily_report.correct'] }),
       ),
     )
   })
   afterEach(() => { cleanup(); clearCredential() })
   ```
   **Негативный тест AC-1 обязан ставить credential** и отдавать список **без** `daily_report.correct` — иначе он зелёный по отсутствию credential и про гейт не доказывает ничего.
1. **MSW-предикаты обязаны начинаться с `*`**: `'*/api/operations/daily-submissions/:id/amend/'`. В env `node` нет `location`, относительный путь молча не матчится.
2. **Дефолтный хендлер amend в `handlers.ts:236` отдаёт 409** — это протокольная фикстура 8.4/8.5, её используют `useApiMutation.test.tsx:208` и `client.test.ts:196`. **Менять дефолт нельзя** — перекрывать точечно через `server.use()`.
3. `onUnhandledRequest: 'error'` — любой незамоканный путь роняет тест.
4. Локальный `QueryClient` в рендер-хелпере обязан иметь `queries: { retry: false }`: `providers.tsx` гасит ретраи только у мутаций, иначе тест отказа висит ~7 с.
5. Обёртка `<ToastProvider>` обязательна — `useApiMutation` зовёт `useToast`.
6. **Не писать пути API внутри JSX-комментариев**: `*/` закрывает комментарий → `TS1005` (инцидент 10.5).
7. `@typescript-eslint/no-unused-vars` без `varsIgnorePattern`: идиома `const { x: _omit, ...rest }` **красит гейт**; префикс `_` не спасает.
8. Ассерты на тексте скоупить (`within(...)`) — одинаковая подпись версии легко совпадёт в двух местах, и незаскоупленный `findByText` упадёт на «found multiple».
9. Гейт — `npm run gate` **из `frontend/`**; e2e (`npm run test:e2e`) в гейт не входит.

### Previous Story Intelligence (10.5 → 10.6)

- Ревью 10.5 (HIGH) поймало **недостижимую ветку**: текст под 409 был нарисован, но попасть в него было нельзя, потому что чтение не инвалидировалось при отказе. Здесь тот же риск в AC-6: после 409 обязательна перечитка, иначе форма исправления зависнет над устаревшим состоянием.
- Ревью 10.3 (HIGH): после отказа открытая панель подтверждения пережила перечитку и осталась «активной обманкой»; ни один из 30 тестов не поймал, потому что тест 409 не обновлял проп. Здесь: после 409/404 форму закрывать, а её рендер гардить текущим состоянием дня.
- Класс «флаг переживает смену контекста» (10.2 → 10.4 → 10.5): намерение читать из **эффективного** состояния, не из ручного.
- Чекбокс-дрейф — трёхэпиковый паттерн: каждый `[x]` сверять с кодом, а не с намерением.
- Параллельные стори в одном worktree — норма (10.2↔11.1, 10.3↔11.2, 11.4↔10.4, 10.5↔11.5): коммит **ограничивать путями**, счётчики тестов сверять по SHA, а не «до/после».

### Project Structure Notes

Расположение — по факту дерева (`features/{auth, daily-grid, expense, print-forms, traffic-light}`), а не по `architecture.md:545-555`, где фича названа `submissions/`: расхождение имён зафиксировано на 10.3 и не переименовывается в этой стори.

**Files To Create**
- `frontend/src/features/daily-grid/amendment.ts`
- `frontend/src/features/daily-grid/amendment.test.ts`
- `frontend/src/features/daily-grid/DayAmendmentForm.tsx`
- `frontend/src/features/daily-grid/DayAmendmentForm.test.tsx`

**Files To Modify**
- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx`
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx`
- `frontend/src/features/daily-grid/DailyUpdatePage.tsx`
- `frontend/src/features/daily-grid/daySubmission.ts` (только текст 409)
- `frontend/src/features/daily-grid/daySubmission.test.ts` (ассерт текста 409, `:262`)
- `frontend/src/features/daily-grid/DailyUpdatePage.test.tsx` — **только если** список версий ломает существующие ассерты неоднозначностью (ловушка №8); решается прогоном из Task 4, не заранее

**Не трогать:** `schema.d.ts`, `schema.yaml`, `Backend/**`, `shared/routes.ts`, `shared/api/testing/handlers.ts` (дефолт 409 — чужая фикстура), `app/App.tsx`, `app/section-stubs.tsx` (нового маршрута нет).

### Tests

- **Unit (env `node`, `amendment.test.ts`):** валидатор (пусто / пробелы / 255 / 256 символов); `describeAmendFailure` по каждой строке таблицы AC-6, включая `network` без `.status` и `errorCode === null`.
- **Component (jsdom, `DayAmendmentForm.test.tsx`):** кнопка неактивна при пустых полях; активна при заполненных; счётчик санкции; «Отмена» закрывает; клавиатурный путь (AC-7).
- **Integration (jsdom, `DaySubmissionPanel.test.tsx` + MSW):** кнопки нет на несданном дне; кнопки нет без права (**с** credential и списком без `daily_report.correct` — см. ловушку №0); 201 → «v2 · Исправлено» и перечитанный список версий; двойной клик = один POST (`capturePost`); 403/404/400/409 по AC-6; список версий за дату, действующая помечена; версии чужой даты не показываются.
- **Обязательный сетап прав** в каждом файле, где рендерится кнопка: `setCredential(...)` в `beforeEach` + `clearCredential()` в `afterEach` + `server.use()` с нужным списком прав. Без него все позитивные тесты AC-1 недостижимы.
- **Фикстуры — кириллические.** Версии в фикстуре различаются и `version`, и `event`, и автором: одинаковые строки сделали бы ассерт AC-5 вакуумным (класс «сравнение с самим собой», ретро E9).
- **Красная проба:** минимум пять мутаций из AC-8, с записью результата каждой.

### Definition of Done

- [x] Код реализован; чекбоксы сверены с `git diff --name-only`
- [x] Тесты добавлены и проходят
- [x] Красная проба выполнена и записана построчно (AC-8)
- [x] `npm run gate` зелёный из `frontend/`
- [x] Секретов нет; `schema.d.ts`/`Backend/**` не тронуты
- [x] Метка протухшей сводки **не** реализована и не обещана в UI-копии

### Открытые вопросы (Bratan — к решению; ни один НЕ блокирует dev-story)

1. **Канон-строк для amendment не существует** (`EXPERIENCE.md:97-120` их не содержит, бумажного контракта экрана нет). Предлагаемые: кнопка «Исправить сдачу», заголовок формы «Исправление сдачи», подтверждение «Исправить сдачу за {дата}?», поля «Причина» / «Санкция». Утвердить или заменить.
2. **Кто санкционирует — РЕШЕНО по seed, не блокер.** Право `daily_report.correct` посеяно ровно двум ролям: `DIVISION_OPERATOR` (`seed_operations.py:66`) и `ADMIN` через `*` (`:51`). Epic пишет «As a руководитель» (`epics.md:1188`) — расхождение спеки и seed. Реализуем **по seed**; вопрос Bratan'у — надо ли править формулировку эпика на ретро. Дев на этом не останавливается.
3. **Список допустимых санкций** нигде не задан — поле свободное ≤255. Нужен ли справочник — вопрос этапа 2.
4. **Показывать ли причину/санкцию исторических версий** (требует `GET /{id}/` на версию). Вынесено в 10.6c; подтвердить приоритет.
5. **Несохранённые правки грида исправление НЕ блокируют** (наблюдение В QA-прогона, зафиксировано e2e-тестом №9). Гард `dirtyCount > 0` принадлежит сдаче; аргумент AC-4 стори 10.3 («снапшот снимается с СЕРВЕРНОГО состояния») формально применим и к amendment. Дыра продукта или осознанная граница — решить на ревью эпика; кодом 10.6 не решается.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1186-1192] — AC эпика 10.6
- [Source: _bmad-output/planning-artifacts/epics.md#L697-716] — 5.4a/5.4b, семантика v1→v2→v3
- [Source: _bmad-output/planning-artifacts/epics.md#L782] — 5.8b, право и гард
- [Source: _bmad-output/planning-artifacts/epics.md#L802-809] — 5.11, «пересдача внизу протухает сводку»
- [Source: _bmad-output/planning-artifacts/architecture.md#L290] — ARCH-DATA-021
- [Source: _bmad-output/planning-artifacts/architecture.md#L294] — фрактальность сводки
- [Source: _bmad-output/planning-artifacts/architecture.md#L235-242] — ARCH-FE-010…015
- [Source: _bmad-output/planning-artifacts/architecture.md#L262] — RTL keyboard-path в DoD формо-стори
- [Source: _bmad-output/planning-artifacts/architecture.md#L375] — Glossary: «Amendment»
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py#L88,L186-219] — роут, право, 201
- [Source: Backend/VAPS/apps/operations/submissions/api/serializers.py#L24-38,L51-72] — тело и проекция
- [Source: Backend/VAPS/apps/operations/submissions/services/amendment_service.py#L40,L51,L94,L106] — raise-сайты
- [Source: Backend/VAPS/apps/operations/submissions/services/scope_gate.py#L41-43] — 403 без message
- [Source: Backend/VAPS/apps/operations/submissions/models/daily_submission.py#L60-63,L132-138] — Event, CHECK
- [Source: frontend/src/features/daily-grid/daySubmission.ts#L1-20,L57-61,L237-263] — зеркало, ярлыки, ветвление отказов
- [Source: frontend/src/features/daily-grid/DaySubmissionPanel.tsx#L14-23,L106-158] — границы 10.3, ключи кэша
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx#L206-222,L550-565] — владелец запроса дня, ремаунт
- [Source: _bmad-output/implementation-artifacts/5-8b-api-amend-сдачи.md] — Д1/Д2, ЛОВУШКИ №2/№3/№4
- [Source: _bmad-output/implementation-artifacts/5-11-фрактальная-сводка.md#L24,L85,L97] — FRESH/STALE/None, отдельная ось от светофора
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L322] — прочие пути правки amendment не триггерят
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L72-74] — AI-1/AI-3

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`, bmad-dev-story, TDD (red-green-refactor).

### Debug Log References

**Baseline-счётчики (сняты ДО правок, на HEAD `101cc01`):**

| прогон | до стори | после стори |
|---|---|---|
| `DailyUpdatePage.test.tsx` (ловушка №8) | **33 passed** | 34 passed (+1 новый тест пробы №3) |
| `src/features/daily-grid/` целиком | — | 303 passed (17 файлов) |
| `npm run gate` из `frontend/` | — | **675 passed, 45 файлов; tsc + eslint + build + size-gate зелёные** |

Список версий существующие ассерты экрана **не сломал** — неоднозначности (ловушка №8)
не возникло, защитные правки `DailyUpdatePage.test.tsx` не потребовались.
Флейк `DailyGrid.perfsmoke` (`window is not defined`) в этом прогоне **не воспроизвёлся**.

**Ловушка №0 подтверждена эмпирически:** без `setCredential` запрос `['me']` не уходит
вовсе (`enabled: credential !== null`), и `hasPermission('daily_report.correct')`
возвращает `false` всегда. Позитивные тесты AC-1 недостижимы без ДВУХ шагов.
Негативный тест ставит credential и получает **дефолтный** список прав
(`handlers.ts:29` — без `correct`), поэтому доказывает гейт, а не отсутствие сетапа.

### Completion Notes List

#### Красная проба (AC-8) — построчно: мутация → тест → результат

Бэкап правленых файлов — `cp` в scratchpad, `git checkout` НЕ применялся (урок 9.6).
После проб все четыре файла посимвольно сверены с бэкапом (`diff` — чисто).

| № | мутация | тест | итог |
|---|---|---|---|
| **1** | снят `!isPending` в `canSubmit` (`DayAmendmentForm.tsx:55`) | `AC-3: двойное подтверждение при isPending → РОВНО один POST` | 🔴 **красный** |
| **2** | снят `.trim()` перед проверкой пустоты причины (`amendment.ts`) | `причина из одних пробелов → false` + `AC-2: причина из одних ПРОБЕЛОВ…` | 🔴 **2 красных** |
| **3** | убрана инвалидация `['day-submission', …]` в `onSuccess` amendment | `10.6 AC-4/AC-8: …в списке версий видны ОБЕ версии` (тест ЭКРАНА) | 🔴 **красный** |
| **4** | фикс-текст 403 заменён на `error.message` | `403 → ФИКС-текст…` (юнит) + `AC-6: 403 → ФИКС-текст…` (панель) | 🔴 **2 красных** |
| **5** | убран фильтр по `business_date` в списке версий | `AC-5: версии ЧУЖОГО дня в списке не показываются` | 🔴 **красный** |
| **6** | снят гейт `hasPermission('daily_report.correct')` | `AC-1: права daily_report.correct НЕТ → кнопки нет` | 🔴 **красный** |
| **7** | `amendFormOpen = amending` (форма не закрывается на 409/404) | `AC-6: 404 → …форма ЗАКРЫТА` + `AC-6: 409 → …форма закрыта` | 🔴 **2 красных** |
| **8** | снят `setAmended(data)` в `onSuccess` | `AC-4: 201 → «День сдан: v2 · Исправлено»…` | 🔴 **красный** |
| **9** | URL собран от константы вместо `current.id` | `AC-3: URL адресует id ДЕЙСТВУЮЩЕЙ версии дня` | 🔴 **красный** |
| **10** | тело отправляется без `trim()` | `AC-3: onSubmit получает тело РОВНО…` + `AC-3: тело POST — РОВНО…` | 🔴 **2 красных** |

**Контрольная (обратная) проба к №3 — предупреждение AC-8 подтверждено дословно.**
Под мутацией №3 тест панели `AC-4: 201 → «День сдан: v2 · Исправлено»` остался
🟢 **ЗЕЛЁНЫМ**: шапка рисуется из локального ответа мутации и от инвалидации не
зависит. Красит только СПИСОК, живущий в query-кэше. Проба бьёт в верный ассерт.

#### ⚠️ Отклонения от спеки — ЭСКАЛИРУЮ, не «признаю и ставлю [x]»

**Отклонение 1 (несущее) — гард `isPending` остался в ОДНОМ месте, не в двух.**
Спека (Task 3 + прецедент `handleConfirm`) подразумевала гард в панели. Первая
проба показала, что так проба **вакуумна**: гард стоял и в панели
(`if (amendMutation.isPending) return`), и в форме (`canSubmit = complete &&
!isPending`), они взаимно перекрывались, и удаление **любого из двух** оставляло
тест двойного клика 🟢 зелёным (проверено обоими прогонами — оба зелёные).
Гард, который не краснеет ни от одной мутации, не защищён ни одним тестом.
Решение: единственный владелец — **форма** (ей принадлежат и кнопка, и implicit
submission; тело приходит в панель только от неё). Гард в панели снят, причина
записана комментарием в коде на месте снятия. После этого проба №1 — красная.
**К подтверждению на ревью.**

**Отклонение 2 — `DailyUpdatePage.test.tsx` изменён, хотя спека разрешала трогать
его «только если список версий ломает существующие ассерты».** Ассерты он не
сломал (33 → 33). Файл изменён по ДРУГОЙ причине: туда добавлен тест-мишень
пробы №3. Инвалидация наблюдаема **только** у владельца запроса (экран,
Решение №7): в панельном тесте список приходит статичным пропом, «перечитку»
пришлось бы имитировать ручным `rerender`, и такая проба пережила бы удаление
`invalidateQueries` — то есть была бы вакуумной по построению. Требование AC-8
(«фикстура GET дня обязана быть последовательной, со счётчиком вызовов»)
исполнимо только на экране; счётчик `dayReads` в тесте это и делает.

**Отклонение 3 — `daySubmission.test.ts` НЕ изменён**, хотя числился в Files To
Modify. Причина ровно та, что предсказала спека: префикс «День уже сдан» сохранён,
поэтому `toContain('День уже сдан')` (`:262`) продолжает проходить. Дословные
ассерты `DaySubmissionPanel.test.tsx:309,362` обновлены синхронно с текстом.

**Отклонение 4 (мелкое) — `role="alert"` для ошибок формы живёт в ПАНЕЛИ,
не в форме** (`data-testid="day-amend-failure"`). Форма своих ошибок не знает:
мутацией владеет панель, и отказ разбирается там же. Разметка полей (`useId()` +
`<Label htmlFor>` + `<Input>`/textarea) — как предписано.

#### Что реализовано

- **Task 1** — `amendment.ts`: `DayAmendBody` (`type`, не `interface` — индекс-сигнатура
  для `TVariables`), `SANCTION_MAX = 255`, `isAmendmentComplete` (меряет ПОСЛЕ `trim()` —
  зеркало DRF `trim_whitespace=True` перед `MaxLengthValidator`), `describeAmendFailure`
  с порядком ветвления дословно как `describeSubmitFailure`. Шапка объясняет, почему
  тип рукописный: `schema.d.ts:2560-2579` даёт `requestBody?: never` и 200 `content?:
  never`, живой view отдаёт 201 ⇒ схема пуста, ARCH-FE-011 не нарушен. 19 юнит-тестов
  (env `node`, кириллические фикстуры).
- **Task 2** — `DayAmendmentForm.tsx`: инлайн-панель (не модалка), настоящий `<form>`
  с `type="submit"` (иначе `Enter` не отправляет ничего), `useId()` + `<Label htmlFor>`,
  счётчик санкции + `maxLength={255}`. `ConflictDialog` не используется. 13 тестов.
- **Task 3** — врезка в `DaySubmissionPanel.tsx`: кнопка «Исправить сдачу» под гейтом
  `hasPermission('daily_report.correct')`, `useApiMutation<DaySubmission, DayAmendBody>`,
  URL от `current.id` (`{id}` адресует ЦЕПОЧКУ — Д1 5.8b), `onSuccess` сохраняет ответ
  локально + закрывает форму + инвалидирует ОБА ключа. Закрытие формы после 409/404 —
  **чистая производная в рендере** (`amending && !amendStale`), не `setState`:
  гард `current === null` из панели сдачи здесь неприменим (после гонки день остаётся
  сданным). Текст 409 в `daySubmission.ts` обновлён — путь пересдачи теперь проходим.
- **Task 4** — список версий: `DailyUpdatePage.tsx` разбирает список **одним** мемо
  (`daySubmissions`), `currentSubmission` считается от него же — один разбор, одна
  идентичность. Новый проп `submissions`; второй `useQuery` не заводился.
  Фильтр по `business_date` явный (предмет мутации №5), действующая версия помечена
  СЛОВОМ «действующая», порядок — как отдаёт бэк.
- **Task 5** — 10 мутаций + обратная контрольная проба, гейт зелёный.

#### Границы соблюдены

- Метка **протухшей сводки НЕ реализована и не обещана** в UI-копии: `summary_freshness`
  (5.11) HTTP-поверхности не имеет → 10.6a/10.6b. Из светофора не выводилась
  (отдельная ось, `5-11:97`).
- `reason`/`sanction` в ответе 201 **не обещаны** (Д2 5.8b) — тест это пинит явно.
- `NO_SUBMISSION_TO_AMEND` (422) отдельной ветки не получил — по HTTP недостижим
  (ЛОВУШКА №3 5.8b); вакуумный тест под него не писался (урок 5.7c).
- UI-копия **не** утверждает, что любая ретро-правка создаёт исправление
  (`deferred-work.md:322`).
- `schema.d.ts`, `schema.yaml`, `Backend/**`, `shared/routes.ts`, `handlers.ts`,
  `app/App.tsx` — **не тронуты** (подтверждено `git diff --name-only`).
- Секретов нет.

#### Открытые вопросы к Bratan (ни один не блокировал разработку)

1. **Канон-строки** — реализованы предложенные спекой: кнопка «Исправить сдачу»,
   заголовок формы «Исправление сдачи», подтверждение «Исправить сдачу за {дата}?»,
   поля «Причина»/«Санкция». Добавлена одна не названная в спеке: кнопка отправки —
   **«Подтвердить исправление»** (зеркало «Подтвердить сдачу»; одноимённая с
   открывашкой сделала бы RTL-запрос неоднозначным). Утвердить или заменить.
2. Право посеяно `DIVISION_OPERATOR` + `ADMIN` — реализовано **по seed**; расхождение
   с формулировкой эпика («As a руководитель») — на ретро.

### Senior Developer Review (AI)

**Ревьюер:** автономный review-цикл story-automator (Fable 5) · 2026-07-19
**Итог:** Changes Requested → все findings исправлены автоматически → **Approve**

Сверка выполнена против raise-сайтов и живого кода, каждый чекбокс — против
`git diff`; все 8 AC — IMPLEMENTED (доказательства: 46 jsdom-тестов стори +
9 e2e + пробы ниже). Отклонения 1–4 дев-агента рассмотрены и **подтверждены**
(по Отклонению 1 подтверждение получено собственной пробой: владелец гарда
`isPending` — форма). Отклонение 3 проверено прогоном: `daySubmission.test.ts:262`
зелёный без правки, префикс «День уже сдан» сохранён.

#### Findings

| # | Sev | Что | Исправление |
|---|---|---|---|
| 1 | **HIGH** | **Мёртвая кнопка «Исправить сдачу» после 409/404.** Форму держит закрытой производная `amending && !amendStale`, но `amending` остаётся `true`, а `amendMutation.error` очищается только следующим `mutate` — который возможен только из закрытой формы. Клик по кнопке бэйлаутится на уже-`true` `setAmending(true)`: флоу мёртв до смены дня/подразделения, при этом текст 409 зовёт «откройте исправление заново». Класс «активная обманка» (ревью 10.3). Формула производной взята из AC-6 дословно — дефект был заложен в самой спеке, ни один из 20 мутационных прогонов (дев+QA) не бил в повторный вход | `useApiMutation` расширен методом `reset()` (полный сброс к idle: error+data+conflict); открывашка вызывает `amendMutation.reset()` перед `setAmending(true)`. Тест-мишень: «после 409 кнопка … открывает форму ЗАНОВО» — **красный до фикса, зелёный после** (проба встроена в сам порядок работ) |
| 2 | MEDIUM | **Наблюдение Б QA подтверждено:** дубль-гард пустой формы (`disabled={!canSubmit}` + `if (!canSubmit) return` в `handleSubmit`) — вакуумная пара, `handleSubmit`-гард не защищён ни одним тестом ни в одной среде (implicit submission идёт ЧЕРЕЗ кнопку по умолчанию), а его комментарий утверждал обратное измеренному | Гард в `handleSubmit` снят; владелец — `disabled` на кнопке (зеркало Отклонения 1, правило «оставь одного владельца»). Тест `пустая форма + Enter` перефреймлен; проба ревью: мутация `disabled` → тест 🔴 (до правки эта же мутация оставляла его 🟢) |
| 3 | MEDIUM | `DailyUpdatePage.test.tsx`: `clearCredential()` стоял в хвосте тела теста — упавший до последней строки тест протащил бы credential в соседние тесты файла | Перенесён в `afterEach` файла |
| 4 | MEDIUM | File List стори не включал файлы QA-добора, видимые в `git status` (расхождение File List ↔ git, AI-3 ретро E9) | File List дополнен секцией QA-добора и секцией ревью (ниже) |
| 5 | LOW | `reset()` — новая поверхность shared-контракта, пин только через фичу | Прямой тест в `useApiMutation.test.tsx`: reset сбрасывает error/conflict к idle БЕЗ нового запроса |

Побочно закрыт хвост 400-ветки: залипший инлайн отказа после «Отмены»
теперь снимается тем же `reset()` при повторном входе.

**Наблюдение В QA** (dirtyCount не блокирует исправление) — продуктовая
граница, кодом не решалась; заведено Открытым вопросом №5.

#### Красная проба ревью (AC-8, гейт AI-1)

| мутация | тест | итог |
|---|---|---|
| фикс №1 отсутствует (код до правки) | `AC-6: после 409 кнопка … открывает форму ЗАНОВО` | 🔴 до фикса → 🟢 после |
| снят `disabled={!canSubmit}` (после снятия дубль-гарда) | `пустая форма + Enter → отправки НЕТ` | 🔴 (до ревью — 🟢: пара перекрывалась) |

Бэкап правленых файлов — `cp` в scratchpad, восстановление — `cp` обратно,
посимвольная сверка `diff` чистая; `git checkout` не применялся (урок 9.6).

#### Верификация

- `npm run gate` из `frontend/` — **зелёный: 677 passed, 45 файлов** (676 до
  reset-теста; +2 новых теста ревью к 675 дев-состояния), tsc + eslint +
  build + size-gate чистые.
- Playwright (вне гейта): `day-amendment.spec.ts` + `day-submission.spec.ts`
  — **14/14** после правок прод-кода (полные 44/44 сняты QA-прогоном).
- Чек-лист ревью пройден; MCP-doc-поиск не выполнялся — контракт бэка сверен
  по raise-сайтам репозитория (канон стори), внешних библиотек стори не вводит.

### Change Log

| Дата | Изменение |
|---|---|
| 2026-07-19 | Story 10.6 реализована: amendment-флоу UI (вход по праву `daily_report.correct`, форма причина+санкция, POST `/{id}/amend/`, новая версия и список версий дня, шесть каналов отказа). 4 файла созданы, 5 изменены. 45 новых тестов (19 юнит + 13 компонент + 12 интеграционных панели + 1 экрана). Красная проба: 10 мутаций, все красные, + обратная контрольная. `npm run gate` зелёный из `frontend/` (675 passed). Status → review. |
| 2026-07-19 | QA-добор (bmad-qa-generate-e2e-tests): 9 e2e (chromium, шестой харнес `day-amendment`), починен молча сломанный пин текста 409 в `e2e/day-submission.spec.ts` (Playwright вне гейта), 10 мутаций e2e — все красные. Наблюдения Б/В переданы ревью. `test:e2e` 44/44. |
| 2026-07-19 | Ревью (автономный цикл): HIGH — мёртвая кнопка «Исправить сдачу» после 409/404 (найдена тестом-мишенью до фикса, исправлена через `useApiMutation.reset()`); снят вакуумный дубль-гард пустой формы (наблюдение Б); `clearCredential` → `afterEach`; File List сверен с git; +3 теста (панель-переоткрытие, reset shared, перефрейм пустой формы). Гейт 677/45 зелёный, e2e 14/14. Status → done. |

### File List

**Созданы**
- `frontend/src/features/daily-grid/amendment.ts`
- `frontend/src/features/daily-grid/amendment.test.ts`
- `frontend/src/features/daily-grid/DayAmendmentForm.tsx`
- `frontend/src/features/daily-grid/DayAmendmentForm.test.tsx`

**Изменены**
- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx`
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx`
- `frontend/src/features/daily-grid/DailyUpdatePage.tsx`
- `frontend/src/features/daily-grid/DailyUpdatePage.test.tsx` (см. Отклонение 2)
- `frontend/src/features/daily-grid/daySubmission.ts` (только текст 409)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (трекинг: `in-progress` → `review`)

**Числился в Files To Modify, но НЕ изменён:** `frontend/src/features/daily-grid/daySubmission.test.ts` (см. Отклонение 3).

**QA-добор (bmad-qa-generate-e2e-tests, тот же день; полный отчёт —
`tests/test-summary-10-6.md`):**
- `frontend/e2e/day-amendment.spec.ts` (создан — 9 e2e)
- `frontend/e2e-harness/day-amendment.html` · `day-amendment.tsx` (созданы — шестой вход dist-e2e, credential до рендера)
- `frontend/e2e/day-submission.spec.ts` (изменён — пин текста 409 приведён к канону 10.6; Playwright вне гейта, промах был невидим)
- `frontend/vite.e2e.config.ts` (изменён — шестой input; ⚠️ файл ОБЩИЙ с 11.6: там же её preview-proxy, коммит ограничивать путями/хантами)
- `frontend/src/features/daily-grid/DayAmendmentForm.test.tsx` (правка имени/рамки теста пустой формы)

**Ревью (автономный цикл, тот же день):**
- `frontend/src/shared/api/useApiMutation.ts` (изменён — новый метод `reset()`)
- `frontend/src/shared/api/useApiMutation.test.tsx` (изменён — тест reset)
- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx` (фикс HIGH: `reset()` при открытии формы)
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx` (+1 тест переоткрытия после 409)
- `frontend/src/features/daily-grid/DayAmendmentForm.tsx` (снят дубль-гард `handleSubmit`)
- `frontend/src/features/daily-grid/DayAmendmentForm.test.tsx` (перефрейм теста пустой формы)
- `frontend/src/features/daily-grid/DailyUpdatePage.test.tsx` (`clearCredential` → `afterEach`)

**Сверено с `git diff --name-only` + `git status --porcelain`** (AI-3 ретро E9): расхождений нет.
`HEAD` на момент сдачи — `101cc01`, совпадает с `baseline_commit`: параллельные стори
в этот worktree за время работы не коммитились. `.claude/settings.json` в диффе —
**предсуществующее** изменение, не принадлежит 10.6, в коммит стори включать не следует.
Прочие пути диффа (`frontend/e2e-live/**`, `playwright.live.config.ts`, `frontend/package.json`
(`test:e2e:live`), `Backend/**` (`seed_e2e_lagging.py`, `test_ws_guards.py`, `pyproject.toml`)) —
**стори 11.6**, в коммит 10.6 не включать.
