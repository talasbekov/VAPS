---
baseline_commit: 91f33554
---

# Story 20.4c: Экспорт аудита — CSV (билдер, метаданные без payload)

Status: done

## Story

As a **держатель права экспорта** (руководитель/кадровик),
I want **получить `.csv` с журналом аудита (кто/что/когда/над каким объектом), БЕЗ содержимого изменений**,
so that **FR-40's «экспорт... аудита» закрыт для третьей из трёх сущностей, тем же принципом, что 13.2's диагностический экспорт УЖЕ решил — метаданные безопасны, произвольный JSON-диф — нет**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (третий срез, РЕШАЕТ открытый вопрос 20.4a)

**Ключевая находка (research-агент)**: 20.4a's Out of Scope явно оставил «редакция payload не решена этой стори» открытым вопросом. Прецедент УЖЕ существует и УЖЕ решил ЭТОТ ЖЕ вопрос для другого контекста: `apps/audit/diagnostics_export.py:76-95` (`_audit_log_payload()`, Story 13.2) **сознательно исключает `old_value`/`new_value`** — комментарий прямо формулирует причину: «это где живёт реальный риск PII бизнес-данных (напр. поля сотрудника, идущие через аудируемую мутацию) — проще и безопаснее опустить всю колонку, чем сканировать произвольный вложенный JSON на содержимое». **Эта стори ПЕРЕИСПОЛЬЗУЕТ то же решение** — не изобретает новое, не решает вопрос «а если payload всё-таки нужен» (это была бы отдельная будущая стори с явным PII-сканированием, если/когда запросят).

