---
baseline_commit: 3799ac5 (HEAD на ветке e3-catchup-clock-concurrency; E1–E4 done; 5.1–5.6a done+committed; epic-5 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/5-6a-derive-блокировки.md
  - _bmad-output/implementation-artifacts/5-2-модель-dailysubmission.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

# Story 5.6b: Override-сущность + легальный обход блокировки «на завтра»

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПРОИСХОЖДЕНИЕ: вторая половина разбитой 5.6 «Блокировка на завтра» (2026-06-30, решение Bratan) —
     5.6a (derive-блокировка, read-only, DONE+committed) + 5.6b (override-сущность + легальный обход).
     5.6b ЗАВИСИТ от 5.6a: внедряет консультацию активного override в `tomorrow_block`.

     ГРАНИЦА СКОУПА: 5.6b — персистентная сущность легального обхода + её консультация в derive 5.6a.
     НЕ делает: аудит `TOMORROW_BLOCK_OVERRIDDEN` (5.9 — как 4.x-аудит отдельно); HTTP/API/422/permission-коды
     (5.8/6.10); нотификации (5.7); revocation/отмену override (вне MVP); RBAC-scope по actor (право
     создавать override — на API 5.8); UI.

     ЦЕНТРАЛЬНЫЙ ФАКТ (ground-truth): 5.6a `tomorrow_block(business_date) -> TomorrowBlock(blocked, laggards)`
     уже считает отстающих. 5.6b добавляет: модель `TomorrowBlockOverride` (flat-UUID/CharField-actor, как
     `DailySubmission`; ARCH-003 без FK на core) + миграцию + `TomorrowBlockOverrideSelector.active_for(date)`
     + сервис записи + ОДНУ правку `tomorrow_block`: активный override на дату → `blocked=False`
     (laggards сохраняются для видимости, `overridden=True`). Образцы: `DailySubmission`/`SubmissionControlSettings`
     (модель+миграция+constraints), `current_for`/`current_for_many` (селектор), `submit_day` (сервис-паттерн).

     ⚠️ ТРАПЫ: (1) НЕ добавлять FK на `core.Division` (ARCH-003 — flat UUID, как `division_id` в DailySubmission;
     ARCH-004 запрещает operations→core.models); (2) интеграция в `tomorrow_block` — ОДИН доп. запрос
     (`active_for`), сохранить NFR-4 (без запроса в цикле; consult раз на вызов); (3) `overridden=True` НЕ
     обнуляет laggards — обход ВИДИМ (и список отстающих, и факт обхода); (4) аудит-эмиссию НЕ впаивать
     (5.9 — отдельный потребитель seam'а 4.3); (5) error-коды/422 НЕ заводить (доменный результат +
     сервис; HTTP на 5.8, как 5.6a Д3). -->

## Story

As a **руководитель**,
I want **легально обойти блокировку «на завтра» с обязательной причиной — записать override-сущность за дату, после чего derive-блокировка (5.6a) для этой даты возвращает `blocked=False`, сохраняя список отстающих и факт обхода видимыми**,
so that **FR-18 выполняется (расход «на завтра» можно сформировать в обход), а каждый обход зафиксирован и видим (кто, когда, почему) — фундамент для аудита (5.9) и API (5.8)**.

## Acceptance Criteria

1. **Модель `TomorrowBlockOverride`.** **Given** нужна персистентная запись обхода, **Then** создана модель (база `TimeStampedModel`, как `DailySubmission`) с полями: `business_date` (DateField), `reason` (TextField, непустой), `overridden_by` (CharField max_length=100 — actor-строка, как `DailySubmission.submitted_by`); время обхода = `created_at` (из `TimeStampedModel`). Flat-ссылки (ARCH-003), БЕЗ FK на `core` (ARCH-004). [Source: epics.md нота 5.6b; DailySubmission-образец]
2. **DB-инвариант: причина непуста.** **Given** «легальный обход С ПРИЧИНОЙ», **Then** `reason` не может быть пустым на уровне БД — `CheckConstraint(~Q(reason=""))` (паттерн DB-инвариантов проекта; `reason` без `blank=True`/без дефолта). [Source: arch DB-integrity; реш. Q3]
3. **Один override на дату (дефолт).** **Given** дата уже обойдена, **Then** повторный override не создаёт дубль — `UniqueConstraint(business_date)` (один активный обход на дату); сервис идемпотентен/громко отвергает дубль. [Source: реш. Q2 — подтвердить]
4. **Миграция.** **Given** новая модель, **When** `makemigrations`, **Then** ровно одна новая миграция `0004_*` для `submissions` (таблица + constraints); `makemigrations --check` после — пуст. [Source: NFR-8; миграц-порядок 0001-0003]
5. **Селектор `active_for`.** **Given** дата, **Then** `TomorrowBlockOverrideSelector.active_for(business_date) -> bool` (есть ли активный override) ОДНИМ запросом (`exists()`); зеркало read-only-селекторов (`current_for`). [Source: selectors.py-паттерн]
6. **Сервис записи обхода.** **Given** дата + actor + причина, **When** `override_tomorrow_block(business_date, actor, reason)`, **Then** создаётся `TomorrowBlockOverride` (causes `blocked=False` на этой дате); пустая причина → отвергается (DB-constraint/доменный guard); возвращается запись. БЕЗ HTTP/422/permission-кодов (на API 5.8). [Source: epics.md 5.6 AC «override руководителем с причиной → Override-запись»]
7. **Консультация override в derive 5.6a.** **Given** дата с отстающими (`laggards != []`) И активным override, **When** `tomorrow_block(business_date)`, **Then** `blocked=False`, но `laggards` СОХРАНЯЮТСЯ и `overridden=True` (обход видим: и кто не сдал, и что обойдено); без override поведение 5.6a неизменно (`overridden=False`). ОДИН доп. запрос `active_for` (NFR-4 цел). [Source: epics.md нота 5.6b «активный override → blocked=False, обход видим записью»]
8. **Границы + гейт.** **Given** код в `submissions/`, **Then** НЕ аудит (5.9)/нотиф (5.7)/API-422/permission-коды (5.8)/revocation/RBAC/UI; `make gate` зелёный, `ruff` чист, `makemigrations --check` пуст (после новой миграции); регрессия 5.6a/5.5x нулевая. [Source: реш. границы]

## Tasks / Subtasks

- [x] **Task 1 — модель `TomorrowBlockOverride` + миграция (AC: 1,2,3,4)**
  - [x] `apps/operations/submissions/models/tomorrow_block_override.py`: `class TomorrowBlockOverride(TimeStampedModel)` — `business_date` (DateField), `reason` (TextField, БЕЗ blank/default), `overridden_by` (CharField max_length=100). `Meta`: `db_table="ops_tomorrow_block_overrides"`, `constraints=[CheckConstraint(condition=~Q(reason=""), name="ck_tomorrow_block_override_reason_not_empty"), UniqueConstraint(fields=["business_date"], name="uq_tomorrow_block_override_date")]`. Образец — `control_settings.py` (CheckConstraint) + `daily_submission.py` (flat-поля).
  - [x] Экспорт в `models/__init__.py` (+ в `__all__`).
  - [x] `python manage.py makemigrations submissions` → `0004_tomorrow_block_override.py`; проверить — одна миграция, `--check` пуст после.
- [x] **Task 2 — селектор `active_for` (AC: 5)**
  - [x] В `submissions/selectors.py` — `class TomorrowBlockOverrideSelector` с `@staticmethod active_for(business_date) -> bool`: `TomorrowBlockOverride.objects.filter(business_date=business_date).exists()`. ОДИН запрос. Read-only, без actor (как прочие селекторы; права на API).
- [x] **Task 3 — сервис `override_tomorrow_block` (AC: 6)**
  - [x] `apps/operations/submissions/services/block_override.py`: `override_tomorrow_block(business_date, actor, reason) -> TomorrowBlockOverride` — guard пустой `reason` (доменный `ValueError`, до DB; DB-constraint — последняя линия); `create(...)`. Идемпотентность/дубль по `business_date` — см. Q2 (дефолт: дубль → `ValueError`/get_or_create). БЕЗ error-кодов/HTTP.
  - [x] (если есть общий services-`__init__` экспорт — добавить, как для `submit_day`/`amend_day`.)
- [x] **Task 4 — консультация override в `tomorrow_block` (AC: 7)**
  - [x] `tomorrow_block.py`: `TomorrowBlock` += `overridden: bool = False` (additive, дефолт False — 5.6a-вызовы/тесты не ломаются). В `tomorrow_block`: после расчёта `laggards`, если `laggards and TomorrowBlockOverrideSelector.active_for(business_date)` → `return TomorrowBlock(blocked=False, laggards=laggards, overridden=True)`; иначе как 5.6a (`overridden=False`). ОДИН доп. запрос `active_for` (только когда есть laggards — short-circuit; NFR-4 цел).
- [x] **Task 5 — тесты (AC: 1–8)**
  - [x] `tests/test_tomorrow_block_override.py` (django_db): модель — пустой `reason` → IntegrityError (CheckConstraint); дубль `business_date` → IntegrityError (UniqueConstraint); сервис создаёт запись (reason/actor/created_at), пустой reason → отвергнут; `active_for` True/False ОДНИМ запросом; интеграция — override на дату с laggards → `blocked=False`+`overridden=True`+laggards сохранены; без override → 5.6a неизменно (`overridden=False`); NFR-4 — `active_for` не плодит запрос в цикле.
  - [x] Регрессия: `make gate` зелёный; `makemigrations --check` пуст (после 0004); ruff чист; `test_tomorrow_block.py` (5.6a) зелёный (additive `overridden` не ломает).

### Review Findings

Code-review проход 1 (bmad-code-review, 2026-06-30, Opus 4.8 ×3 слоя Blind/Edge/Auditor, **same-model caveat**; scoped-дифф 5.6b: модель+миграция+сервис+селектор+`tomorrow_block`-правка+тесты vs `3799ac5`). Acceptance Auditor: все 8 AC **SATISFIED**. Edge подтвердил SAFE: ARCH-004 (test_isolation 3/3), additive `overridden` (нет `==`-сравнений TomorrowBlock — снял BH-4), миграция clean, admin-нерегистрация, NFR-4. 1 decision · 0 patch · 1 defer · 7 dismiss.

- [x] [Review][Decision→Patch] (РЕШЕНО Bratan 2026-06-30 → опц.A полный харднинг; ПРИМЕНЕНО: дубль→чистый `ValueError`+`transaction.atomic` [нет отравления внешней txn]; service-guard `overridden_by` непустой + store `reason.strip()`/`actor.strip()`; DB-CheckConstraints усилены до non-blank через regex `~Q(__regex=r"^\s*$")` для reason И overridden_by; миграция 0004 перегенерирована; +8 тестов [whitespace-at-DB ×3, blank-actor-DB ×2, dup-via-service-no-poison, stripped-storage, blank-actor-service, no-active_for-query-short-circuit] + query-count pinned ==3) Override-хардннинг инвариантов — глубина фикса (3 подтверждённые дыры, blind+edge MED, в скоупе 5.6b по Q2/Q3/AC-2/accountability). **(1)** Дубль-override: `override_tomorrow_block` зовёт `.create()` без `atomic`/catch → второй override на дату = raw `IntegrityError`, который ВНУТРИ внешней `atomic` (API 5.8) отравляет транзакцию (асимметрия с чистым ValueError для пустого reason; Q2 говорил «дубль → ValueError/идемпотентно» — не выполнено). **(2)** `overridden_by` без guard непустоты (в отличие от reason) — `actor=""` молча пишет override без «кто» (accountability-дыра FR-18). **(3)** пробельный reason: service `.strip()` отвергает «   », но DB `~Q(reason="")` ловит только `""` → прямой `.create(reason="   ")` проходит; коммент «invariant lives on the DB» переоценивает. Развилка: **(A, РЕКОМЕНДУЮ)** полный харднинг — дубль→чистый ValueError+`transaction.atomic`; service-guard `overridden_by` непустой + store `reason.strip()`; УСИЛИТЬ DB-CheckConstraints (reason non-blank через regex + новый `overridden_by` non-empty, DB-integrity-преференс); амендж миграции 0004; +тесты (dup-via-service, whitespace-at-DB, actor-empty, short-circuit query-count). **(B)** лёгкий service-only — дубль→ValueError+atomic; service-guard actor + stripped reason; DB-constraints как есть + честный коммент; без амендж-миграции. **(C)** минимальный — только транзакц-безопасность дубля; actor-guard/whitespace → defer на API 5.8.
- [x] [Review][Defer] `business_date=None`/не-`date` в `override_tomorrow_block`/`active_for` — два расходящихся сина (active_for → silent False; service `.create` → raw NOT-NULL IntegrityError) [`tomorrow_block_override`/`block_override.py`/`selectors.py`, edge LOW] — deferred. Тот же класс, что defer 5.6a «business_date None-guard» (typed-kwarg контракт; вайр-валидация на REST 5.8). Закрыть на API 5.8 (date-сериализатор) ЛИБО общий service-input-hardening (isinstance date-guard).

## Dev Notes

### Цель (одним предложением)
Персистентный легальный обход блокировки «на завтра» (модель+миграция+сервис) + ОДНА правка `tomorrow_block` (5.6a): активный override → `blocked=False` с сохранением видимости (laggards + `overridden`).

### Авторитет спеки (что строим и откуда)
- epics.md Story 5.6 AC: «override руководителем с причиной → расход формируется + Override-запись»; **Декомпозиция-нота 5.6b**: модель + миграция + сервис + внедрение override-консультации в derive.
- FR-18: блокировка + override-сущность для легального обхода, обходы видимы.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы в конце)
- **Д1 — override DATE-level (НЕ per-division).** Дефолт: override снимает блок для ВСЕЙ даты (одна запись на `business_date`), не по конкретным отстающим. Обоснование: AC «расход на завтра формируется» — решение на уровне дня; проще модель (без `division_id`); блок 5.6a и так org-wide (любой laggard блокирует). Альтернатива (per-division) — модель с `division_id`, блок снимается только когда КАЖДЫЙ laggard либо сдал, либо обойдён. **СХЕМО-ВЛИЯЮЩЕЕ — см. Q1 (главный вопрос).**
- **Д2 — `overridden=True` НЕ обнуляет laggards.** Обход ВИДИМ: derive отдаёт `blocked=False`, но `laggards` остаётся (кто не сдал) + флаг `overridden`. «Обходы видимы» (FR-18).
- **Д3 — доменный результат/сервис, без error-кодов.** Сервис возвращает запись; пустой reason → доменный `ValueError` (+ DB-CheckConstraint как последняя линия). HTTP-422/permission-коды/`TOMORROW_BLOCK_OVERRIDDEN` — НЕ здесь (5.8 API / 5.9 аудит). Паритет 5.6a Д3.
- **Д4 — `TomorrowBlock` += `overridden: bool = False` (additive).** Дефолт False → 5.6a-вызовы и `test_tomorrow_block.py` не ломаются (frozen dataclass, новое поле с дефолтом в конце).

