---
baseline_commit: ac028c25c0b5c4fb28a6c4b5246c38cd7097e9a1
---
# Story 5.10: Property — иммутабельность снапшота

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **property-тест (hypothesis): произвольные мутации статусов ПОСЛЕ сдачи дня не меняют ни сохранённый `DailySubmission.snapshot`, ни `derive(снапшот)`**,
so that **расход из снапшота воспроизводим всегда — байт-в-байт, независимо от любой последующей жизни live-данных (ARCH-DATA-021; «property-based тесты ядра расчёта расхода» — принцип отсечения СЕЙЧАС-№5)**.

> **Контекст:** это ЧИСТО ТЕСТОВАЯ стори — прод-код НЕ меняется, миграций НЕТ, реестры НЕ трогаются. Билдер 5.3a прямо называет её потребителем («фундамент иммутабельности 5.10», snapshot.py:14-16,42), derive-функция уже существует (`_snapshot_winners`, traffic_light.py:106-128). Инвариант держится на двух китах, и тест обязан пинить ОБА: (1) **хранение** — ни один сервис не переписывает snapshot существующей версии (amendment создаёт НОВУЮ строку v2, v1 нетронута); (2) **самодостаточность derive** — `_snapshot_winners` читает ТОЛЬКО roster+rows из снапшота, никогда live-таблицы. Ассерт только по (1) пропустил бы регрессию, где потребитель снапшота начал подглядывать в live; ассерт только по (2) пропустил бы сервис, мутирующий JSONB на месте.

## Acceptance Criteria

1. **Ядро property (AC эпика).** **Given** сданный день (реальный `submit_day` под `clock.override`, непустой roster с начальными статусами) и baseline, снятый DB-refetch'ем сразу после сдачи, **When** hypothesis применяет произвольную последовательность мутаций статусов через РЕАЛЬНЫЕ сервисы (пул Д4: `create_status`, `update_status`, `cancel_status`, `complete_status_early`, `extend_status`, `resolve_pending_clarification`, `bulk_create_statuses`, `dismiss_employee`), **Then** для строки v1, перечитанной по pk (`DailySubmissionSelector.by_id` — НЕ `current_for`, Ловушка №1): (а) `json.dumps(refetched.snapshot, sort_keys=True, ensure_ascii=False)` байт-в-байт равен baseline-снапшоту; (б) `json.dumps(_snapshot_winners(refetched.snapshot, business_date), sort_keys=True, ensure_ascii=False)` байт-в-байт равен baseline-derive, посчитанному ДО мутаций (Д3).

2. **Amendment-путь — сильнейший кейс.** **Given** до сдачи посеян `PENDING_CLARIFICATION`-статус, накрывающий `business_date`, **When** после сдачи вызывается `resolve_pending_clarification` (ЕДИНСТВЕННАЯ мутация, дёргающая хук 5.4b — status_service.py:819), **Then** хук создаёт v2 (`event=AMENDED`, sanity-ассерт: `latest_for(...).version == 2` — иначе ветка вакуумна), а v1 по pk остаётся байт-в-байт прежней (snapshot И derive); `is_current` v1 флипнут в False — это by-design НЕ нарушение (флип НЕ трогает snapshot-поле). Кейс закреплён ДЕТЕРМИНИРОВАННЫМ unmarked-тестом (бежит в `make gate`) И входит в property-пул (Д5).

3. **Невакуумность (канон E8).** На каждый hypothesis-example ≥1 УСПЕШНАЯ мутация (счётчик успехов), и она обязана ВОЗМУЩАТЬ снапшот: первый op последовательности — гарантированно валидный `create_status` мягкого типа сотруднику ИЗ ростера сданного дня, интервалом, накрывающим `business_date` (ретро-правка live поверх сданной даты — самый адверсариальный случай; мир держит одного roster-сотрудника БЕЗ начальных статусов, чтобы op не мог отвергнуться пересечением). Мутация сотрудника, созданного ПОСЛЕ сдачи, снапшот не возмущает — таким op невакуумность НЕ закрывается. `DomainError` от отдельного op — допустимый исход (отказ тоже не должен менять снапшот), НЕ прерывает последовательность и НЕ проваливает example; любое другое исключение — падение теста.

4. **Маркировка и гейт-семантика.** Property-часть: `pytestmark = [pytest.mark.property, pytest.mark.django_db]` (`--strict-markers`: только property/concurrency/slow зарегистрированы — pyproject.toml:33-38); `@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])` на каждом `@given`-тесте (канон test_status_service.py:499-533). Детерминированный amendment-тест (AC-2) — unmarked, бежит в gate. **Then** `make gate` зелёный (property исключён фильтром `-m "not property and not concurrency and not slow"`, база 1841 + новые unmarked); `pytest -m property` на ci-профиле (10 examples) зелёный; full-профиль (`HYPOTHESIS_PROFILE=full`, 500 examples) зелёный на этом модуле.