- **`build_audit_csv(rows) -> bytes`** — в `apps/core/exports/audit_csv.py` (новый модуль, тот же package). **БЕЗ `user_permissions`-параметра** (тот же принцип, что 20.4b — метаданные, не чувствительные поля, гейтинг экспорта — API-слой).
- **Экспортируемые колонки (8, ТОЛЬКО метаданные)**: `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `request_id`, `ip_address`, `created_at` — зеркалит `AuditLog`'s собственные non-payload поля (`apps/audit/models.py:29-56`). **`old_value`/`new_value` НЕ экспортируются** (та же причина, что 13.2). **`reason`/`user_agent` тоже не экспортируются** — не запрошены, не установлен прецедент их полезности в этом контексте (YAGNI, не «раз уж экспортируем метаданные — экспортируем всё подряд»).
- **`actor_user_id` — безопасен как есть, БЕЗ маскирования**: это НЕ FK на `Employee` (`apps/audit/models.py:16-18`, докстринг «authenticated actor id from the request» — BR-ACCOUNT-002, тот же принцип, что уже применяется в существующем audit read API, `apps/audit/api/serializers.py:15`, без редакции). Маскирование `actor_user_id` противоречило бы самой цели аудита (подотчётность).
- **Общая нормализация значений — ИЗВЛЕКАЕТСЯ из `history_csv.py` в `csv_safety.py`** (20.4b's `_cell()`-хелпер, `None`→`""` + `datetime`→ISO, сейчас инлайнен только в `history_csv.py`) — та же логика нужна ЗДЕСЬ (`created_at` — datetime), дублирование запрещено тем же принципом, что уже применён к formula-injection хелперу в 20.4b.
- **Построение `rows` (селектор AuditLog, `AuditLogSelector.list()`-based) — ВНЕ СКОУПА этой стори** (тот же принцип, что 20.4a/20.4b — билдер принимает уже собранные `dict`, вызывающий код строит запрос).
- **Out of scope**: `old_value`/`new_value`-экспорт (сознательно решено НЕ делать, тот же прецедент 13.2 — не «отложено», а РЕШЕНО НЕТ без нового явного запроса); API/эндпоинт HTTP-слоя; маскирование `actor_user_id` (не требуется); XLSX-версии (20.4d/e/f); построение `rows` (селектор — будущая стори при явном запросе).

## Acceptance Criteria

1. **AC-1.** CSV содержит строку-заголовок с именами 8 колонок (`id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `request_id`, `ip_address`, `created_at`) — БЕЗ `old_value`/`new_value`/`reason`/`user_agent`.
2. **AC-2.** Строка с заполненными метаданными → CSV содержит все 8 значений корректно.
3. **AC-3.** `created_at` как сырой `datetime` → ISO-нормализация (тот же общий хелпер, что 20.4b, теперь в `csv_safety.py`).
4. **AC-4.** Пустой список `rows=[]` → CSV только с заголовком, без строк данных, без исключения.
5. **AC-5.** `action`/`entity_type`/`request_id`/`user_agent`-подобное поле, начинающееся с `=`/`+`/`-`/`@` → защищено ведущим апострофом (общий CWE-1236-хелпер).
6. **AC-6.** Даже если вызывающий код ОШИБОЧНО положит `old_value`/`new_value` в `rows`-dict, билдер их НЕ рендерит (колонки билдера — фиксированный allowlist `AUDIT_CSV_COLUMNS`, не «всё, что есть в dict»​) — тест, доказывающий allowlist-дисциплину, не просто отсутствие в дефолтной фикстуре.
7. **AC-7.** Регрессия: `history_csv.py`'s существующие тесты (20.4b, включая тест `datetime`-нормализации) проходят БЕЗ ПРАВОК после извлечения общего хелпера нормализации в `csv_safety.py`.
8. **AC-8.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экспорт `old_value`/`new_value` (сознательно решено НЕ делать, прецедент 13.2's `diagnostics_export.py`).
- API/эндпоинт HTTP-слоя.
- Маскирование `actor_user_id` (не требуется, не FK на Employee).
- XLSX-версии (20.4d/e/f).
- Построение `rows` (селектор с `AuditLogSelector.list()`, будущая стори при явном запросе).

## Tasks / Subtasks

- [x] Task 1 — `apps/core/exports/csv_safety.py`: извлечь `_cell()`-нормализацию (None→"", datetime→ISO) из `history_csv.py` как `normalize_value()`, без изменения поведения.
- [x] Task 2 — `apps/core/exports/history_csv.py`: переключить на `normalize_value()` из `csv_safety.py`, удалить дублирующий инлайн (регрессия: существующие тесты не трогать).
- [x] Task 3 — `apps/core/exports/audit_csv.py` (новый файл): `build_audit_csv(rows) -> bytes`, allowlist из 8 колонок (`AUDIT_CSV_COLUMNS`), `old_value`/`new_value`/иные ключи в `rows`-dict игнорируются молча (allowlist, не blocklist).
- [x] Task 4 — Тесты (AC 1-8): `apps/core/tests/test_audit_csv_export.py` (новый, включая тест AC-6 «payload в rows не просачивается») + прогон `apps/core/tests/test_history_csv_export.py` без правок (регрессия AC-7).
- [x] Task 5 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/audit/diagnostics_export.py:76-95` (`_audit_log_payload()`, Story 13.2) — ПРЕЦЕДЕНТ решения «не экспортировать payload», процитировать/зеркалить обоснование в докстринге нового модуля, не изобретать заново.
- `apps/audit/models.py:29-56` (`AuditLog`) — полный список полей: `id`, `actor_user_id` (str, НЕ FK), `action`, `entity_type`, `entity_id` (UUID), `old_value`/`new_value` (JSONField, nullable — НЕ экспортируются), `reason` (TextField — НЕ экспортируется), `request_id`, `ip_address`, `user_agent` (TextField — НЕ экспортируется), `created_at`.
- `apps/audit/selectors.py:13-64` (`AuditLogSelector.list()`) — единственный существующий read-путь, возвращает ORM QuerySet (не построчные dict) — эта стори НЕ строит новый метод здесь (селектор вне скоупа, будущая стори).
- `apps/core/exports/history_csv.py` (Story 20.4b, ПОСЛЕ ревью-патча) — `_cell()`-хелпер (ISO-нормализация datetime) СЕЙЧАС приватный/инлайнен только там — извлечь буквально в `csv_safety.py` под именем `normalize_value()`, тот же принцип, что уже применён к formula-injection хелперу в самой 20.4b.
- `apps/core/exports/csv_safety.py` (Story 20.4b) — `sanitize_cell()`/`FORMULA_TRIGGER_CHARS` уже здесь, добавить `normalize_value()` рядом (тот же модуль, обе функции — общая нормализация значений перед CSV-записью).
- **AC-6 — allowlist-дисциплина ЯВНО протестирована**: билдер строит `dict` из ФИКСИРОВАННОГО `AUDIT_CSV_COLUMNS`-кортежа через `{column: ... for column in AUDIT_CSV_COLUMNS}` (тот же паттерн, что `employee_csv.py`/`history_csv.py`) — НЕ через `row.items()`/распаковку всего dict. Это САМО ПО СЕБЕ защита от просачивания `old_value`, но тест должен явно передать `row` с `old_value`-ключом и доказать, что в CSV его нет — не полагаться на то, что фикстуры «просто не содержат» этот ключ.

### References

- [Source: _bmad-output/implementation-artifacts/20-4a-экспорт-сотрудников-csv.md] — открытый вопрос «редакция payload», который эта стори решает.
- [Source: _bmad-output/implementation-artifacts/20-4b-экспорт-истории-csv.md] — прецедент общего `csv_safety.py`, `_cell()`-хелпер для извлечения.
- [Source: Backend/VAPS/apps/audit/diagnostics_export.py#L76-95] — прецедент решения «не экспортировать payload», обоснование.
- [Source: Backend/VAPS/apps/audit/models.py#L29-56] — `AuditLog`, полный список полей.
- [Source: Backend/VAPS/apps/audit/selectors.py#L13-64] — `AuditLogSelector.list()`, единственный read-путь.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `_cell()` из `history_csv.py` перенесён в `csv_safety.py` как `normalize_value()` без изменения логики; `history_csv.py`'s существующие тесты прошли без правок.
- `make gate` (Backend/VAPS) — зелёный: 4452 passed, 0 regressions, `makemigrations --check` чист.
- Ревью (3 слоя, Blind Hunter + Edge Case Hunter + Acceptance Auditor — security-focus, PII-редакция): Acceptance Auditor подтвердил все 8 AC SATISFIED + явно проверил «нет ни одного пути кода, конструирующего строку/dict с old_value/new_value, даже транзитно» — чисто. Edge Case Hunter независимо подтвердил allowlist-тест ГЕНУИННО строгий (три независимых проверки: имена колонок отсутствуют, сырые значения ИИН отсутствуют, набор ключей результата ТОЧНО равен allowlist) и нашёл реальное расхождение с цитируемым прецедентом: `ip_address` — 8-я колонка ЗДЕСЬ, но её НЕТ в 13.2's `_audit_log_payload()` (7 полей) — недокументированное отличие. 2 patch применены: (1) добавлено явное обоснование `ip_address` (форензик-атрибут аудита, не бизнес-PII сотрудника) + явное упоминание, что `reason` намеренно НЕ экспортируется (тот же класс риска, что `old_value`/`new_value`, без активного regex-скраба, который есть у `BugReport.description`); (2) Blind Hunter нашёл методологический пробел — allowlist «гарантия» существует только в докстринге, ничто не ловит будущее неосторожное расширение кортежа `old_value`/`new_value`-подобным полем — добавлен явный тросик-тест `test_audit_csv_columns_never_include_payload_fields`. `make gate` после патчей — 4453 passed (+1). Остальное dismiss (Blind Hunter ошибочно утверждал «нет тестов вообще» — diff-only контекст, тесты реально существуют и покрывают AC; отсутствие type-валидации non-dict rows/BOM-кодировка — established convention, тот же класс, что уже принят 20.4a/b).

### Completion Notes List

- AC-1..AC-8 реализованы. `build_audit_csv(rows) -> bytes` — ТОЛЬКО метаданные (8 колонок), `old_value`/`new_value` НЕ экспортируются — переиспользует прецедент `diagnostics_export.py` (Story 13.2), не изобретает новое решение.
- AC-6 (allowlist-дисциплина) явно протестирован: `row`-dict с намеренно подложенными `old_value`/`new_value` (включая сырой ИИН) не просачивается в CSV — тест доказывает allowlist, не полагается на «фикстуры просто не содержат этот ключ».
- Общая нормализация (`normalize_value`, None→""/datetime→ISO) теперь в `csv_safety.py`, переиспользуется `history_csv.py` И `audit_csv.py` — не дублирование.
- `actor_user_id` экспортируется без маскирования — не FK на `Employee`, тот же принцип, что существующий read API аудита.
- Ревью-патчи: `ip_address` явно обосновано в докстринге (отличие от 13.2's прецедента), тросик-тест против будущего расширения allowlist.

### File List

- `Backend/VAPS/apps/core/exports/csv_safety.py` (modified — добавлена `normalize_value()`)
- `Backend/VAPS/apps/core/exports/history_csv.py` (modified — переключён на `normalize_value()`)
- `Backend/VAPS/apps/core/exports/audit_csv.py` (new, изменён ревью — докстринг-обоснование `ip_address`)
- `Backend/VAPS/apps/core/tests/test_audit_csv_export.py` (new, изменён ревью — тросик-тест)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-07 | Story создана (create-story). Третий срез FR-40's матрицы 3×2 (аудит×CSV). Research-агент нашёл и подтвердил прецедент решения «не экспортировать old_value/new_value» — `apps/audit/diagnostics_export.py`'s `_audit_log_payload()` (Story 13.2), процитированный обоснованием в 20.4a's Out of Scope как открытый вопрос. Эта стори закрывает вопрос переиспользованием того же решения, не изобретает новое. |
| 2026-08-07 | Dev-story: `normalize_value()` извлечён в `csv_safety.py` + `audit_csv.py` (`build_audit_csv`, allowlist 8 колонок) + 6 тестов, включая явный тест непросачивания payload. `make gate` (Backend/VAPS) — 4452 passed, 0 regressions. Status → review. |
| 2026-08-07 | Ревью-патчи (security-focus): обоснован `ip_address` (отличие от 13.2's прецедента), добавлен тросик-тест против будущего расширения allowlist payload-полями. `make gate` — 4453 passed, 0 regressions. Status → done. |