### Что УЖЕ есть — переиспользовать / НЕ дублировать
- `tomorrow_block(business_date) -> TomorrowBlock(blocked, laggards)` (`submissions/tomorrow_block.py`, 5.6a) — ОДНА точка интеграции (add override-consult + `overridden` field). НЕ переписывать derive-ядро.
- `TimeStampedModel` (`apps/operations/models.py`) — база (created_at/updated_at); integer pk (как `DailySubmission`).
- Образцы модели+constraints: `models/control_settings.py` (`CheckConstraint`), `models/daily_submission.py` (flat `division_id`/`business_date`, `submitted_by` CharField(100), partial `UniqueConstraint`).
- Селектор-паттерн: `DailySubmissionSelector.current_for`/`current_for_many` (read-only, `.exists()`/`.filter`).
- Сервис-паттерн: `services/day_submission_service.py::submit_day` / `amendment_service.py::amend_day` (typed-kwargs, без HTTP).
- Миграц-стиль: `migrations/0001_submission_control_settings.py` (RunPython-сид, constraints), след. номер — `0004`.

### Архитектурные правила, которые 5.6b ОБЯЗАНА соблюсти
- **ARCH-003**: cross-context ссылки — flat UUID/строка, без FK на `core` (override не ссылается на Division FK; если per-division Q1=B — `division_id = UUIDField()`, как `DailySubmission.division_id`).
- **ARCH-004**: `operations ↛ core.models` — модель/сервис/селектор НЕ импортируют `core.models` (`test_isolation`/AST-бан).
- **NFR-4**: интеграция в derive — ОДИН доп. запрос `active_for` на вызов (short-circuit: только при непустых laggards), без запроса в цикле.
- **Admin = только справочники** (arch-guard): `TomorrowBlockOverride` — БИЗНЕС-запись, НЕ регистрировать в admin (в отличие от `SubmissionControlSettings`-справочника).
- **Без actor/RBAC** на сервисе (право создавать override — на API 5.8; паритет всех operations-сервисов).