5. **Изоляция examples без удалений.** Каждый example строит СВЕЖИЙ Division (счётчик-суффикс кода) + свежих сотрудников (счётчик IIN) — unique-констрейнты сдач/статусов скоупятся подразделением, examples не сталкиваются (Д7). Никаких `.delete()` по `audit_logs` (append-only: REVOKE+триггер уронят DELETE — 4.2). Прод-код, миграции, seed, реестры, conftest'ы — НЕ тронуты; единственный новый файл — тест-модуль.

## Tasks / Subtasks

- [x] **Task 1 — Каркас модуля и мир** (AC: 1, 5)
  - [x] Создать `apps/operations/submissions/tests/test_snapshot_immutability_properties.py`: докстринг (инвариант ARCH-DATA-021 + два кита из контекста), `TODAY = date(2026, 7, 8)`, счётчики `_iin = itertools.count(...)` / `_div_code = itertools.count(...)` (канон test_traffic_light.py:41-43).
  - [x] Хелперы построения мира ВНУТРИ example (не fixture — Д7): `_make_division()` (Organization/DivisionType `get_or_create` + Division со счётчик-кодом, зеркало test_day_submission_service.py:35-43), `_make_employee(division)` (`employment_status="WORKING"`, зеркало :46-55), `_make_status(...)` (зеркало :58-65).
  - [x] Module-scoped seed StatusType'ов один раз (function-fixture с `get_or_create` — повторный вызов идемпотентен): мягкий пул `STUDY/COMPETITION/CONFERENCE/OTHER_ABSENCE/EVENT_ASSIGNMENT` + `PENDING_CLARIFICATION` (priority 990, report `PENDING`) + 1 hard `VACATION` (для ветки «мутация отвергнута»); поля по образцу test_amendment_enforcement.py:88-102 (`code/name/priority/report_column_code`, `is_hard_block` только у VACATION). Все коды — строго из `STATUS_TYPE_PRIORITIES` (иначе derive бросит ValueError — Ловушка №6).
- [x] **Task 2 — Стратегии hypothesis** (AC: 1, 3)
  - [x] `@st.composite worlds(draw)`: 1–4 сотрудника, 0–2 начальных статуса каждому (мягкие коды, интервалы в окне `TODAY±5`, полуоткрытые, создание напрямую ORM `_make_status` ДО сдачи); ПЛЮС один выделенный roster-сотрудник БЕЗ начальных статусов (цель гарантированного первого op, AC-3); флаг «посеять pending, накрывающий TODAY» (питает AC-2-ветку в property).
  - [x] `@st.composite ops(draw)`: последовательность 1–6 операций из пула Д4; параметры каждой op рисуются валидными по гайду Ловушки №6 (мягкие коды; интервалы `date_start < date_end` в пределах занятости; `override=True, override_reason="prop"` на create/extend/resolve для обхода soft-409; `cancel` — только по PLANNED (нарисовать будущий статус тем же example и отменить его), `complete_early` — только по ACTIVE, начавшемуся ДО TODAY (`date_start < TODAY`, `date_start < actual_end ≤ TODAY` — для стартовавшего В TODAY валидного `actual_end` не существует), `dismiss_employee` — ≤1 на example, терминальной op). Первый op — гарантированный валидный `create_status` (AC-3).
- [x] **Task 3 — Ядро property-теста** (AC: 1, 3, 5)
  - [x] Всё тело example под `with clock.override(TODAY):` (Ловушка №4): построить мир → `submit_day(division_id=..., business_date=TODAY, actor="prop-op")` → baseline: `base = DailySubmissionSelector.by_id(sub.pk)`; `base_snapshot_bytes`, `base_derive_bytes` (Д3).
  - [x] Применить ops: каждый в `try/except DomainError` (Д5), счётчик успехов; после последовательности — refetch `by_id(sub.pk)` и оба байт-ассерта + `assert succeeded >= 1`.
  - [x] Если в мире был pending и среди ops прошёл `resolve_pending_clarification` — sanity: `latest_for(division_id, TODAY).version >= 2` (хук жив, AC-2 в property-обвязке).
- [x] **Task 4 — Детерминированный amendment-тест (unmarked, gate)** (AC: 2)
  - [x] Тот же мир руками: pending накрывает TODAY → submit → baseline → `resolve_pending_clarification(pending, resolved_type_code="STUDY", date_start=..., date_end=..., actor=..., reason="уточнено")` → ассерты: v2 существует (`event=AMENDED`, `reason=_AUTO_AMENDMENT_REASON` — импорт из amendment_enforcement), v1 по pk: snapshot-байты и derive-байты прежние, `is_current is False`.
  - [x] Негатив-компаньон (unmarked): мутация, НЕ дёргающая хук (например `extend_status` статуса, накрывающего TODAY), → v2 НЕ создаётся (`latest_for(...).version == 1`), v1 байт-в-байт прежняя — пинит вывод research'а «только resolve зовёт хук» как поведение, а не как знание.
