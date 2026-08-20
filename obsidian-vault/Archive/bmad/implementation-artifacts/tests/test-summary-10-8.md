# Test Automation Summary — Story 10.8 (личный экспорт оператора, «щит»)

**Workflow:** `bmad-qa-generate-e2e-tests` · 2026-07-19 · Opus 4.8
**Режим:** auto-apply — все найденные пробелы закрыты тестами в этом же прогоне.
**Прод-код НЕ менялся.** Дев-реализация принята как есть; QA добавляет только тесты.

## Что было на входе

Дев-сюита 10.8 уже широкая — 31 unit + 22 API. Поэтому задача QA свелась не к
«написать тесты», а к поиску **вакуумных и недостающих** ассертов: мест, где
тест зелёный независимо от того, работает прод-код или нет.

## Добавлено: 11 тестов

### `apps/operations/submissions/tests/test_personal_export.py` (unit, без БД) — было 29, стало 33

| Тест | Закрытый пробел | AC |
|---|---|---|
| `test_submitted_at_label_converts_utc_into_the_local_timezone` | **`_submitted_at_label` не имел НИ ОДНОГО прямого теста.** Приведение к `Asia/Qyzylorda` не проверялось нигде | AC-2 |
| `test_submitted_at_label_uses_the_configured_local_zone_not_a_hardcoded_offset` | Знаменатель предыдущего + вакуум-гвард самой фикстуры | AC-2 |
| `test_passport_carries_exactly_the_nine_labels_in_order` | Поштучные ассерты переживали выпавшую строку шапки, если её никто не спрашивал | AC-2 |
| `test_multiple_rows_of_one_employee_keep_their_snapshot_order` | Порядок строк ВНУТРИ сотрудника не проверялся вовсе | AC-3 |

**Усилен (не добавлен) `test_rows_keep_snapshot_order_without_local_sorting`:** фикстура
была возрастающей и по `employee_id`, и по ФИО — своя сортировка в билдере дала бы
тот же порядок, и тест не мог покраснеть. Фикстура перевёрнута (C → B → A).

### `apps/operations/submissions/tests/test_personal_export_api.py` (HTTP + аудит) — было 22, стало 29

| Тест | Закрытый пробел | AC |
|---|---|---|
| `test_submitted_at_is_printed_in_local_time_not_the_utc_stored_in_the_db` | Существующий ассерт — регексп формата; выпавший `astimezone` его бы пережил | AC-2 |
| `test_status_catalog_name_travels_from_the_selector_into_the_book` | `"DUTY" in cells` — это КОД, он печатается всегда. С `status_names={}` вся API-сюита оставалась зелёной ⇒ подключение `StatusTypeSelector` не было доказано | AC-3, Решение №6 |
| `test_audit_counters_are_not_interchangeable` | `roster_size == 1` и `row_count == 1` — перепутанные местами поля давали зелёный. Фикстура сделана асимметричной (3 ≠ 2) | AC-6 |
| `test_audit_records_the_exact_canonical_filename` | `endswith(".xlsx")` переживал и потерю даты, и потерю версии | AC-7 |
| `test_audit_write_failure_denies_the_file_instead_of_serving_it_silently` | AC-6 «нет журнала ⇒ нет выдачи» не имел теста вообще | AC-6 |
| `test_schema_guard_refuses_before_generating_any_bytes` | Отказ по схеме не проверялся на отсутствие xlsx-байтов в теле | AC-5 |
| `test_export_operation_is_declared_in_the_committed_schema` | `@extend_schema` ничем не пришпилен: `test_schema_drift` пропустит снятый декоратор, если схему перегенерировали | AC-8 |

Плюс усилен `test_unsupported_snapshot_schema_422_without_audit`: добавлен ассерт
`details["schema_version"] == repr(...)` — AC-5 требует оба ключа, проверялся один.

## Красная проба — 10 мутаций, 10 покраснений

Гейт, а не пожелание (ретро E9, AI-1). Бэкап — **копией файлов** в scratchpad,
не `git stash`/`checkout` (инцидент 9.6). Откат сверен по `md5sum`.

