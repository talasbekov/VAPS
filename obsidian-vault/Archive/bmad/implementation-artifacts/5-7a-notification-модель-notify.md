---
baseline_commit: 23b0074 (HEAD на ветке e3-catchup-clock-concurrency; E1–E4 done; 5.1–5.6b done+committed; epic-5 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/5-6b-override-сущность.md
  - _bmad-output/implementation-artifacts/5-2-модель-dailysubmission.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

# Story 5.7a: Notification модель + notify-сервис

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПРОИСХОЖДЕНИЕ: первая из трёх частей разбитой 5.7 «Notifications-backend» (2026-06-30, реш. Bratan,
     3-way сплит): 5.7a (модель + notify-сервис) + 5.7b (catch-up проверка отставания) + 5.7c (read-API).
     5.7b/5.7c ЗАВИСЯТ от 5.7a.

     ГРАНИЦА СКОУПА: 5.7a — персистентный примитив уведомления + идемпотентная notify()-эмиссия. НЕ делает:
     catch-up/«beat»-детект отстающих (5.7b); GET /notifications-API (5.7c); WS-доставку (E11); резолюцию
     «дивизион→ответственный» (5.7b — и там вскроется, что маппинга в системе пока НЕТ); RBAC/permission-коды (5.7c/API).

     ЦЕНТРАЛЬНЫЙ ФАКТ (ground-truth): новый `apps/notifications` app (top-level, как apps.audit; AppConfig+label,
     регистрация в config/settings.py INSTALLED_APPS). Модель `Notification` (recipient/kind/business_date/payload/
     read_at; flat ARCH-003, БЕЗ FK на core/operations) + `notifications.services.notify(...)` — ИДЕМПОТЕНТНАЯ
     эмиссия «одно на день» через `UniqueConstraint(recipient, kind, business_date)` + дубль→graceful (УРОК 5.6b:
     get_or_create / catch IntegrityError + transaction.atomic, НЕ raw IntegrityError). `on_commit`: в коде НЕТ ни
     одного `transaction.on_commit` — паттерн новый (см. Q1). Образцы модели+constraints: `DailySubmission`/
     `TomorrowBlockOverride` (flat-поля, CheckConstraint/UniqueConstraint, TimeStampedModel-база).

     ⚠️ ТРАПЫ: (1) дубль на (recipient,kind,date) → НЕ raw IntegrityError (урок 5.6b — отравляет внешнюю txn) →
     get_or_create ЛИБО catch+atomic; (2) НЕ FK на core/operations (ARCH-003/004) — recipient/payload flat;
     (3) НЕ регать в admin (бизнес-запись, не справочник); (4) НЕ вводить Celery (это 5.7b catch-up); (5) `notify`
     БЕЗ детекта отстающих и без резолюции получателя — это вход 5.7b; 5.7a лишь пишет то, что дали. -->

## Story

As a **система уведомлений**,
I want **персистентную модель `Notification` + идемпотентный сервис `notify(recipient, kind, business_date, …)`, создающий «одно уведомление на день» на (recipient, kind, business_date) и переживающий повторный вызов без дублей и без отравления транзакции**,
so that **отстающие смогут получать уведомления об отставании (FR-13) — 5.7b (catch-up-детект) и 5.7c (read-API) строятся на этом примитиве; доставка к WS — E11**.

## Acceptance Criteria

1. **Новый app `notifications`.** **Given** нужен дом уведомлений, **Then** создан `apps/notifications` (top-level, как `apps.audit`): `apps.py` (AppConfig, `label`), `__init__.py`, `models.py`, `services.py`, `migrations/`; зарегистрирован в `config/settings.py` INSTALLED_APPS. [Source: settings.py INSTALLED_APPS; apps.audit-образец]
2. **Модель `Notification`.** **Then** `Notification(TimeStampedModel)` с полями: `recipient` (CharField max_length=100 — flat actor-id «кому», как `submitted_by`), `kind` (CharField choices — TextChoices value-object, минимум `SUBMISSION_LAGGING`), `business_date` (DateField — о какой дате), `payload` (JSONField default=dict — детали, напр. `{laggard_division_ids}`), `read_at` (DateTimeField null=True — read/unread для 5.7c/E11); `created_at` из `TimeStampedModel` (= «когда»). Flat-ссылки (ARCH-003), БЕЗ FK на core/operations (ARCH-004). [Source: epics.md нота 5.7a; DailySubmission/TomorrowBlockOverride-образец]
3. **Идемпотентность «одно на день».** **Then** `UniqueConstraint(fields=["recipient", "kind", "business_date"], name=…)` — не более одного уведомления данного типа получателю за дату. [Source: epics.md 5.7 AC «идемпотентно — одно на день»]
4. **Миграция.** **When** `makemigrations`, **Then** ровно одна миграция `0001_notification` для `notifications`; `makemigrations --check` после — пуст. [Source: NFR-8]
5. **`notify()` идемпотентен и graceful на дубле.** **Given** `notify(recipient, kind, business_date, payload=…)`, **When** вызываю дважды с тем же ключом, **Then** создаётся РОВНО одна запись (второй вызов — no-op/возврат существующей), БЕЗ raw `IntegrityError` и БЕЗ отравления внешней транзакции (get_or_create ЛИБО catch `IntegrityError`+`transaction.atomic` — УРОК 5.6b). [Source: 5.6b dup-харднинг; FR-13 идемпотентность]
6. **on_commit-эмиссия.** **Given** `notify()` вызван внутри бизнес-транзакции, которая откатывается, **Then** уведомление НЕ остаётся (нет фантома) — эмиссия привязана к коммиту (`transaction.on_commit`). [Source: epics.md «notify (on_commit)»; см. Q1 — точная семантика]
7. **Границы + гейт.** **Then** 5.7a НЕ детектит отстающих (5.7b)/НЕ API (5.7c)/НЕ WS (E11)/НЕ Celery/НЕ резолвит получателя/НЕ admin-регистрация; `make gate` зелёный, `ruff` чист, `makemigrations --check` пуст. [Source: реш. границы]

## Tasks / Subtasks

- [x] **Task 1 — app-скелет `notifications` (AC: 1)**
  - [x] `apps/notifications/__init__.py`, `apps/notifications/apps.py` (`class NotificationsConfig(AppConfig)`, `default_auto_field="django.db.models.BigAutoField"`, `name="apps.notifications"`, `label="notifications"`), `migrations/__init__.py`.
  - [x] Регистрация `"apps.notifications"` в `config/settings.py` INSTALLED_APPS.
- [x] **Task 2 — модель `Notification` + миграция (AC: 2,3,4)**
  - [x] `apps/notifications/models.py`: `Notification(TimeStampedModel)` (база из `apps.operations.models`) — `recipient`/`kind`(TextChoices `Kind`)/`business_date`/`payload`(JSONField default=dict)/`read_at`(null=True). `Meta`: `db_table="notifications"`, `UniqueConstraint(recipient,kind,business_date)`. БЕЗ FK на core/operations.
  - [x] `makemigrations notifications` → `0001_notification`; `--check` пуст после.
- [x] **Task 3 — сервис `notify` (AC: 5,6)**
  - [x] `apps/notifications/services.py`: `notify(recipient, kind, business_date, payload=None) -> None` (или возврат записи) — идемпотентная эмиссия на (recipient,kind,business_date) через `transaction.on_commit`; дубль graceful (get_or_create ЛИБО catch `IntegrityError`+`transaction.atomic`, как `override_tomorrow_block` 5.6b). БЕЗ резолюции получателя/детекта (вход 5.7b).
- [x] **Task 4 — тесты (AC: 2–6)**
  - [x] `apps/notifications/tests/test_notify.py` (django_db): модель-поля/UniqueConstraint (дубль на ключе → IntegrityError при прямом create); `notify()` создаёт запись; повторный `notify()` с тем же ключом → одна запись, без raw IntegrityError, txn не отравлена (после — DB usable); on_commit — внутри `transaction.atomic`, откат → нет записи (`captured_on_commit_callbacks`/`TestCase.captureOnCommitCallbacks` или `pytest-django` аналог); payload сохраняется.
  - [x] Регрессия: `make gate` зелёный; `makemigrations --check` пуст; ruff чист; `test_isolation` (если notifications попадает под скан — проверить, что нет запрещённых импортов).

## Dev Notes

### Цель (одним предложением)
Персистентный примитив уведомления (`Notification` модель) + идемпотентная on_commit-`notify()` («одно на день», graceful-дубль) — фундамент для catch-up-детекта 5.7b и read-API 5.7c.

### Авторитет спеки (что строим и откуда)
- epics.md Story 5.7 + **Декомпозиция-нота 5.7a**: модель Notification + notifications.services.notify (on_commit), идемпотентно «одно на день».
- FR-13: уведомления об отставании (backend-часть; доставка к WS — E11).

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить; вопросы в конце)
- **Д1 — `recipient` = flat CharField(100)** (actor-id «кому», как `submitted_by`/`overridden_by`). 5.7a НЕ резолвит, кто ответственный за дивизион — это вход 5.7b (и там вскроется, что маппинга «дивизион→ответственный» в системе НЕТ → зависимость/вопрос 5.7b).
- **Д2 — `kind` = TextChoices** (value-object, мин. `SUBMISSION_LAGGING="SUBMISSION_LAGGING","Отставание по сдаче"`). Расширяемо; не error-код-реестр.
- **Д3 — идемпотентность на `(recipient, kind, business_date)`** через UniqueConstraint; `notify()` graceful на дубле (УРОК 5.6b: НЕ raw IntegrityError → отравляет txn). Реализация: `get_or_create(... defaults={payload})` (идемпотентно, первый payload побеждает) ЛИБО catch `IntegrityError`+`transaction.atomic`. Дефолт — `get_or_create` (проще, без race-окна при on_commit).
- **Д4 — on_commit-эмиссия** (`transaction.on_commit`): нет фантома при откате бизнес-txn. См. Q1 (точная семантика — on_commit-create vs in-txn-create).
- **Д5 — `payload` JSONField(default=dict)** — детали (напр. `{"laggard_division_ids": [...]}`); flat-данные, без FK.
- **Д6 — `read_at` DateTimeField(null=True)** — read/unread (GET ?since= 5.7c использует created_at; read_at — для unread-фильтра/UI/E11). Дёшево и forward-useful.
- **Д7 — `business_date` обязателен** (DateField, не null) — 5.7-уведомления дата-based (laggard-алерты); ключ идемпотентности требует. См. Q (нужны ли date-less уведомления когда-нибудь).