- [x] **Task 5 — Прогоны и гейт** (AC: 4)
  - [x] `pytest apps/operations/submissions/tests/test_snapshot_immutability_properties.py` (ci-профиль) зелёный; затем `HYPOTHESIS_PROFILE=full pytest -m property <модуль>` зелёный; `make gate` зелёный (база 1841 растёт на unmarked-тесты Task 4).
  - [x] `ruff format` строго по файлу (НЕ по папке) + `ruff check`; `makemigrations --check` пуст (кода-моделей нет). NB: в этом worktree нет `.venv` — гейт гонять из окружения с установленным `.[dev]` (Ловушка №8).

## Dev Notes

### Эталоны — всё уже в кодовой базе, ничего не изобретать
- **derive(снапшот):** `_snapshot_winners(snapshot, business_date)` — traffic_light.py:106-128, докстринг «derive(снапшот): {str(employee_id): winner_code}, only from the snapshot». Импорт приватного хелпера в тест того же app-а допустим (тест и есть спецификация этого контракта). НЕ использовать `division_traffic_light` (он считает drift против live — другой вопрос).
- **hypothesis×DB канон:** `test_status_service.py:499-533` — `@pytest.mark.property` + `@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])` + `@given` с реальными ORM-записями; `test_status_state_properties.py:20,41` — `pytestmark = [pytest.mark.property, pytest.mark.django_db]`. `hypothesis.extra.django` в проекте НЕ используется — не вводить.
- **Мир submissions-теста:** `test_day_submission_service.py:28-83` (division fixture, make_employee, make_status, `_aware`, `_prior`) и `test_traffic_light.py:37-87` (`_submit` под `clock.override`); «mutate-after-submit» уже разыгрывается детерминированно в test_traffic_light.py:202-210 — property обобщает этот приём.
- **Профили hypothesis:** корневой conftest.py:14-16 — ci=10 (default), full=500 (`HYPOTHESIS_PROFILE=full`, wired в `make test-full`), deadline=None.
- **Amendment-механика:** `amend_day` (amendment_service.py:56-59) — flip-before-insert, v2 со СВЕЖИМ снапшотом; хук `enforce_amendment_on_retro_edit` (amendment_enforcement.py:47) зарегистрирован в apps.py:9,19 через `AppConfig.ready()` — в тестах живой всегда; `_AUTO_AMENDMENT_REASON` — amendment_enforcement.py:28.

### ⚠️ ЛОВУШКА №1 (ГЛАВНАЯ): после amendment v1 больше НЕ current
`resolve_pending_clarification` → хук → `amend_day` → у v1 `is_current=False`, `current_for`/`latest_for` вернут v2. Baseline и пост-ассерты — ТОЛЬКО по pk: `DailySubmissionSelector.by_id(sub.pk)` (selectors.py:33-48). Сравнение через `current_for` молча сравнило бы v2 с v2 — тест-пустышка, инвариант не проверен.

### ⚠️ ЛОВУШКА №2: `DailySubmissionSelector.list()` дефер-ит snapshot
`.defer("snapshot")` (selectors.py:50-51, стори 5.8c) — для байт-ассертов НЕ использовать list-селектор; только `by_id`/`current_for`/`latest_for`.

### ⚠️ ЛОВУШКА №3: baseline — с DB-refetch, НЕ с in-memory результата submit_day
Возврат `submit_day` держит dict, построенный билдером В ПАМЯТИ (до JSONB-round-trip: date-объекты уже ISO-строки по контракту билдера, но паранойя дешевле дебага). Baseline снимается `by_id(sub.pk)` СРАЗУ после сдачи — тогда оба берега сравнения прошли одинаковый JSONB-путь, и мутационный эффект не смешивается с сериализационным.

### ⚠️ ЛОВУШКА №4: всё тело example — под `clock.override(TODAY)`
`submit_day` валидирует окно от `Clock.today_local()` ({today, tomorrow} — day_submission_service.py:57-60,133-140): вне override окно уедет от реальных часов машины → флак `BUSINESS_DATE_OUT_OF_WINDOW`. `complete_status_early` тоже читает Clock (`actual_end` не в будущем). `clock.override` принимает `date` (→ полночь, `late=False` гарантирован) — канон test_traffic_light.py:82-87.