### Поток (псевдокод)
```python
# models/tomorrow_block_override.py
class TomorrowBlockOverride(TimeStampedModel):
    business_date = models.DateField()
    reason = models.TextField()                 # непустой (CheckConstraint)
    overridden_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_tomorrow_block_overrides"
        constraints = [
            models.CheckConstraint(condition=~models.Q(reason=""),
                                   name="ck_tomorrow_block_override_reason_not_empty"),
            models.UniqueConstraint(fields=["business_date"],
                                    name="uq_tomorrow_block_override_date"),
        ]

# selectors.py
class TomorrowBlockOverrideSelector:
    @staticmethod
    def active_for(business_date) -> bool:
        return TomorrowBlockOverride.objects.filter(business_date=business_date).exists()

# services/block_override.py
def override_tomorrow_block(business_date, actor, reason) -> TomorrowBlockOverride:
    if not reason or not reason.strip():
        raise ValueError("override requires a non-empty reason")
    return TomorrowBlockOverride.objects.create(
        business_date=business_date, overridden_by=actor, reason=reason)

# tomorrow_block.py (правка 5.6a)
@dataclass(frozen=True)
class TomorrowBlock:
    blocked: bool
    laggards: list
    overridden: bool = False     # NEW (additive)

def tomorrow_block(business_date):
    required = SubmissionControlSettingsSelector.required_division_ids()
    if not required:
        return TomorrowBlock(False, [])
    submitted = DailySubmissionSelector.current_for_many(required, business_date)
    laggards = sorted(set(required) - set(submitted), key=str)
    if laggards and TomorrowBlockOverrideSelector.active_for(business_date):
        return TomorrowBlock(blocked=False, laggards=laggards, overridden=True)
    return TomorrowBlock(blocked=bool(laggards), laggards=laggards)
```