### Что УЖЕ есть — переиспользовать / НЕ дублировать
- `TimeStampedModel` (`apps/operations/models.py`) — база (created_at/updated_at; integer pk). NB: notifications — отдельный app, но базу можно импортнуть из operations (как submissions); ЛИБО завести свой timestamped-base (см. Q об app-изоляции). Дефолт: реюз `apps.operations.models.TimeStampedModel`.
- Образцы модели+constraints: `models/daily_submission.py`, `models/tomorrow_block_override.py` (flat-поля, UniqueConstraint, CheckConstraint-стиль).
- Дубль-graceful паттерн: `services/block_override.py::override_tomorrow_block` (5.6b — `transaction.atomic`+catch / get_or_create).
- App-регистрация: `apps.audit`/`apps.operations.submissions` apps.py (AppConfig+label) + INSTALLED_APPS.

### Архитектурные правила, которые 5.7a ОБЯЗАНА соблюсти
- **ARCH-003**: cross-context ссылки — flat (recipient строка, payload JSON, business_date) — без FK.
- **ARCH-004**: проверить направление импортов нового app (notifications не должен тянуть запрещённое; `notify` — чистый писатель). Если `test_isolation` сканирует только `operations/*` — notifications вне; но держать app чистым.
- **Admin = только справочники**: `Notification` — бизнес-запись, НЕ регать в admin.
- **НЕ Celery** (catch-up — 5.7b); 5.7a вообще не про scheduling.
- Дубль-обработка — урок 5.6b (raw IntegrityError отравляет внешнюю txn).