### ⚠️ ЛОВУШКА №5: изоляция examples — свежим Division, НЕ удалениями
Все examples одного `@given`-теста живут в ОДНОЙ django_db-транзакции — состояние копится. Повторный `submit_day` на тот же (division, business_date) → 409 `DAY_ALREADY_SUBMITTED`. Решение Д7: свежий Division на example (счётчик-код) — partial-unique скоупится подразделением, конфликтов нет, удаления не нужны. НЕ пытаться чистить `audit_logs` (append-only enforced БД — DELETE упадёт триггером/REVOKE, 4.2); накопление аудит-строк безвредно.

### ⚠️ ЛОВУШКА №6: генераторы валидных мутаций — карта отказов
Полный перечень DomainError-кодов мутаций (все — `apps.core.exceptions.DomainError`, ловить по типу): `VALIDATION_ERROR` 400 (пустой actor/reason/override_reason) · `PERMISSION_DENIED` 403 (live DETACHED у сотрудника — потому secondment-ops ИСКЛЮЧЕНЫ из пула, Д4) · `ENTITY_NOT_FOUND` 404 · `INVALID_STATUS_TYPE` / `INVALID_DATE_RANGE` / `DATE_OUTSIDE_EMPLOYMENT` / `MAX_DURATION_EXCEEDED` / `OVERLAPPING_HARD_STATUS` / `INVALID_LIFECYCLE_TRANSITION` 422 · `STATUS_OVERLAP_WARNING` 409 (soft; обходится `override=True` + непустой `override_reason` — есть на `create/extend/resolve`). Hard-пересечение (SICK_LEAVE/LEAVE_BY_REPORT/VACATION/COMMAND — conflict_matrix.py:37) НЕ overridable → генератор строит мутации мягкими кодами, hard остаётся редкой веткой «отказ тоже не меняет снапшот». Коды статусов — ТОЛЬКО из `STATUS_TYPE_PRIORITIES` (strength_report.py:17-38), иначе `_snapshot_winners`/`resolve_status` бросит ValueError на ДЕРИВЕ и замаскирует смысл падения.

### ⚠️ ЛОВУШКА №7: хук 5.4b дёргает ТОЛЬКО `resolve_pending_clarification`
Verified grep'ом: единственный не-тестовый вызов `mark_days_for_amendment` — status_service.py:819 (внутри resolve). `create/update/cancel/complete/extend/bulk/dismiss` хук НЕ зовут: live уедет от снапшота (это YELLOW-drift светофора 5.5a — by design), amendment НЕ появится. Тест НЕ должен ожидать v2 от не-resolve мутаций (негатив-компаньон Task 4 пинит это явно). Сигнатура хендлера: половинчато-открытый union интервалов, `covering` по JSONB-roster, `amend_day` на каждый накрытый день.

### ⚠️ ЛОВУШКА №8: гейт и профили — где и как гонять
`make gate` фильтрует `-m "not property and not concurrency and not slow"` (Makefile:52-75) — property-тест в gate НЕ бежит; полнота — `make test-full` (`HYPOTHESIS_PROFILE=full`, Makefile:28-50). У `make test-full` есть 2 ПРЕ-СУЩЕСТВУЮЩИХ teardown-ERROR (audit append-only × TransactionTestCase TRUNCATE) — НЕ регрессия этой стори, quality-bar = `make gate` + зелёный прогон модуля на full-профиле. В этом git-worktree `.venv` отсутствует — гейт гонять из чекаута с установленным окружением.

### Дефолты (приняты мной — поднять на вопросах, если не согласен)
- **Д1 (размещение):** тест живёт в `apps/operations/submissions/tests/` — владелец инварианта (snapshot-билдер, DailySubmission, `_snapshot_winners` — всё в submissions); statuses-сервисы здесь инструмент возмущения, не предмет. `operations/tests/integration/` отвергнут: канон «тесты в app-е, чей код проверяют», и submissions-тесты уже легально зовут statuses (test_traffic_light).
- **Д2 (паттерн):** plain pytest `django_db` + `@given` + suppress_health_check + Д7-изоляция — единственный прецедент проекта; `hypothesis.extra.django.TestCase` НЕ вводить (новый паттерн без нужды).
- **Д3 («байт-в-байт»):** каноническая форма `json.dumps(x, sort_keys=True, ensure_ascii=False)` для ОБЕИХ осей (snapshot и derive-результат). Две оси обязательны: snapshot-байты ловят «сервис переписал JSONB», derive-байты ловят «derive перестал быть самодостаточным» (читает live) — см. контекст стори.
- **Д4 (пул мутаций):** 8 операций — `create_status`, `update_status`, `cancel_status`, `complete_status_early`, `extend_status`, `resolve_pending_clarification`, `bulk_create_statuses`, `dismiss_employee`. Secondment-ops исключены: `initiate_secondment` создаёт live DETACHED → FR-16-гвард 403 каскадно отвергает все последующие мутации сотрудника → вырожденные examples (шум без сигнала). Дисмиссал — терминальная op (≤1 на example, после неё сотрудник вне занятости).
- **Д5 (отказы):** `DomainError` от op — допустимый исход, инвариант ассертится в любом случае; невакуумность держит гвард AC-3 (≥1 успех + первый op гарантированно валиден). Прочие исключения — честное падение.
- **Д6 (sanity хука):** в property-ветке с pending+resolve ассертится появление v2 — иначе сильнейший кейс молча не исполняется на ci-профиле (10 examples).
- **Д7 (изоляция):** свежий Division + сотрудники на example; удалений нет. 500 full-examples × ~10 строк — копейки для Postgres в одной транзакции.
- **Д8 (unmarked-компаньоны):** детерминированные amendment-тест и негатив (Task 4) — unmarked, чтобы ИНВАРИАНТ имел покрытие в каждом `make gate`, а не только в ночном full (зеркало смешанного модуля test_strength_report_properties.py: unmarked-таблицы + property-класс).