### Подводные камни для dev-агента
- НЕ FK на `core.Division` (ARCH-003/004) — flat UUID/строка.
- `overridden=True` сохраняет laggards (видимость) — НЕ `laggards=[]`.
- `active_for` — short-circuit: звать ТОЛЬКО при непустых laggards (нет laggards → нет блока → override не нужен; экономит запрос).
- НЕ регистрировать override в admin (бизнес-модель, не справочник).
- НЕ впаивать аудит/нотиф/422 (5.9/5.7/5.8).
- `reason` без `blank=True`/без дефолта + CheckConstraint — DB не пустит пустую причину (паттерн проекта; `.create()` минует `full_clean`, поэтому DB-constraint, не только валидатор).
- `TomorrowBlock.overridden` — поле с дефолтом В КОНЦЕ (frozen dataclass) → 5.6a-тесты целы.

### Previous-story интеллидженс (5.6a DONE + code-review, 5.2/5.3b модели)
- 5.6a: `tomorrow_block` — read-only, реюз `current_for_many`/`required_division_ids`; деферы (протухший required-id, business_date None-guard) НЕ закрывать здесь (API 5.8). Q1-5.6a (required=required) — закреплён.
- 5.2 (DailySubmission): partial-UniqueConstraint immediate-режим (defer 5.2) — для override `UniqueConstraint(business_date)` простой (не partial), без той тонкости.
- DB-инварианты через CheckConstraint — устоявшийся паттерн (Bratan-преференс: целостность на DB-уровне).
- ARCH-004/AST-бан зелёные в submissions — повторить (модель/сервис/селектор без core.models).