| # | Мутация прод-кода | Результат |
|---|---|---|
| 1 | `_submitted_at_label`: убран `.astimezone(...)` | 🔴 3 failed (2 unit + 1 API) |
| 2 | `status_names=StatusTypeSelector.names_map()` → `{}` | 🔴 1 failed |
| 3 | `roster_size` считает `rows` (поля перепутаны) | 🔴 1 failed |
| 4 | Имя файла теряет `_v{version}` | 🔴 1 failed |
| 5 | `details` теряет ключ `schema_version` | 🔴 4 failed |
| 6 | `record(...)` обёрнут в `try/except: pass` | 🔴 1 failed |
| 7 | Билдер заводит свою сортировку `roster` | 🔴 1 failed |
| 7b | Сортировка строк внутри сотрудника | 🔴 1 failed |
| 8 | Из паспорта выпала строка «Опоздание» | 🔴 1 failed |
| 9 | Описание в схеме = докстринг `RequirePermissionMixin` | 🔴 1 failed |
| 10 | `_assert_snapshot_schema_supported` снят | 🔴 1 failed |

**Итог целостности:** `md5sum` всех трёх тронутых прод-файлов после отката
совпадает с до-мутационным (`16f208ce…` / `aaf8cb01…` / `25fa7c97…`).

## Уточнение, всплывшее пробой №6

Ожидание «падение `record` пробросится наружу» **оказалось неверным**: в проекте
есть общий обработчик (`apps/core/api/exception_handler.py`), который ловит
необработанное исключение на границе API и отдаёт **500**. Тест приведён к
фактическому поведению — и оно ровно то, чего требует AC-6 («падение записи
обязано дать 500»). Ассертов три: код 500, отсутствие zip-сигнатуры `PK` в теле
(байты к этому моменту уже сгенерированы — соблазн «отдать всё равно» реален) и
пустой журнал `SUBMISSION_EXPORTED`.

## Покрытие

- **API-эндпоинт:** 1/1 (`GET /api/operations/daily-submissions/{id}/export/`)
- **AC стори:** AC-1…AC-9 — прямые тесты есть у каждого. AC-10 (гейты) и AC-11
  (трекинг преемника) — процедурные, тестами не выражаются.
- **HTTP-коды:** 200, 403 (аноним + чужой скоуп), 404, 405 (`put/patch/delete` +
  `POST` как отдельный случай), 422, 500 — все с прямым тестом.
- **RBAC:** роут в `MATRIX` — поведенчески покрыт по 8 ролям + анониму
  (`test_rbac_matrix.py`), отдельного теста не требует.
- **E2E (браузерные):** **не применимы** — стори чисто бэковая. UI-кнопка «моя
  копия» живёт в **10.8a** (`backlog`); до неё браузерной поверхности нет.

## Гейт

```
cd Backend/VAPS && make gate
→ 2469 passed, 56 deselected in 76.93s   (было 2458 — ровно +11)
→ ruff check . — чисто (E,F, длина 88)
→ makemigrations --check → No changes detected
gate duration: 80s
```

Фронтовый гейт **не запускался осознанно**: правки QA — только бэковые тестовые
файлы, `frontend/**` не тронут. В worktree параллельно лежат незакоммиченные
правки 10.7 по фронту — запуск дал бы шум чужой стори, а не сигнал по 10.8.

## Файлы

**Изменено (только тесты):**
- `Backend/VAPS/apps/operations/submissions/tests/test_personal_export.py` — +4 теста, 1 усилен
- `Backend/VAPS/apps/operations/submissions/tests/test_personal_export_api.py` — +7 тестов, 1 усилен

Прод-код, схемы, реестры, `sprint-status.yaml` — **не тронуты**.

## Что осталось за скобкой

- **`late=True` не гоняется сквозной цепочкой** — только unit-ом билдера. Чтобы
  довести до HTTP, нужна сдача после дедлайна контроля; ценность ниже стоимости
  фикстуры, флаг тривиально копируется из модели в шапку.
- **10.8a** закроет epic-AC полностью: файл отдаётся и аудируется, но забрать его
  из интерфейса оператор пока не может.