### Что уже есть (НЕ переизобретать)
- `build_division_snapshot` детерминирован по построению (сортировки roster/rows — snapshot.py:38-43) — тест НЕ дублирует проверку сортировок, он про иммутабельность.
- «v1 сохраняется при amendment» детерминированно уже пинится в test_amendment_service (5.4a) — но БЕЗ байт-ассертов snapshot/derive; эта стори добавляет именно байтовую ось, не дублируя лайфцикл-ассерты.
- hypothesis>=6,<7 уже в dev-зависимостях (pyproject.toml:24); профили зарегистрированы (conftest.py); маркер `property` зарегистрирован (pyproject.toml:35). Никаких новых зависимостей/конфигов.
- `submit_day` сигнатура: `submit_day(*, division_id, business_date, actor, window_dates=None)` (day_submission_service.py:105-106); `resolve_pending_clarification(pending, *, resolved_type_code, date_start, date_end, actor, reason, override=False, override_reason="")` (status_service.py:668-679); `bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids)` (bulk_status_service.py:57-58); `dismiss_employee(employee, *, date, reason=None, actor)` (dismissal.py:69-70). Лайфцикл-опы берут ИНСТАНС статуса первым позиционным.

### Границы (что 5.10 НЕ делает)
НЕ трогает прод-код (ни одного файла вне tests/) · НЕ миграции/seed/реестры/conftest'ы (корневой и core) · НЕ schema-v2 hardening снапшота (deferred-work: `_diff_key`/`_snapshot_winners` KeyError на формодрейфе — отдельный класс, триггер = бамп схемы) · НЕ конкурентные тесты (ARCH-DEFERRED-044) · НЕ мутации кадровых полей (rename/перевод — денорм-заморозка ФИО уже пинится билдер-тестами 5.3a; эпик-AC говорит «мутации статусов») · НЕ property на `derive_report`/расход-агрегацию (есть — test_strength_report_properties) · НЕ светофор/drift (5.5a тесты) · НЕ API-слой.

### Previous Story Intelligence (5.9, review 2026-07-03 + E8-ретро 2026-07-07)
- База гейта: **1841 passed** (стабильна весь E8; 5.9 закрылась на 1833, 8.3 добавил schema-drift-тесты). Сьюты submissions: ~287 тестов, 18 файлов.
- Уроки: (1) `ruff format` строго per-file (инцидент-класс закреплён в memory); (2) невакуумность — канон E8: каждый негатив-ассерт должен доказывать, что позитивная ветка исполнялась (отсюда AC-3 и Д6); (3) same-model caveat ревью — ждать адверсариального прохода по границам транзакций и вакуумным веткам; (4) в тест-модуле — СВОИ копии фикстур/хелперов, общий conftest не заводить (конвенция сьютов 5.8x/5.9); (5) чекбоксы стори править точечными Edit, не скриптами.
- 5.9 добавила `record()`-эмиссию в `submit_day`/`amend_day` — каждый успешный submit/amend в тесте пишет 1-2 строки аудита; это ФОН (append-only, не чистить), на байт-ассерты не влияет.

### Git Intelligence
- HEAD = `ac028c2` «Automator BMAD stories 8.3-8.8 done» — весь E8 (фронтенд) закоммичен; бэкенд-код не менялся с 5.9 (`c898dc8`+ревью-патчи). Рабочее дерево: только automator-артефакты в `_bmad-output/`. Паттерн коммита: `feat(E5): 5.10 property иммутабельность снапшота — ...` + `Co-Authored-By`.