### Технические версии / окружение
- Django ORM, `TimeStampedModel`, `CheckConstraint`/`UniqueConstraint`, `@dataclass`. Новых зависимостей НЕТ. РОВНО одна миграция (0004). `make gate` (Postgres :5433), `ruff check` (E,F) + `ruff format` по файлу.

### Project Structure Notes
- Файлы (≤5 содержательных + тривиальный экспорт + сгенер. миграция; тесты вне лимита): **CREATE** `models/tomorrow_block_override.py` · **MODIFY** `models/__init__.py` (экспорт) · **CREATE** `migrations/0004_tomorrow_block_override.py` (сгенер.) · **MODIFY** `selectors.py` (+`TomorrowBlockOverrideSelector`) · **CREATE** `services/block_override.py` · **MODIFY** `tomorrow_block.py` (+override-consult, +`overridden`) · **CREATE** `tests/test_tomorrow_block_override.py`.
- **НЕ трогать:** 5.6a derive-ядро (только additive override-consult + поле), `current_for_many`/`required_division_ids`/`SubmissionControlSettingsSelector`, `DailySubmission`/`submit_day`/`amend_day`/snapshot, traffic_light, RBAC/аудит/нотиф.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.6 + Декомпозиция-нота 5.6b] — override-сущность, легальный обход, видимость.
- [Source: _bmad-output/planning-artifacts/architecture.md (ARCH-003 flat UUID / ARCH-004 operations↛core.models / NFR-4 / NFR-8)].
- [Source: _bmad-output/implementation-artifacts/5-6a-derive-блокировки.md] — `tomorrow_block`/`TomorrowBlock` (точка интеграции); Д1 required=required; деферы → API 5.8.
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py] — `CheckConstraint`/singleton-образец, `TimeStampedModel`-база.
- [Source: Backend/VAPS/apps/operations/submissions/models/daily_submission.py] — flat `division_id`/`business_date`, `submitted_by` CharField(100), `UniqueConstraint`-стиль.
- [Source: Backend/VAPS/apps/operations/submissions/tomorrow_block.py] — derive 5.6a (additive-правка).
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py] — `current_for`/`current_for_many` (селектор-образец).
- [Source: Backend/VAPS/apps/operations/submissions/migrations/0001_submission_control_settings.py] — миграц-стиль + constraints.