### Поток (псевдокод)
```python
# apps/notifications/models.py
class Notification(TimeStampedModel):
    class Kind(models.TextChoices):
        SUBMISSION_LAGGING = "SUBMISSION_LAGGING", "Отставание по сдаче"

    recipient = models.CharField(max_length=100)
    kind = models.CharField(max_length=50, choices=Kind.choices)
    business_date = models.DateField()
    payload = models.JSONField(default=dict)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "kind", "business_date"],
                name="uq_notification_recipient_kind_date",
            )
        ]

# apps/notifications/services.py
def notify(recipient, kind, business_date, payload=None) -> None:
    def _emit():
        Notification.objects.get_or_create(
            recipient=recipient, kind=kind, business_date=business_date,
            defaults={"payload": payload or {}},
        )
    transaction.on_commit(_emit)
```
(Q1: если нужна in-txn-атомарность с причиной — звать `_emit()` напрямую под внешним atomic вместо on_commit.)

### Подводные камни для dev-агента
- Дубль на ключе → graceful (get_or_create/catch+atomic), НЕ raw IntegrityError (5.6b).
- `on_commit`: при тесте использовать capture-on-commit (иначе callback не выполнится в тест-txn) — `pytest-django` `django_capture_on_commit_callbacks` фикстура.
- НЕ FK на core/operations (flat).
- НЕ регать в admin; НЕ Celery; НЕ резолвить получателя/детектить отстающих (5.7b).
- payload — JSON-сериализуемый (flat-данные; UUID → str если кладёшь division-ids).