### Project Structure Notes
- Создаётся: `Backend/VAPS/apps/operations/submissions/tests/test_snapshot_immutability_properties.py` (имя — зеркало `*_properties.py`-канона: test_strength_report_properties / test_status_state_properties / test_roster_merge_properties).
- Модифицируется: НИЧЕГО в коде. Воркфлоу-артефакты: этот файл + sprint-status.yaml.
- Счёт: 1 create + 0 modify — одна ответственность (property-контракт иммутабельности). Миграций НЕТ.

### References
- [Source: epics.md:794-800 — стори 5.10 (AC эпика: hypothesis, байт-в-байт)]
- [Source: architecture.md §ARCH-DATA-021 (снапшот = интервалы-факты; расход = derive(снапшот) детерминированно; drift by-design) и §Стратегия качества («property-based на ядро»)]
- [Source: architecture.md §Test Organization — маркеры property/concurrency/slow; hypothesis-профили ci/full; gate/test-full бюджеты]
- [Source: Backend/VAPS/apps/operations/submissions/services/snapshot.py:1-43 — билдер 5.3a, «фундамент иммутабельности 5.10», детерминированные сортировки]
- [Source: Backend/VAPS/apps/operations/submissions/traffic_light.py:106-128 — `_snapshot_winners` (канонический derive(снапшот))]
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:21-48,116-117 — `current_for`/`by_id`/`latest_for`; :50-51 — list с defer("snapshot")]
- [Source: Backend/VAPS/apps/operations/submissions/services/day_submission_service.py:57-60,105-151 — submit_day, окно {today,tomorrow}, коды 400/404/409/422]
- [Source: Backend/VAPS/apps/operations/submissions/services/amendment_service.py:56-59,104-158 — amend_day, flip-before-insert, NO_SUBMISSION_TO_AMEND]
- [Source: Backend/VAPS/apps/operations/submissions/amendment_enforcement.py:28,31,47-66 — хендлер 5.4b, `_AUTO_AMENDMENT_REASON`, union дней; apps.py:9,19 — регистрация в ready()]
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py:247-260,347-356,457-458,513-514,570-571,668-679,819 — сигнатуры мутаций; вызов хука ТОЛЬКО в resolve]
- [Source: Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py:44,57-58 — bulk_create_statuses; dismissal.py:36-37,69-70 — dismiss/close_active]
- [Source: Backend/VAPS/apps/operations/statuses/conflict_matrix.py:37,44 — HARD_STATUS_TYPE_CODES, COMPATIBLE_PAIRS; strength_report.py:17-38 — STATUS_TYPE_PRIORITIES]
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_status_service.py:38-65,499-533 — env-фикстура, hypothesis×DB канон с suppress_health_check]
- [Source: Backend/VAPS/apps/operations/submissions/tests/test_day_submission_service.py:28-83, test_traffic_light.py:37-87,202-210, test_amendment_enforcement.py:39-102,112 — мир/хелперы/seed-типов]
- [Source: Backend/VAPS/conftest.py:14-16 — профили ci/full; pyproject.toml:24,29-38 — hypothesis dep, строгие маркеры; Makefile:28-75 — gate/test-full фильтры]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:454,469 — schema-drift деферы (вне скоупа 5.10)]
- [Source: memory: project_test_full_concurrency_teardown (2 teardown-ERROR test-full — не регрессия), feedback_vaps_ruff_format_scoping, feedback_story_file_edit_safety]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Fable 5), bmad-dev-story 2026-07-07

### Debug Log References

- Окружение (Ловушка №8 подтвердилась острее, чем в спеке): в worktree нет `.venv`, а editable-инсталл основного `.venv` мапит `apps` на ОСНОВНОЙ чекаут (`__editable___vaps_0_1_0_finder.py`, MetaPathFinder) — pytest из worktree не импортировал бы новый тест-модуль. Решение: HEAD обоих деревьев идентичен (ac028c2, Backend основного чекаута чист) → тест-файл копировался в основной чекаут, все прогоны — оттуда, копия удалена после прогонов (основной чекаут снова чист). Ревьюеру повторять так же: `cp` файла → прогоны → `rm`.
- Прогоны (все из `/home/erda/Музыка/VAPS/Backend/VAPS`, Postgres 5433 via `docker compose up -d --wait db`):
  - `pytest <модуль> -q` (ci=10) → 3 passed, 1.5s
  - `HYPOTHESIS_PROFILE=full pytest <модуль> -q` (500 examples) → 3 passed, 10.8s
  - `pytest -m property <модуль> -q` → 1 passed, 2 deselected
  - `make gate` → ruff чист, **1843 passed** (база 1841 + 2 unmarked этой стори — ровно по AC-4), 26 deselected, `makemigrations --check` пуст («No changes detected»), 33s
  - `ruff format` строго по файлу (пер-файл, память feedback_vaps_ruff_format_scoping) + `ruff check` — чисто