### Открытые вопросы (для Bratan — подтвердить ПЕРЕД dev: Q1 схемо-влияющий!)
- **Q1 (ГЛАВНЫЙ, влияет на схему/миграцию) — override DATE-level vs per-DIVISION?** Дефолт Д1: **date-level** (одна запись на дату снимает блок целиком; модель БЕЗ `division_id`; проще). Альтернатива B: **per-division** (`division_id` в модели; блок снят, когда каждый laggard сдал ИЛИ обойдён; гранулярнее, но сложнее derive + `UniqueConstraint(business_date, division_id)`). Менять после миграции дорого → подтвердить ДО dev.
- **Q2 — один override на дату (UniqueConstraint) vs много записей (история)?** Дефолт: **один на дату** (UniqueConstraint; дубль → ValueError/идемпотентно). Альтернатива: разрешить много (история обходов; уникальности нет; derive по `.exists()`). Аудит истории — 5.9.
- **Q3 — enforce непустой reason на DB (CheckConstraint)?** Дефолт: **да** (CheckConstraint, паттерн проекта) + доменный guard в сервисе. Альтернатива: только сервис/API-валидация.
- **Q4 — `overridden_by` тип actor.** Дефолт: `CharField(max_length=100)` (как `DailySubmission.submitted_by`). Подтвердить, что actor — строка-идентификатор (не FK на User).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story, TDD.