### Previous-story интеллидженс (5.6b DONE, 5.2 модель)
- 5.6b: дубль через `.create()` без atomic = raw IntegrityError → отравление внешней txn (code-review HIGH). Применить урок: notify() graceful с первого раза.
- 5.6b: DB-инварианты через CheckConstraint/UniqueConstraint — устоявшийся паттерн (Bratan DB-integrity-преференс).
- 5.2 (DailySubmission): partial-unique immediate-режим — для notification unique простой (не partial).
- on_commit — нет прецедента в коде → новый; задокументировать паттерн.

### Технические версии / окружение
- Django ORM, `TimeStampedModel`, `TextChoices`, `JSONField`, `UniqueConstraint`, `transaction.on_commit`. Новых зависимостей НЕТ (НЕ Celery). РОВНО одна миграция (0001 нового app). `make gate` (Postgres :5433), `ruff` by-file.

### Project Structure Notes
- Файлы: **CREATE** `apps/notifications/{__init__,apps,models,services}.py` + `migrations/{__init__,0001_notification}.py` + `tests/{__init__,test_notify}.py` · **MODIFY** `config/settings.py` (INSTALLED_APPS). Содержательных: models + services (2) + app-boilerplate.
- **НЕ трогать:** operations/submissions (5.6a/5.6b derive/override — 5.7b будет их реюзить, не 5.7a), core, audit, RBAC.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.7 + Декомпозиция-нота 5.7a] — модель + notify (on_commit), идемпотентность «одно на день».
- [Source: _bmad-output/planning-artifacts/epics.md:44 (FR-13)] — уведомления об отставании.
- [Source: _bmad-output/planning-artifacts/architecture.md (ARCH-003 flat / ARCH-004 / NFR-8 / Admin=reference-only / E11 WS-доставка)].
- [Source: Backend/VAPS/config/settings.py — INSTALLED_APPS (регистрация app)].
- [Source: Backend/VAPS/apps/operations/models.py — `TimeStampedModel`].
- [Source: Backend/VAPS/apps/operations/submissions/models/tomorrow_block_override.py — flat-модель + UniqueConstraint/CheckConstraint образец].
- [Source: Backend/VAPS/apps/operations/submissions/services/block_override.py — дубль-graceful (atomic+catch / get_or_create), УРОК 5.6b].
- [Source: Backend/VAPS/apps/audit/apps.py — AppConfig+label образец нового app].