- Адверсариальный probe (канон невакуумности E8, одноразовый scratch-тест, удалён): подделка JSONB v1 (`.update(snapshot=doctored)`) ловится ОБЕИМИ осями (`_canon(snapshot)` и `_canon(_snapshot_winners(...))` расходятся с baseline) — байт-сравнение действительно «кусается», не тавтология.

### Completion Notes List

- Единственный новый файл: `Backend/VAPS/apps/operations/submissions/tests/test_snapshot_immutability_properties.py` (~540 строк). Прод-код, миграции, seed, реестры, conftest'ы — НЕ тронуты (AC-5).
- Структура модуля — зеркало смешанного канона test_strength_report_properties: 2 unmarked amendment-компаньона (бегут в gate) + property-класс с `pytestmark = [pytest.mark.property, pytest.mark.django_db]` (буква AC-4) и `@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])`.
- Ядро property (AC-1): мир строится ВНУТРИ example (свежий Division со счётчик-кодом + свежие сотрудники — Д7, без удалений), реальный `submit_day` под `clock.override(TODAY)`, baseline DB-refetch'ем по pk (`by_id`, Ловушки №1/№3), затем 1–6 мутаций пула Д4 через реальные сервисы; оба байт-ассерта (snapshot-ось + derive-ось `_snapshot_winners`) в канонической форме Д3.
- Все 8 операций Д4 покрыты интерпретатором `_apply_op`: create (мягкие коды + редкий hard VACATION — ветка «отказ тоже не меняет снапшот»), update (dates/comment), cancel (по нарисованному будущему PLANNED), complete_early (по ACTIVE со start<TODAY, `end_back % back`), extend (с refresh_from_db от stale date_end), resolve (только при посеянном pending), bulk (1–2 строки, scope = свой Division), dismiss (≤1, строго терминальная op).
- Невакуумность (AC-3): первый op — гарантированно валидный `create_status` мягкого типа чистому roster-сотруднику интервалом, накрывающим TODAY; `assert succeeded >= 1`; DomainError не прерывает последовательность (Д5), прочие исключения роняют тест.
- AC-2 закреплён дважды: детерминированный unmarked-тест (resolve → v2 AMENDED с `_AUTO_AMENDMENT_REASON`, sanity `version == 2`, v1 по pk байт-в-байт, `is_current is False`; плюс невакуумный ассерт `v2.snapshot != v1.snapshot`) и property-ветка (pending-флаг мира + resolve-op + Д6-sanity `version >= 2`). Негатив-компаньон: extend НЕ создаёт v2 (`version == 1`, v1 current и байт-в-байт), с proof-ассертом что extend исполнился.
- pending-статус сознательно НЕ в registry мутационных целей: update/extend не могут увести его с TODAY, иначе Д6-sanity потерял бы основание (resolve гарантированно накрывает сданный день).

### File List

