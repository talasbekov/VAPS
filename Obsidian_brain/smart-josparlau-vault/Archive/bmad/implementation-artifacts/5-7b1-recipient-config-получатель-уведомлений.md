---
baseline_commit: 6b72460 (HEAD на ветке e3-catchup-clock-concurrency) + НЕзакоммиченные code-review-фиксы 5.7a. E1–E4 done; 5.1–5.7a done; epic-5 in-progress.
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/5-7a-notification-модель-notify.md
  - _bmad-output/implementation-artifacts/5-7b2-catch-up-детект-отставания.md
---

# Story 5.7b1: Recipient-config — получатель уведомлений об отставании (per-division + fallback)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПРОИСХОЖДЕНИЕ: ПРЕРЕКВИЗИТ, выделенный при create-story 5.7b (2026-07-01, реш. Bratan Q1=B):
     «дивизион→ответственный» НЕ был смоделирован (Q2 из 5.7a; подтверждено сканом кодовой базы —
     core.Division без head/manager, Notification.recipient — плоская строка, резолюция отложена).
     Bratan выбрал Option B (конфигурируемый получатель) + Q1b (глобальный fallback) + гранулярность
     per-division. По decomposition-правилам CLAUDE.md моделирование = отдельная стори от catch-up-джобы →
     5.7b расщеплена на 5.7b1 (ЭТА — модель/справочник получателей) + 5.7b2 (джоба, зависит от 5.7b1).

     ЦЕНТРАЛЬНЫЙ ФАКТ (ground-truth): справочник `DivisionNotifyRecipient` (division_id→recipient, flat
     ARCH-003, admin-managed «справочник») + глобальный `default_notify_recipient` на
     `SubmissionControlSettings` (дежурный-fallback, Q1b) + bulk-селектор
     `NotifyRecipientSelector.resolve_many(division_ids) → {division_id: recipient}` (специфичный ИЛИ fallback).
     Живёт в `apps/operations/submissions` (рядом с control_settings; recipient — плоский actor-id ARCH-007).

     ⚠️ ТРАПЫ: (1) НЕ FK на core.Division — division_id плоский UUID (ARCH-003); (2) recipient
     non-blank+strip (edit-safety, зеркало 2.12); (3) `default_notify_recipient` может быть пуст —
     тогда несопоставленный дивизион отсутствует в resolve_many-map (получателя нет → джоба 5.7b2
     логирует+skip); (4) `DivisionNotifyRecipient` — СПРАВОЧНИК (admin-регистрация РАЗРЕШЕНА; в отличие
     от бизнес-записей); (5) resolve_many — bulk (NFR-4), НЕ per-division-запрос в цикле; (6) НЕ здесь:
     catch-up/детект (5.7b2), notify (5.7a), API (5.7c). -->

## Story

As a **система уведомлений об отставании**,
I want **конфигурируемый маппинг «дивизион→получатель» (справочник) + глобальный дежурный-получатель как fallback + bulk-селектор `resolve_many`**,
so that **catch-up-джоба 5.7b2 может детерминированно резолвить, кому слать уведомление об отставании управления — закрывая пробел «дивизион→ответственный», который 5.7a оставил (Q2) и который в системе не смоделирован**.

## Acceptance Criteria