### Debug Log References

- RED: `test_tomorrow_block_override.py` → ImportError (`TomorrowBlockOverrideSelector`/`block_override`/`overridden` ещё нет) — тесты валидны.
- App-label: `ops_submissions` (не `submissions`) — `makemigrations ops_submissions`.
- GREEN: 19/19 (10 override + 9 регрессия 5.6a с additive `overridden`).
- Миграция `0004_tomorrowblockoverride.py` — `ruff format` by-file (E501 на сгенер. строках, как 0001-0003).
- Gate: `make gate` зелёный (Postgres :5433): ruff чист, 1565 passed (+10), `makemigrations --check` «No changes detected», 26s.

### Completion Notes List

- Модель `TomorrowBlockOverride(TimeStampedModel)` — `business_date`/`reason`/`overridden_by`; integer-PK; `CheckConstraint(~Q(reason=""))` + `UniqueConstraint(business_date)`; миграция 0004. Date-level (Q1=A: БЕЗ `division_id`). flat ARCH-003, без FK на core.
- `TomorrowBlockOverrideSelector.active_for(date)` — `.exists()`, один запрос (selectors.py).
- Сервис `override_tomorrow_block(business_date, actor, reason)` (services/block_override.py + экспорт в services/__init__) — guard пустой/пробельный reason → `ValueError` (до DB; CheckConstraint — последняя линия).
- **Additive-правка `tomorrow_block` (5.6a):** `TomorrowBlock += overridden: bool = False` (дефолт → 5.6a-вызовы/тесты целы); `if laggards and active_for(date) → blocked=False, overridden=True` (laggards СОХРАНЯЮТСЯ — обход видим). `active_for` зовётся short-circuit (только при laggards) → +1 запрос, NFR-4 цел.
- **Дефолты применены:** Q1=date-level, Q2=один override/дату (UniqueConstraint), Q3=CheckConstraint reason≠"" (DB-integrity), Q4=overridden_by CharField(100). Границы: НЕ аудит (5.9)/API-422 (5.8)/нотиф (5.7)/admin-регистрация/RBAC/revocation.
- **ARCH-004:** модель/сервис/селектор/derive не импортируют core.models; `test_isolation` 3/3. **NFR-4:** query-count инвариантен числу required (тест с override 1 vs 6).
- 10 тестов: reason-непуст (IntegrityError), один-на-дату (IntegrityError), `active_for` True/False+date-scoped, сервис создаёт/отвергает-пустой-reason, override снимает блок + laggards видимы + overridden=True, без override 5.6a неизменно, override-без-laggards не флипает overridden, query-count инвариант.

### File List