- `Backend/VAPS/apps/operations/submissions/tests/test_snapshot_immutability_properties.py` — создан (dev-модуль: property-ядро + 2 unmarked amendment-компаньона)
- `Backend/VAPS/apps/operations/submissions/tests/test_snapshot_immutability_api.py` — создан (QA-модуль bmad-qa-generate-e2e-tests: 3 unmarked HTTP-судьи инварианта — detail v1 после live-мутаций, hook-amendment по старому pk, байт-стабильность средней версии цепочки v1→v2→v3)
- `_bmad-output/implementation-artifacts/5-10-property-иммутабельность-снапшота.md` — воркфлоу-артефакт (чекбоксы, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — воркфлоу-артефакт (статус 5-10)
- `_bmad-output/implementation-artifacts/tests/test-summary.md` — воркфлоу-артефакт QA-шага (сводка 5.10, gate 1843 → 1846)

## Senior Developer Review (AI)

**Ревьюер:** Bratan (адверсариальный проход, Claude Fable 5) · **Дата:** 2026-07-07 · **Вердикт:** Approve (0 CRITICAL / 0 HIGH; 2 MEDIUM + 1 LOW найдены и исправлены на месте)

### Независимая верификация (из основного чекаута, Ловушка №8: `cp` обоих модулей → прогоны → `rm`, чекаут после — чист)

- Оба модуля, ci-профиль: **6 passed**; `pytest -m property` — 1 passed, 2 deselected; `HYPOTHESIS_PROFILE=full` (500 examples) — **6 passed, 11.2s**; `make gate` — **1846 passed** (база 1841 + 2 dev-unmarked + 3 QA), ruff чист, `makemigrations --check` пуст, 34s. Все цифры Dev Agent Record и test-summary воспроизведены.
- **Независимый мутационный probe** (не повтор dev/QA-проб): `amend_day` при flip дополнительно переписывает JSONB демотируемой версии (`.update(is_current=False, snapshot=snapshot)`) → **4 красных ровно там, где должно** (deterministic amendment-тест, property-ядро, оба HTTP-amendment-судьи), 2 зелёных by design (негатив-extend и detail-без-цепочки). Откачено, git чист. Инвариант-тесты кусаются, не тавтология.
- Сигнатуры всех 8 ops пула Д4 сверены с кодом (status_service 248/348/458/514/571/669, bulk 58, dismissal 70); `state_on`-гвард complete_early подтверждает достижимость ветки (start<TODAY<end → ACTIVE); `update_status` принимает `comment`; роут `ops-daily-submission-{detail,amend}` и `triggered_by_status_id` в detail-сериализаторе — на месте.

### Находки и фиксы (auto-fix)

1. **[MEDIUM][docs] File List отстал от QA-шага.** В git — `test_snapshot_immutability_api.py` (3 gate-теста) и обновлённый `tests/test-summary.md`, в File List их не было («единственное изменение кода» — устарело после bmad-qa-generate-e2e-tests). → File List дополнен.
2. **[MEDIUM][test] Гарантия первого op (AC-3) держалась на честном слове.** `DomainError` от первого op глотался как «допустимый исход Д5» — если бы «гарантированно валидный» `create_clean` когда-нибудь сгнил (новое правило валидации), `succeeded >= 1` закрылся бы op'ом, не возмущающим сданный день, и невакуумность истлела бы молча. → В цикле ops: `DomainError` от op с индексом 0 пробрасывается (генератор обязан строить его валидным). Full-профиль 500 examples зелёный после фикса — гарантия реально держится.
3. **[LOW][test] Baseline-детали в API-тестах 2/3 без ассерта статуса.** Регресс прав уронил бы тест невнятным `KeyError["snapshot"]` вместо явного 200-ассерта. → Добавлены `assert ... == 200` на baseline-ответы.

### Замечания без действий

- Число gate в Debug Log dev-записи (1843) — исторично на момент dev-шага; финальная правда после QA = 1846 (зафиксирована в test-summary и здесь).
- `resolve`-op в property рисует `date_start` до +2 от TODAY — накрытие сданного дня держит union-семантика хука (старый pending-интервал накрывает TODAY всегда), Д6-sanity не вакуумен.

## Change Log

| Дата | Версия | Изменение | Автор |
|------|--------|-----------|-------|
| 2026-07-07 | 1.1 | Ревью (bmad-story-automator-review, Fable 5): Approve, 0 CRITICAL. Независимая верификация всех прогонов (ci 6 / full-500 6 / gate 1846) + собственный мутационный probe amend_day-flip (4 красных где должно). Auto-fix 3 находок: File List дополнен QA-модулем test_snapshot_immutability_api.py и test-summary (MEDIUM), DomainError первого op теперь пробрасывается — гарантия AC-3 самоохраняемая (MEDIUM), 200-ассерты на baseline-детали API-тестов 2/3 (LOW). Full-профиль и gate перегнаны после фиксов — зелёные. Status → done | Bratan (AI review) |
| 2026-07-07 | 1.0 | Реализована (bmad-dev-story, Fable 5): 1 новый тест-модуль test_snapshot_immutability_properties.py — property-ядро (worlds+plans, пул 8 ops Д4, байт-ассерты Д3 по обеим осям, AC-3-гварды невакуумности, Д6-sanity) + 2 unmarked amendment-компаньона (gate); прод-код не тронут. Прогоны: ci 3 passed / full (500 ex) 3 passed / `-m property` 1 passed / make gate 1843 passed (база 1841+2) / ruff per-file чист / migrations-check пуст. Адверсариальный probe подтвердил, что обе байт-оси ловят подделку JSONB. Status → review | Claude Fable 5 |
| 2026-07-07 | 0.1 | Создана стори (bmad-create-story, Fable 5, #YOLO): 5.10 = чисто тестовая стори, property-контракт иммутабельности снапшота по двум осям (snapshot-байты + derive-байты); 2 research-агента (поверхность мутаций statuses + тест-конвенции submissions/hypothesis×DB); зафиксированы Ловушки №1-8 (by_id vs current_for, defer(snapshot), baseline с refetch, clock.override, изоляция свежим Division без delete, карта DomainError-кодов, хук только в resolve, gate-фильтр property) и Д1-Д8 (размещение в submissions/tests, plain-pytest паттерн, canonical json.dumps, пул 8 мутаций без secondments, отказы допустимы, sanity v2, fresh-division изоляция, unmarked-компаньоны для gate) | Bratan |