1. **Справочник `DivisionNotifyRecipient`.** **Then** модель `DivisionNotifyRecipient(TimeStampedModel)` с полями: `division_id` (UUIDField, `unique=True` — один получатель на дивизион; flat-ссылка ARCH-003 на `core_divisions.id`, БЕЗ FK), `recipient` (CharField max_length=100 — actor-id получателя, ARCH-007). `Meta.db_table`. [Source: ARCH-003; control_settings.py-образец flat-UUID]
2. **Глобальный fallback.** **Then** `SubmissionControlSettings.default_notify_recipient` (CharField max_length=100, `blank=True`, default="") — дежурный-получатель для дивизионов без специфичной записи (Q1b). [Source: реш. Bratan Q1b; control_settings.py singleton]
3. **Миграции.** **When** `makemigrations`, **Then** миграция(и) для `DivisionNotifyRecipient` (new table) + добавления `default_notify_recipient` в `SubmissionControlSettings`; `makemigrations --check` после — пуст. [Source: NFR-8]
4. **Bulk-селектор `resolve_many`.** **Then** `NotifyRecipientSelector.resolve_many(division_ids) -> dict[UUID, str]` — по каждому дивизиону из входа возвращает специфичного `recipient` (из `DivisionNotifyRecipient`), иначе `default_notify_recipient` если он непустой; если ни специфичного, ни fallback — дивизион **отсутствует** в результате (получателя нет). **Bulk** — один запрос по справочнику (`division_id__in`) + один `get` настроек, БЕЗ per-division-запросов в цикле (NFR-4). [Source: NFR-4; selectors.py current_for_many-образец]
5. **Admin (справочник).** **Then** `DivisionNotifyRecipient` зарегистрирован в admin (это СПРАВОЧНИК — регистрация разрешена, в отличие от бизнес-записей); `default_notify_recipient` редактируется через существующий admin `SubmissionControlSettings`. [Source: architecture.md «Admin = только справочники»; arch-guard]
6. **Edit-safety валидаторы.** **Then** `recipient` non-blank+strip (пустой/whitespace отвергается); `unique` на `division_id` (constraint) — не более одной записи на дивизион. [Source: 2.12 edit-safety-валидаторы образец; block_override strip-паттерн 5.6b]
7. **Границы + гейт.** **Then** 5.7b1 НЕ: catch-up/детект отставания (5.7b2) / `notify()` (5.7a) / read-API (5.7c) / резолюция «когда слать» (control_hour — джоба). `make gate` зелёный, `ruff` чист, `makemigrations --check` пуст, submissions `test_isolation` зелёный. [Source: реш. границы; NFR-8]

## Tasks / Subtasks

- [x] **Task 1 — модель `DivisionNotifyRecipient` + миграция (AC: 1,3,6)**
  - [x] `apps/operations/submissions/models/division_notify_recipient.py`: `DivisionNotifyRecipient(TimeStampedModel)` — `division_id` (UUIDField, `unique=True`), `recipient` (CharField(100)). `Meta`: `db_table="division_notify_recipients"`, `constraints=[CheckConstraint(~Q(recipient__regex=r"^\s*$"))]` (non-blank, паттерн 5.6b). БЕЗ FK на core. `clean()` (strip+reject-blank) + `__str__`.
  - [x] Экспорт в `submissions/models/__init__.py`.
  - [x] `makemigrations ops_submissions` → миграция 0005 (new table + add-column одним файлом); `--check` пуст.
- [x] **Task 2 — `default_notify_recipient` на `SubmissionControlSettings` + миграция (AC: 2,3)**
  - [x] `models/control_settings.py`: `default_notify_recipient = models.CharField(max_length=100, blank=True, default="")` (глобальный дежурный).
  - [x] `makemigrations ops_submissions` → add-column вошёл в миграцию 0005; `--check` пуст.
- [x] **Task 3 — bulk-селектор `NotifyRecipientSelector.resolve_many` (AC: 4)**
  - [x] `submissions/selectors.py`: `class NotifyRecipientSelector` + `@staticmethod resolve_many(division_ids) -> dict` — один `DivisionNotifyRecipient.objects.filter(division_id__in=division_ids)` → map; `default = SubmissionControlSettingsSelector.get().default_notify_recipient`; для каждого division_id: specific if present else (default if default else пропустить). Bulk (2 запроса, инвариант к размеру входа).
- [x] **Task 4 — admin + edit-safety (AC: 5,6)**
  - [x] `submissions/admin.py`: зарегал `DivisionNotifyRecipient` (list_display division_id/recipient + search_fields; справочник). Обновил arch-guard allowlist (`test_admin_platform.py::CATALOG_MODELS`) — иначе `test_admin_registry_is_exactly_catalogs` красный.
  - [x] `clean()` для `recipient` non-blank+strip (edit-safety через ModelForm.full_clean); `unique(division_id)` даёт IntegrityError на дубле.
- [x] **Task 5 — тесты (AC: 1,2,4,6)**
  - [x] `submissions/tests/test_notify_recipient.py` (django_db, 17 тестов): db_table/поля/str; `unique(division_id)` (дубль → IntegrityError); recipient non-blank на DB (""/whitespace → IntegrityError) + `clean` (strip / reject-blank → ValidationError); `default_notify_recipient` shape+default; `resolve_many` — специфичный побеждает / несопоставленный → fallback / fallback пуст → отсутствует / mixed / empty input; **bulk** (`CaptureQueriesContext` == 2, инвариант к размеру).
  - [x] Регрессия: `make gate` зелёный (1602 passed, 24 deselected, 29s); `makemigrations --check` пуст; ruff чист (format by-file на миграции); `test_isolation` зелёный (production-код без `import apps.core.models`).

## Dev Notes