- `Backend/VAPS/apps/operations/submissions/models/tomorrow_block_override.py` (CREATE — модель `TomorrowBlockOverride`)
- `Backend/VAPS/apps/operations/submissions/models/__init__.py` (MODIFY — экспорт)
- `Backend/VAPS/apps/operations/submissions/migrations/0004_tomorrowblockoverride.py` (CREATE — миграция)
- `Backend/VAPS/apps/operations/submissions/selectors.py` (MODIFY — `TomorrowBlockOverrideSelector.active_for`)
- `Backend/VAPS/apps/operations/submissions/services/block_override.py` (CREATE — `override_tomorrow_block`)
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` (MODIFY — экспорт)
- `Backend/VAPS/apps/operations/submissions/tomorrow_block.py` (MODIFY — `overridden` + override-consult)
- `Backend/VAPS/apps/operations/submissions/tests/test_tomorrow_block_override.py` (CREATE — 10 тестов)

## Change Log

- 2026-06-30 — code-review (bmad-code-review, Opus 4.8 ×3 слоя Blind/Edge/Auditor, **same-model caveat**; scoped-дифф 5.6b vs `3799ac5`). Acceptance Auditor: все 8 AC SATISFIED. Edge снял BH-4 (additive `overridden` SAFE). 1 decision · 1 defer · 7 dismiss. Decision (override-харднинг глубины) → Bratan опц.A ПРИМЕНЕНА: (1) дубль-override → чистый `ValueError` + `transaction.atomic` (нет отравления внешней txn; было raw `IntegrityError`); (2) service-guard `overridden_by` непустой + store `reason.strip()`/`actor.strip()`; (3) DB-CheckConstraints усилены до non-blank (regex `~Q(__regex=r"^\s*$")`) для `reason` И `overridden_by`; миграция 0004 перегенерирована (2 CheckConstraint + 1 UniqueConstraint); +8 харднинг-тестов + query-count pinned ==3. Defer: `business_date=None` (тот же класс 5.6a; API 5.8) → deferred-work.md. `make gate` зелёный (Postgres :5433: 1573 passed +8, 24 deselected, makemigrations пуст, ruff чист, 26s). Артефакты НЕ закоммичены. Status review → done.
- 2026-06-30 — dev-story (bmad-dev-story, Opus 4.8, TDD): реализована override-сущность + легальный обход. Модель `TomorrowBlockOverride` (CheckConstraint reason≠"" + UniqueConstraint business_date; миграция 0004; date-level Q1=A, flat ARCH-003) + `TomorrowBlockOverrideSelector.active_for` + сервис `override_tomorrow_block` (guard пустой reason) + additive-правка `tomorrow_block` (`overridden:bool=False`; активный override → blocked=False, overridden=True, laggards сохранены; short-circuit active_for, NFR-4 цел). Дефолты Q1–Q4. Границы: аудит (5.9)/API (5.8)/нотиф (5.7)/admin/RBAC/revocation — вне. ARCH-004 цел (test_isolation 3/3). 10 тестов, `make gate` зелёный (1565 passed +10, makemigrations пуст, ruff чист, 26s). Файлов 4 содержательных + 2 экспорта + миграция + тесты. Status ready-for-dev → review.
- 2026-06-30 — Создана стори 5.6b (bmad-create-story, Opus 4.8): override-сущность + легальный обход — ВТОРАЯ половина сплита 5.6 (5.6a derive DONE+committed). Модель `TomorrowBlockOverride` (TimeStampedModel; `business_date`/`reason`-непустой/`overridden_by`; flat ARCH-003; CheckConstraint reason≠"" + UniqueConstraint business_date) + миграция 0004 + `TomorrowBlockOverrideSelector.active_for` + сервис `override_tomorrow_block` + ОДНА additive-правка `tomorrow_block` (5.6a): активный override → `blocked=False`, `overridden=True`, laggards сохранены (видимость). Границы: аудит (5.9)/API-422 (5.8)/нотиф (5.7)/revocation/RBAC/UI — вне. Дефолты Д1–Д4, вопросы Q1 (date vs per-division — СХЕМО-ВЛИЯЮЩИЙ, подтвердить ДО dev) / Q2 / Q3 / Q4. Файлов ~4 содержательных + экспорт + миграция + тесты. Status → ready-for-dev.