### Открытые вопросы (для Bratan — подтвердить при dev)
- **Q1 (главный) — `on_commit` семантика:** (A, дефолт) `transaction.on_commit(_emit)` — нет фантома при откате, но эмиссия ПОСЛЕ коммита (получатель не виден внутри той же txn; race на ключе закрыт get_or_create); (B) in-txn create под внешним atomic — атомарно с причиной, виден сразу, откат убирает. Что важнее для 5.7b (catch-up зовёт notify)?
- **Q2 — резолюция получателя:** 5.7a хранит flat `recipient`; маппинг «дивизион→ответственный» в системе НЕ смоделирован → 5.7b придётся решать (брать руководителя дивизиона? отдельный конфиг? пока actor сдачи?). Зафиксировать как зависимость 5.7b.
- **Q3 — `read_at` сейчас или defer:** дефолт включить (forward-useful для 5.7c/E11). Если хочешь минимальную модель — убрать, добавить в 5.7c.
- **Q4 — ключ идемпотентности:** `(recipient, kind, business_date)` = «одно на день». Подтвердить гранулярность (а не, скажем, +division).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story, TDD.

### Debug Log References

- App-label `notifications` (`makemigrations notifications` → `0001_initial`).
- RED: `test_notify.py` → ModuleNotFoundError `apps.notifications.services` (notify ещё нет).
- GREEN: 6/6 (on_commit-тесты через `django_capture_on_commit_callbacks(execute=True)`).
- Gate: `make gate` зелёный (Postgres :5433): ruff чист, 1579 passed (+6), `makemigrations --check` «No changes detected», 26s.

### Completion Notes List

- Новый app `apps/notifications` (top-level; `NotificationsConfig` label="notifications"; зарегистрирован в `config/settings.py` INSTALLED_APPS после `apps.audit`).
- Модель `Notification(TimeStampedModel)` — `recipient` CharField(100) / `kind` TextChoices (`SUBMISSION_LAGGING`) / `business_date` DateField / `payload` JSONField(default=dict) / `read_at` DateTimeField(null=True); `created_at` из базы. `UniqueConstraint(recipient, kind, business_date)` = «одно на день». Миграция `0001_initial`. flat ARCH-003 (без FK на core/operations).
- Сервис `notify(recipient, kind, business_date, payload=None)` — `transaction.on_commit(_emit)`; `_emit` = `get_or_create` на ключе (идемпотентно; первый payload побеждает). **get_or_create абсорбирует UniqueConstraint в своём savepoint** → дубль/race graceful, БЕЗ raw IntegrityError и без отравления внешней txn (УРОК 5.6b встроен на уровне ORM).
- **Дефолты применены:** Д1 recipient flat / Д2 kind TextChoices / Д3 ключ (recipient,kind,date) / Д4 on_commit (Q1=A) / Д5 payload JSON / Д6 read_at incl / Д7 business_date required.
- Границы: НЕ catch-up/детект (5.7b) / API (5.7c) / WS (E11) / Celery / резолюция получателя / admin-регистрация.
- 6 тестов: UniqueConstraint (дубль direct-create → IntegrityError), notify создаёт on_commit + payload, дефолтный payload {}, идемпотентность «одно на день» (2 вызова → 1 строка, первый payload), разные ключи → 3 строки, rollback → нет фантома (on_commit discarded).
- ⚠️ Открытые на ревью/будущее: Q2 резолюция получателя (маппинг «дивизион→ответственный» НЕ смоделирован) — зависимость 5.7b; app-изоляция (notifications→operations.TimeStampedModel) — abstract-база, реюз по spec-дефолту.

### File List

- `Backend/VAPS/apps/notifications/__init__.py` (CREATE)
- `Backend/VAPS/apps/notifications/apps.py` (CREATE — `NotificationsConfig`)
- `Backend/VAPS/apps/notifications/models.py` (CREATE — `Notification`)
- `Backend/VAPS/apps/notifications/services.py` (CREATE — `notify`)
- `Backend/VAPS/apps/notifications/migrations/__init__.py` (CREATE)
- `Backend/VAPS/apps/notifications/migrations/0001_initial.py` (CREATE)
- `Backend/VAPS/apps/notifications/tests/__init__.py` (CREATE)
- `Backend/VAPS/apps/notifications/tests/test_notify.py` (CREATE — 6 тестов)
- `Backend/VAPS/config/settings.py` (MODIFY — INSTALLED_APPS += apps.notifications)