### Цель (одним предложением)
Справочник получателей уведомлений об отставании (`DivisionNotifyRecipient` per-division + глобальный `default_notify_recipient`-fallback) + bulk-`resolve_many` — детерминированная резолюция «кому слать», фундамент для catch-up-джобы 5.7b2.

### 🔑 Решения по реализации (подтверждены Bratan 2026-07-01)
- **Q1=B** — конфигурируемый получатель (не last-submitter). **Q1b** — глобальный fallback. **Гранулярность** — per-division справочник + global fallback.
- **Размещение — `apps/operations/submissions`** (рядом с `control_settings`; recipient — плоский actor-id). НЕ в notifications (import-direction; notifications — leaf-sink).
- **`DivisionNotifyRecipient` — справочник** (config, admin-managed), НЕ бизнес-запись → admin-регистрация РАЗРЕШЕНА (в отличие от `Notification`/`DailySubmission`).
- **resolve_many-семантика:** specific → fallback(если непустой) → отсутствует. Пустой `default_notify_recipient` = «нет дежурного» → несопоставленный дивизион не резолвится (5.7b2 логирует+skip такой; но с настроенным дежурным этого не будет).

### Что УЖЕ есть — переиспользовать / НЕ дублировать
- **`TimeStampedModel`** (`apps/operations/models.py`) — база (created_at/updated_at/created_by; abstract).
- **`SubmissionControlSettings`** (`models/control_settings.py:9`) — singleton (`singleton_key`), уже несёт `control_hour`/`required_division_ids`; сюда добавить `default_notify_recipient`. Селектор `SubmissionControlSettingsSelector.get()` (`selectors.py:104`).
- **Bulk-образец:** `DailySubmissionSelector.current_for_many` (`selectors.py:24`) — `filter(..._id__in=...)` → dict; зеркалить для `resolve_many`.
- **Flat-UUID + unique образец:** `models/tomorrow_block_override.py` (flat business_date + UniqueConstraint). **strip/blank-guard:** `services/block_override.py:25-33`. **edit-safety справочников:** 2.12.
- **Admin-регистрация справочника:** 2.11 (регистрация справочников в admin).

### Архитектурные правила
- **ARCH-003:** `division_id` — плоский UUID, БЕЗ FK на `core.Division`. `recipient` — плоская строка (ARCH-007 actor-id).
- **ARCH-004:** 5.7b1 — submissions-internal; НЕ `import apps.core.models`. (Валидация существования division_id против live-Division — НЕ здесь; тот же класс, что defer 5.6a «протухший required-id»; admin-ввод + опц. сверка на 2.3/2.8.)
- **Admin = справочники:** `DivisionNotifyRecipient` — справочник → регать МОЖНО. `Notification` (5.7a) — бизнес-запись → НЕ регать (не путать).
- **NFR-4:** `resolve_many` bulk (один filter), не N+1.

### Поток (псевдокод)
```python
# models/division_notify_recipient.py
class DivisionNotifyRecipient(TimeStampedModel):
    division_id = models.UUIDField(unique=True)     # flat ARCH-003, без FK
    recipient = models.CharField(max_length=100)
    class Meta:
        db_table = "division_notify_recipients"

# models/control_settings.py (+поле)
default_notify_recipient = models.CharField(max_length=100, blank=True, default="")

# selectors.py
class NotifyRecipientSelector:
    @staticmethod
    def resolve_many(division_ids) -> dict:
        specific = {
            r.division_id: r.recipient
            for r in DivisionNotifyRecipient.objects.filter(division_id__in=division_ids)
        }
        default = SubmissionControlSettingsSelector.get().default_notify_recipient
        out = {}
        for did in division_ids:
            rec = specific.get(did) or (default or None)
            if rec:
                out[did] = rec
        return out
```

### Project Structure Notes
- **CREATE:** `submissions/models/division_notify_recipient.py` + миграция(и) · `submissions/tests/test_notify_recipient.py` · (`submissions/admin.py` если нет). **MODIFY:** `models/__init__.py` (экспорт) · `models/control_settings.py` (+поле) · `selectors.py` (+`NotifyRecipientSelector`) · `admin.py` (регистрация). Содержательных ~3 (модель + поле + селектор) + admin + тесты. **≤5 файлов** content.
- **НЕ трогать:** notifications, core, statuses, RBAC. НЕ catch-up/notify/API.

### References
- [Source: epics.md:751-765 (Story 5.7 декомпозиция; 5.7b нота «notify() ответственным»)] · [architecture.md:745 (ARCH-003) · :746 (ARCH-004) · «Admin = только справочники» · :451 (bulk-селекторы NFR-4)].
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py:9 · selectors.py:24,104 · models/tomorrow_block_override.py · services/block_override.py:25-33].
- [Source: 5-7a-notification-модель-notify.md (Notification.recipient — плоский actor-id; Q2 резолюция отложена сюда)] · [5-7b2-catch-up-детект-отставания.md (потребитель resolve_many)].

### Открытые вопросы (для Bratan — подтвердить при dev)
- **Q(a)** — валидация `division_id` против live-`core.Division` при admin-вводе (протухший/удалённый id даст «получателя в никуда»). Дефолт: НЕ валидировать в 5.7b1 (тот же класс, что defer 5.6a required-id) — admin-ответственность / опц. на 2.3. Ок?
- **Q(b)** — нужен ли аудит изменений справочника получателей (кто менял recipient)? Дефолт: нет (config-справочник; при желании — стандартный admin LogEntry). 

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]) — bmad-dev-story, TDD (red→green→refactor).

### Debug Log References

- RED: `test_notify_recipient.py` → `ImportError: DivisionNotifyRecipient` (до реализации).
- GREEN: новый тест-файл 17/17 passed на Postgres :5433.
- Регрессия-ловушка: `test_admin_platform.py::test_admin_registry_is_exactly_catalogs` покраснел на admin-регистрации нового справочника (arch-guard «Admin = ровно справочники») → добавил `DivisionNotifyRecipient` в `CATALOG_MODELS`. Это следствие AC-5, а не scope-creep.
- `make gate` зелёный: 1602 passed, 24 deselected, ruff чист, `makemigrations --check` → «No changes detected», 29s (< 300s NFR-8).

### Completion Notes List

- **AC-1** `DivisionNotifyRecipient(TimeStampedModel)` — `division_id` UUIDField `unique=True` (flat ARCH-003, БЕЗ FK), `recipient` CharField(100), `db_table="division_notify_recipients"`, `clean()` + `__str__`.
- **AC-2** `SubmissionControlSettings.default_notify_recipient` CharField(100, blank=True, default="") — глобальный дежурный-fallback (Q1b).
- **AC-3** миграция `0005_...` — AddField + CreateModel одним файлом (dep 0004); `makemigrations --check` пуст.
- **AC-4** `NotifyRecipientSelector.resolve_many(division_ids) -> dict` — specific → fallback (если непустой) → отсутствует; **bulk** = 1 filter + 1 settings.get (2 запроса, инвариант к размеру входа, NFR-4). `recipient` non-blank по constraint → `or`-short-circuit безопасен.
- **AC-5** admin-регистрация `DivisionNotifyRecipientAdmin` (справочник; в отличие от бизнес-записей Notification/DailySubmission). Arch-guard allowlist обновлён.
- **AC-6** edit-safety: DB `CheckConstraint(~Q(recipient__regex=r"^\s*$"))` (rejects "" И whitespace, bypass-proof — паттерн 5.6b) + `clean()` strip/reject (понятная ошибка в admin вместо raw 500); `unique(division_id)` — не более одной записи на дивизион.
- **AC-7 границы:** НЕ catch-up/детект (5.7b2), НЕ `notify()` (5.7a), НЕ read-API (5.7c), НЕ «когда слать» (control_hour). Production-код submissions-internal (ARCH-004 — без `import apps.core.models`; isolation зелёный).
- **Открытые Q(a)/Q(b)** оставлены как в спеке (дефолты): валидация `division_id` против live-Division — НЕ здесь (тот же класс, что defer 5.6a required-id; admin-ответственность); аудит справочника — нет (config).

### Change Log

- 2026-07-01 — 5.7b1 реализация: модель `DivisionNotifyRecipient` + поле `default_notify_recipient` + селектор `resolve_many` + admin + миграция 0005 + 17 тестов. `make gate` зелёный. Status → review.

### File List

**Created:**
- `Backend/VAPS/apps/operations/submissions/models/division_notify_recipient.py`
- `Backend/VAPS/apps/operations/submissions/migrations/0005_submissioncontrolsettings_default_notify_recipient_and_more.py`
- `Backend/VAPS/apps/operations/submissions/tests/test_notify_recipient.py`

**Modified:**
- `Backend/VAPS/apps/operations/submissions/models/__init__.py` (экспорт)
- `Backend/VAPS/apps/operations/submissions/models/control_settings.py` (+`default_notify_recipient`)
- `Backend/VAPS/apps/operations/submissions/selectors.py` (+`NotifyRecipientSelector`, +импорт)
- `Backend/VAPS/apps/operations/submissions/admin.py` (регистрация справочника + `default_notify_recipient` в list_display)
- `Backend/VAPS/apps/core/tests/test_admin_platform.py` (arch-guard allowlist `CATALOG_MODELS`)