## Change Log

- 2026-07-01 — code-review (bmad-code-review, Opus 4.8, 3 адверсариальных слоя). Auditor: PASS (7/7 AC). 2 decision → patch (Bratan): **D1 on_commit → вариант B** (`notify()` пишет синхронно под atomic вызывающего, возвращает `Notification`; no-phantom через откат инсерта) + **D2 non-fatal** (`try/except`+`logging.exception`, `return None` при сбое; blank recipient → `ValueError` громко). 3 patch применены: **P1** DB-`CheckConstraint chk_notification_kind` (+drift-тест, миграция перегенерирована — одна) · **P2** `recipient.strip()`+blank-guard (whitespace больше не пробивает «одно на день») · **P3** дискриминирующий тест `test_notify_visible_within_caller_transaction`. 3 defer → `deferred-work.md` (race-тест / `read_at`-индекс к 5.7c / `test_isolation`-скан на notifications). 8 dismissed. `make gate` зелёный: ruff чист, 1585 passed, `makemigrations --check` пуст, 29s. Status review → done.
- 2026-06-30 — dev-story (bmad-dev-story, Opus 4.8, TDD): реализованы модель `Notification` + `notify()`-сервис. Новый `apps/notifications` (AppConfig+label, +INSTALLED_APPS). Модель: recipient/kind(TextChoices)/business_date/payload(JSON)/read_at; UniqueConstraint(recipient,kind,business_date) «одно на день»; миграция 0001; flat ARCH-003. `notify()` — `transaction.on_commit` + `get_or_create` (идемпотентно, дубль/race graceful через savepoint get_or_create — урок 5.6b на уровне ORM, без raw IntegrityError/отравления txn). Дефолты Д1–Д7 (Q1=on_commit). Границы: catch-up/детект (5.7b)/API (5.7c)/WS (E11)/Celery/резолюция получателя/admin — вне. 6 тестов (`django_capture_on_commit_callbacks`). `make gate` зелёный (1579 passed +6, makemigrations пуст, ruff чист, 26s). Файлов 2 содержательных + app-скелет + миграция + settings + тесты. Status ready-for-dev → review.
- 2026-06-30 — Создана стори 5.7a (bmad-create-story, Opus 4.8): Notification модель + notify-сервис — ПЕРВАЯ из 3 частей сплита 5.7 (реш. Bratan; epics.md + sprint-status декомпозированы на 5.7a/5.7b/5.7c). Новый `apps/notifications`: модель `Notification` (recipient/kind/business_date/payload/read_at; flat ARCH-003; UniqueConstraint(recipient,kind,business_date) для «одно на день») + миграция 0001 + `notify()` (on_commit-эмиссия, дубль graceful — УРОК 5.6b). Без catch-up/детекта (5.7b)/API (5.7c)/WS (E11)/Celery/резолюции получателя/admin. Дефолты Д1–Д7, вопросы Q1 (on_commit-семантика) / Q2 (резолюция получателя → зависимость 5.7b) / Q3 (read_at) / Q4 (ключ идемпотентности). Файлов ~2 содержательных + app-скелет + миграция + settings + тесты. Status → ready-for-dev.

### Review Findings