## Review Findings

Adversarial code-review (bmad-code-review, 2026-07-01, Opus 4.8) — 3 параллельных слоя:
Blind Hunter / Edge Case Hunter / Acceptance Auditor. Все 7 AC substantively satisfied,
scope-leak нет (без notify/catch-up/API/`import apps.core.models`), Critical/High-AC-нарушений нет.
Триаж: 1 decision-needed · 3 patch · 0 defer · 2 dismissed.

### Decision-needed (resolved 2026-07-01 → вариант 1: DB-constraint + selector-strip · FIXED)

- [x] [Review][Patch] **Асимметричная нормализация recipient** (whitespace-fallback + padded) —
  **РЕШЕНИЕ Bratan (вар.1) · ПРИМЕНЕНО:** DB-`CheckConstraint`
  `ck_submission_control_settings_duty_not_whitespace` на `default_notify_recipient`
  (allow `""` / reject `^\s+$`, `control_settings.py` + `AddConstraint` в миграции 0005) +
  `.strip()`-нормализация default и specific в `resolve_many` (`selectors.py`). Тесты:
  `test_default_notify_recipient_rejects_whitespace_only` / `_allows_blank` /
  `test_resolve_many_strips_padded_specific_recipient`.
  - [orig] 
  `SubmissionControlSettings.default_notify_recipient` без guard (в отличие от per-division `recipient`,
  у которого DB-CheckConstraint + `clean`): значение `"   "` truthy → `resolve_many` эмитит его как валидного
  «дежурного» (`selectors.py:157` `default or None` + `if recipient:`), хотя семантика AC-4 «fallback если непустой» =
  «нет дежурного». Плюс padded `"  boss  "` переживает `.create()`/`bulk_create` (strip живёт только в `clean()`;
  CheckConstraint `^\s*$` ловит лишь полностью-пустое) → уходит в `resolve_many` как routing-ключ.
  Где энфорсить? (i) DB-CheckConstraint на `default_notify_recipient` (allow "" / reject `^\s+$`) + приём padded as-is
  [твой DB-integrity преференс, +миграция], (ii) центральный `.strip()` в `resolve_many` [zero-migration, чинит оба],
  (iii) оба. [blind+edge+auditor]

### Patch (all FIXED 2026-07-01)

- [x] [Review][Patch] `resolve_many` input-fragility [`Backend/VAPS/apps/operations/submissions/selectors.py`] —
  `division_ids` итерировался дважды: dict-comprehension через `.filter(division_id__in=...)` исчерпывал
  generator/iterator → второй `for`-loop пуст → возврат `{}` (silent no-op, 5.7b2 никого не уведомит);
  string-UUID вход ронял per-division recipient (ключи `specific` — `UUID`-объекты из `from_db_value`, а `.get()`
  по сырой строке промахивался → тихий fallback/drop); `None` во входе при заданном default → `{None: default}`.
  **FIX:** `division_ids = [did for did in division_ids if did is not None]` (materialize + drop None) +
  ключи `str(...)` обе стороны. Тесты: `test_resolve_many_accepts_generator_input` /
  `_resolves_string_uuid_input` / `_drops_none_ids`.
- [x] [Review][Patch] `search_fields` над `UUIDField`
  [`Backend/VAPS/apps/operations/submissions/admin.py`] — admin-поиск строил `ILIKE` по `uuid`, оператора нет
  на Postgres → `ProgrammingError` 500 при поиске. **FIX:** `search_fields = ("recipient",)` (убран `division_id`).
- [x] [Review][Patch] Test-hardening [`Backend/VAPS/apps/operations/submissions/tests/test_notify_recipient.py`] —
  **FIX:** `test_resolve_many_fallback_only_is_bulk` (query-count fallback-пути == 2, AC-4/NFR-4) +
  `test_division_notify_recipient_field_shape` (`recipient.max_length == 100`, `division_id.unique`, AC-1).

### Dismissed (noise / by-design)

- Хрупкий `assert n6 == 2` (test:451) — стабилен: тест pre-warm'ит singleton (`get()` = 1 SELECT при
  существующей строке), а точный счётчик — намеренный NFR-4-guard, не дефект.
- `db_table="division_notify_recipients"` без `ops_`-префикса — имя **явно задано спекой** (AC-1 L44 + псевдокод),
  код spec-compliant; конвенция-деviation by-design.