_Code review 2026-07-01 (bmad-code-review, Opus 4.8) — 3 адверсариальных слоя (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Auditor: PASS, все 7 AC выполнены. 24 сырых находки → 2 decision / 3 patch / 3 defer / 8 dismissed._

- [x] [Review][Decision→Patch] Q1 on_commit-семантика — **РЕШЕНО (Bratan, 2026-07-01): вариант B (in-txn)**. Переключить `notify()` с `transaction.on_commit(_emit)` на синхронный вызов `_emit()` под atomic вызывающего: атомарно с причиной, запись видна сразу, `notify()` возвращает `Notification`. AC6 «no phantom при откате» сохраняется через откат инсерта (не discarded-callback) — существующий `test_notify_not_emitted_on_rollback` остаётся зелёным. Обновить `services.py` + переформулировать AC6-ноту в спеке (эмиссия привязана к txn вызывающего, не к commit-хуку). [Backend/VAPS/apps/notifications/services.py]
- [x] [Review][Decision→Patch] Робастность `_emit` — **РЕШЕНО (Bratan): non-fatal**. Обернуть `_emit`/`get_or_create` в `try/except` + `logging.exception` (сайд-канал FR-13 не должен ронять уже закоммиченную бизнес-операцию). NB: при варианте B параметр `robust=` неприменим (нет on_commit-хука) → реализация = `try/except` вокруг `get_or_create`; savepoint `get_or_create` уже гасит дубль-`IntegrityError` (урок 5.6b), `try/except` ловит прочие сбои (БД down, serialization). При провале — лог + `return None`. [Backend/VAPS/apps/notifications/services.py]
- [x] [Review][Patch] `kind` без DB-CheckConstraint — **ПРИМЕНЕНО**: добавлен `CheckConstraint(kind__in=["SUBMISSION_LAGGING"], name="chk_notification_kind")` (зеркало `chk_daily_submission_event`) + drift-тест `test_kind_check_covers_kind_choices` + `test_kind_check_rejects_unknown_kind`. Миграция `0001_initial` перегенерирована (одна миграция сохранена). [models.py + migration]
- [x] [Review][Patch] `recipient` не нормализуется — **ПРИМЕНЕНО**: `notify()` делает `recipient.strip()` + blank-guard `raise ValueError` (зеркало 5.6b `block_override`). Тесты: `test_notify_strips_recipient_so_whitespace_cannot_defeat_key`, `test_notify_rejects_blank_recipient[""/"   "/None]`. [services.py]
- [x] [Review][Patch] Тесты не различают семантику эмиссии — **ПРИМЕНЕНО (адаптировано под вариант B)**: `test_notify_visible_within_caller_transaction` — под `atomic()` строка видна ДО коммита и `notify()` возвращает запись (при варианте A оба ассерта упали бы: колбэк не выполнился бы в atomic, `notify` вернул бы None). `test_notify_not_emitted_on_rollback` сохранён (no-phantom через откат инсерта). Лишний `django_capture_on_commit_callbacks`-wrapper убран (эмиссия теперь синхронная). [test_notify.py]
- [x] [Review][Defer] Путь IntegrityError-absorption / реальная гонка не покрыт тестом + caveat re-raise под REPEATABLE READ (blind B3 + auditor F5 + edge E5) [test_notify.py] — deferred: нужен multi-connection харнесс; митигировано дефолтным Postgres READ COMMITTED; вернуться, когда 5.7b добавит реального вызывающего.
- [x] [Review][Defer] `read_at`/unread-запросы будут без индекса (blind B9) [models.py:111] — deferred: вне скоупа 5.7a; добавить индекс вместе с read-API 5.7c.
- [x] [Review][Defer] `test_isolation` не сканирует новый app `notifications` (auditor F6) [apps/notifications] — deferred: сегодня импорт notifications→operations.TimeStampedModel легален (ARCH-004 не нарушен); расширить скан гварда, когда 5.7b/5.7c добавят файлы, способные импортнуть `apps.core.models`.

_Dismissed (8, by-design/noise): payload «первый побеждает» — намеренно (Д3), покрыто, форвард-нота для 5.7b · `payload or {}` falsy-coerce — для dict-payload поведение не меняется · тривиально-истинные ассерты (`created_at is not None`) — перекрыто patch-тестом · `recipient` без FK — by-design ARCH-003 (актуальная часть → patch strip) · migration `dependencies=[]` — корректно (`TimeStampedModel` abstract=True, проверено) · имя миграции `0001_initial` vs `0001_notification` — косметика (File List спеки сам использует `0001_initial`) · Д1–Д7 применены без sign-off — информационно · autocommit immediate-write — by-design on_commit-семантика (нота уходит в Decision)._
