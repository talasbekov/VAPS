---
baseline_commit: 6104efb (HEAD на ветке e3-catchup-clock-concurrency; E1–E4 done; 5.1–5.5b done; 5.5a/5.5b в рабочем дереве [не закоммичено]; epic-5 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/5-5b-каскад-по-дереву.md
  - _bmad-output/implementation-artifacts/5-3b-сервис-сдачи-дня.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

# Story 5.6a: Derive-блокировка «на завтра»

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПРОИСХОЖДЕНИЕ: первая половина разбитой 5.6 «Блокировка на завтра» (2026-06-30, решение Bratan) —
     5.6a (derive-блокировка, read-only) + 5.6b (override-сущность + легальный обход). 5.6b ЗАВИСИТ от 5.6a
     (внедряет консультацию активного override в derive). Зеркалит сплит 5.3a/b, 5.4a/b, 5.5a/b.

     ГРАНИЦА СКОУПА: 5.6a — READ-ONLY вычислительное ядро FR-18: «можно ли формировать расход на завтра?».
     НЕ делает: модель/миграцию (это override 5.6b); HTTP-422/`TOMORROW_BLOCKED`/API (5.8/6.10 —
     сервис возвращает ДОМЕННЫЙ результат, не Response); override-консультацию (5.6b); нотификации
     об отставании (5.7); аудит `TOMORROW_BLOCK_OVERRIDDEN` (5.9); документ-«на завтра» (6.10);
     RBAC-scope по actor (как `StrengthReportService` — права на API-слое).

     ЦЕНТРАЛЬНЫЙ ФАКТ (ground-truth): «необходимые управления» и «контрольный час» УЖЕ существуют —
     `SubmissionControlSettings.required_division_ids` (ArrayField UUID → core_divisions, flat ARCH-003,
     дефолт []) + `control_hour`, сид миграцией 0001, читается `SubmissionControlSettingsSelector`. Блок
     «на завтра» = required-управление без действующей (is_current=True) сдачи на дату. РЕЮЗ 5.5b
     `DailySubmissionSelector.current_for_many(division_ids, business_date)` → {division_id: DailySubmission}
     ОДНИМ запросом (division_id__in): present = сдало, absent = отстаёт. Новых селекторов НЕ нужно.

     ⚠️ ТРАПЫ: (1) НЕ звать `current_for` в цикле по required (N+1) — ОДИН `current_for_many`; (2) НЕ
     импортировать `apps.core.models`/`Division` (ARCH-004) — required-список приходит как flat UUID из
     конфиг-селектора, имена/структура (если нужны) — через `CoreDivisionTreeSelector`; (3) `control_hour`
     НЕ влияет на blocked в 5.6a — он уже отработал на `late` при сдаче (5.3b); блок «на завтра» = факт
     наличия сдачи, не время; (4) пустой конфиг (`required_division_ids=[]`) → НЕ блок (нечего требовать),
     не путать с «всё заблокировано»; (5) ключи `current_for_many` — UUID (`row.division_id`), required —
     UUID из ArrayField → сравнение типобезопасно. -->

## Story

As a **система**,
I want **derive-проверку «можно ли формировать расход на завтра»: из конфига «необходимые управления» и действующих сдач на `business_date` вычислить, какие required-управления НЕ сдали, ОДНИМ bulk-запросом**,
so that **FR-18-блокировка получает read-only вычислительное ядро (`blocked` + список отстающих), на котором API-слой (5.8/6.10) поднимет 422 TOMORROW_BLOCKED, а 5.6b добавит легальный обход через override — без N+1 (NFR-4)**.

## Acceptance Criteria

1. **Derive одним bulk-запросом (NFR-4).** **Given** `business_date`, **When** вызываю `tomorrow_block(business_date)`, **Then** возвращается доменный результат с `blocked: bool` и `laggards: list[division_id]` (отстающие required-управления), вычисленный ОДНИМ `DailySubmissionSelector.current_for_many(required_division_ids, business_date)` (реюз 5.5b); НИ ОДНОГО запроса в цикле по управлениям. [Source: epics.md Декомпозиция-нота 5.6a; architecture.md NFR-4 §61/§326/§451; `current_for_many` 5.5b]
2. **Источник «необходимых управлений» — конфиг-селектор, без импорта core.** **Given** конфиг, **Then** список required берётся из `SubmissionControlSettingsSelector.required_division_ids()` (flat UUID → core_divisions, ARCH-003); модуль НЕ импортирует `apps.core.models`/`Division` (ARCH-004). [Source: control_settings.py; architecture.md ARCH-003/ARCH-004]
3. **Laggard = required без действующей сдачи.** **Given** required-управление без current (`is_current=True`) `DailySubmission` на `business_date` (отсутствует в map `current_for_many`), **Then** оно в `laggards` и `blocked=True`; **Given** ВСЕ required имеют действующую сдачу, **Then** `blocked=False`, `laggards=[]`. [Source: epics.md 5.6 AC «одно необходимое управление не сдало → blocked»]
4. **Пустой конфиг — не блок.** **Given** `required_division_ids=[]` (дефолт-сид миграции 0001), **Then** `blocked=False`, `laggards=[]` (нечего требовать → расход не блокируется; НЕ «всё заблокировано»). [Source: control_settings.py дефолт []]
5. **Детерминированный порядок laggards.** **Given** несколько отстающих, **Then** `laggards` отсортирован детерминированно (стабильный вывод для API/тестов; зеркало детерминизма `_diff_winners` 5.5a). [Source: 5-5a/5-5b детерминизм]
6. **Границы: без override / HTTP / побочек.** **Given** 5.6a, **Then** НЕ создаёт модель/миграцию; НЕ поднимает 422/`TOMORROW_BLOCKED` (доменный результат — HTTP на 5.8/6.10); НЕ консультирует override (5.6b); НЕ шлёт нотификации (5.7)/аудит (5.9); без actor/RBAC (как `StrengthReportService`). [Source: реш. границы; epics.md Декомпозиция-нота]
7. **Гейт + анти-gold-plating.** **Given** код в `submissions/`, **Then** `make gate` зелёный, `ruff` чист, `makemigrations --check` пуст (миграций НЕТ — read-only). [Source: NFR-8; прецедент 5.5a/5.5b]

## Tasks / Subtasks

- [x] **Task 1 — доменный результат + derive `tomorrow_block` (AC: 1,2,3,4,5,6)**
  - [x] В НОВОМ модуле `apps/operations/submissions/tomorrow_block.py` (app-root, зеркало `traffic_light.py` — read-only derive, НЕ под `services/`): `@dataclass(frozen=True) TomorrowBlock(blocked: bool, laggards: list)` (или `tuple` — JSON-сериализуемый детерминированный порядок).
  - [x] `tomorrow_block(business_date) -> TomorrowBlock`: `required = SubmissionControlSettingsSelector.required_division_ids()`; ранний выход на `[]` → `TomorrowBlock(False, [])` (AC-4; можно и общий путь — пустой `__in` даёт пустой map → пустые laggards → False; выбрать читаемо); `submitted = DailySubmissionSelector.current_for_many(required, business_date)` (ОДИН запрос); `laggards = sorted(set(required) - set(submitted), key=str)`; `TomorrowBlock(blocked=bool(laggards), laggards=laggards)`.
  - [x] Импорты ТОЛЬКО из `apps.operations.submissions.selectors` (`DailySubmissionSelector`, `SubmissionControlSettingsSelector`) — НЕ `apps.core.models` (ARCH-004). `business_date` — типизированный `date`-kwarg (вайр-коэрсинг на REST 5.8, паритет `submit_day`/`amend_day`).
- [x] **Task 2 — тесты (AC: 1,3,4,5,7)**
  - [x] `apps/operations/submissions/tests/test_tomorrow_block.py` (`pytest.mark.django_db`, helpers по образцу `test_traffic_light_tree.py`: `make_division`/`make_employee`/`_submit`; настройка `required_division_ids` через `SubmissionControlSettings` get_or_create/update):
    - blocked=True + laggards при одном не-сдавшем required (AC-3);
    - blocked=False/[] когда все required сдали (AC-3);
    - blocked=False/[] на пустом конфиге (AC-4);
    - детерминированный порядок laggards (несколько отстающих, стабильный sort) (AC-5);
    - NFR-4: `CaptureQueriesContext` — число запросов инвариантно числу required (1 vs N управлений → одинаково; ≤ небольшой константы) (AC-1);
    - не-required управление БЕЗ сдачи НЕ попадает в laggards (учитываются только required) (AC-2/3).
  - [x] Регрессия: `make gate` зелёный; `makemigrations --check` «No changes detected» (миграций НЕТ); ruff чист; `test_traffic_light_tree.py`/`test_control_settings.py` зелёные.

### Review Findings

Code-review проход 1 (bmad-code-review, 2026-06-30, Opus 4.8 ×3 слоя Blind/Edge/Auditor, **same-model caveat**; scoped-дифф 5.6a: `tomorrow_block.py` + `test_tomorrow_block.py` vs `6104efb`). Acceptance Auditor: все 7 AC **SATISFIED**. Edge подтвердил SAFE: key-type UUID обе стороны (снял обе HIGH Blind), query-count (singleton сидится 0001 → 2 запроса инвариантно N), empty/duplicate/control_hour/submit_day-empty-roster. 1 decision · 0 patch · 2 defer · 11 dismiss.

- [x] [Review][Patch] (РЕШЕНО Bratan 2026-06-30 → опц.A: оставить Д1; ПРИМЕНЕНО — epics-нота поправлена [убран roster_on-clause, зафиксировано required=required], +2 теста: пустое required без сдачи → laggard, пустое required со сдачей → не laggard) Q1 — пустое required-управление = laggard (Д1/код) vs освобождать (epics-нота «+roster_on») [Auditor F1+F2]. Внутренняя нестыковка: epics-Декомпозиция-нота 5.6a говорит «реюз current_for_many + roster_on для непустой own-ростер» (освобождать пустые, как светофор-NEUTRAL), а реализация Д1 НЕ читает ростер → пустое required без сдачи = laggard. Код консистентен со story-AC-3 + Д1 (green), но противоречит МОЕЙ epics-ноте; Q1 помечен «подтвердить у Bratan». Меняет blocked-семантику пустых управлений + экономит 1 `roster_on`-запрос. Развилка: **(A, РЕКОМЕНДУЮ)** оставить Д1 (required=required; пустое управление сдаёт пустой день 5.3a; проще, 1 запросом) + поправить epics-ноту (убрать roster_on-clause) + добавить тест «пустое required без сдачи → laggard»; **(B)** освобождать пустые (симметрия со светофор-NEUTRAL) → +`roster_on` (+1 запрос) + код-правка + тест.
- [x] [Review][Defer] Протухший/удалённый/деактивированный required-id → перманентный org-wide ложный блок (нет реконсиляции) [`tomorrow_block.py:58-63`, edge MED] — deferred. `required_division_ids` — flat ArrayField без FK (ARCH-003) → удаление дивизиона не чистит конфиг; `submit_day` 404-ит на удалённом id → он НИКОГДА не сдаст → вечный laggard → весь org заблокирован без self-heal. Гигиена конфига — забота admin-настроек (2.3/2.8) / API (5.8); НЕ дело read-only derive (пересечение required с live-Division потребовало бы чтения core — ARCH-004-напряжение). Класс — те же flat-UUID-ref деферы (5.3a существование, 5.4a triggered_by). Закрыть: валидация/чистка `required_division_ids` против live Division при админ-управлении, ЛИБО фильтр laggards по существованию на API 5.8.
- [x] [Review][Defer] `business_date=None`/не-`date` → тихий `blocked=True` вместо громкой ошибки [`tomorrow_block.py:50-63`, edge LOW] — deferred. Нет type/None-гарда; `None` → `current_for_many(None)` → пустой map → все required = laggards → silent `blocked=True`. Сосед `catchup_plan` (`clock.py:82-87`) гардит `type is not date`. By-design typed-kwarg контракт (вайр-коэрсинг/валидация — REST 5.8; паритет `submit_day`/`amend_day`; класс — defer 5.4a «business_date=None→500»). ⚠️Нюанс: здесь тихо-неверно (не 500) — опаснее; при service-input-хардённинге рассмотреть громкий гард. Закрыть на API 5.8 (сериализатор-date) ЛИБО service-input-hardening.

## Dev Notes

### Цель (одним предложением)
Read-only ядро FR-18: по `business_date` вернуть `{blocked, laggards}` из «необходимых управлений» и их сдач, ОДНИМ bulk-запросом, без override/HTTP/побочек — фундамент для API-422 (5.8/6.10) и override (5.6b).

### Авторитет спеки (что строим и откуда)
- epics.md Story 5.6 + **Декомпозиция-нота 5.6a** (2026-06-30): «вычислить блок из сдач» — read-only половина, override отдельно.
- FR-18: блокировка формирования расхода «на завтра», derived из сдач необходимых управлений.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы в конце)
- **Д1 — laggard = required без current-сдачи (НЕ учитываем ростер).** Дефолт: required-управление отстаёт, если у него нет действующей сдачи на дату, ВНЕ зависимости от того, пустой ли у него ростер. Обоснование: конфиг ЯВНО пометил управление required → ожидается сдача (пустую сдачу `submit_day` строит и для пустого ростера, 5.3a `{roster:[],rows:[]}`). Это ОТЛИЧАЕТСЯ от светофор-NEUTRAL (где пустой ростер = нечего сдавать). Альтернатива (если Bratan захочет): освобождать пустые управления → добавить `roster_on(business_date, required)` и исключать дивизионы с пустым own-ростером (тогда +1 запрос). См. Вопрос Q1. **Дефолт экономит запрос (только `current_for_many`).**
- **Д2 — `control_hour` НЕ влияет на `blocked`.** Контрольный час уже отработал на `late` при сдаче (5.3b). Блок «на завтра» — про ФАКТ наличия сдачи, не про время. 5.6a не читает `control_hour`.
- **Д3 — доменный результат, не исключение.** `tomorrow_block` ВОЗВРАЩАЕТ `TomorrowBlock(blocked, laggards)`; 422/`TOMORROW_BLOCKED` поднимает API (5.8/6.10). Зеркало `division_traffic_light`/`traffic_light_tree` (возвращают value-объект). Код ошибки `TOMORROW_BLOCKED` — НЕ заводить в 5.6a (нет error-кодов — read-only), завести на API-стори.
- **Д4 — размещение `tomorrow_block.py` в app-root** (как `traffic_light.py`), НЕ `services/` (там мутаторы: submit/amend/snapshot). Read-only derive → app-root.

### Что УЖЕ есть — переиспользовать / НЕ дублировать
- `SubmissionControlSettingsSelector.required_division_ids() -> list[UUID]` (`submissions/selectors.py:122-124`) — flat UUID; `.control_hour()` рядом (не нужен здесь).
- `DailySubmissionSelector.current_for_many(division_ids, business_date) -> {division_id: DailySubmission}` (`submissions/selectors.py:23`, 5.5b) — ОДИН запрос `division_id__in`+`is_current=True`; absent = нет сдачи. **Точно тот bulk-примитив, что нужен.** НЕ звать `current_for` в цикле.
- `SubmissionControlSettings.required_division_ids` (`models/control_settings.py:31`) — ArrayField UUID, дефолт [], сид 0001; singleton.
- Тест-помощники и `CaptureQueriesContext`-паттерн — образец `tests/test_traffic_light_tree.py` (5.5b).

### Архитектурные правила, которые 5.6a ОБЯЗАНА соблюсти
- **ARCH-004** (`operations ↛ core.models`): НЕ импортировать `Division`/`core.models`; required приходит flat UUID из конфиг-селектора. Проверяется `test_isolation`/AST-баном.
- **NFR-4** (анти-N+1): ОДИН `current_for_many`, ноль запросов в цикле. Тест — `assert_num_queries` инвариантен числу required.
- **ARCH-003**: cross-context ссылки — flat UUID, без FK (required_division_ids уже flat).
- **Без actor/RBAC** на сервисе (паритет `StrengthReportService`/`traffic_light_tree`/`current_for_many`) — сужение прав на API (5.8).

### Поток (псевдокод)
```python
# apps/operations/submissions/tomorrow_block.py
from dataclasses import dataclass
from datetime import date

from apps.operations.submissions.selectors import (
    DailySubmissionSelector,
    SubmissionControlSettingsSelector,
)


@dataclass(frozen=True)
class TomorrowBlock:
    blocked: bool
    laggards: list  # division_id (UUID); детерминированный порядок


def tomorrow_block(business_date: date) -> TomorrowBlock:
    required = SubmissionControlSettingsSelector.required_division_ids()
    if not required:                       # AC-4 — нечего требовать
        return TomorrowBlock(blocked=False, laggards=[])
    submitted = DailySubmissionSelector.current_for_many(required, business_date)
    laggards = sorted(set(required) - set(submitted), key=str)   # AC-3/AC-5
    return TomorrowBlock(blocked=bool(laggards), laggards=laggards)
```
≈2 запроса (settings-get + current_for_many), инвариантно числу управлений.

### Подводные камни для dev-агента
- НЕ `current_for` в цикле (N+1) — только `current_for_many`.
- НЕ импортировать `Division`/`core.models` (ARCH-004) — даже для имён отстающих (имена — забота API/UI через `CoreDivisionTreeSelector`, не 5.6a).
- Пустой `required` → `False/[]` (AC-4), не «всё заблокировано».
- `control_hour` не трогать (Д2).
- Ключи `current_for_many` — UUID; `required` — UUID из ArrayField; `set(required) - set(submitted)` типобезопасно (оба UUID). Если где-то прилетит str — нормализовать к одному типу (как 5.5a str-ключи employee), но для division-ключей источник один (UUID) → нормализация не нужна; зафиксировать тест на типе ключа.

### Previous-story интеллидженс (5.5b, DONE + code-review)
- `current_for_many` — РОВНО мой bulk-примитив; добавлен и проверен в 5.5b (partial-UNIQUE `(division_id,business_date) WHERE is_current` → коллизий ключа нет; absent = нет сдачи).
- Паттерн value-объект + детерминированный sort + `CaptureQueriesContext`-тест на инвариантность запросов — отработан в 5.5b code-review (NFR-4 тест `assert n1==n5`).
- ARCH-004/AST-бан — зелёные в submissions (`traffic_light.py` импортит только селекторы; повторить здесь).

### Технические версии / окружение
- Django ORM, `@dataclass(frozen=True)`. Новых зависимостей НЕТ. Миграций НЕТ. `make gate` (Postgres :5433), `ruff check` (E,F) + `ruff format` по файлу (by-file scoping).

### Project Structure Notes
- Файлы (≤5; тесты вне лимита): **CREATE** `apps/operations/submissions/tomorrow_block.py` (`TomorrowBlock` + `tomorrow_block`) · **CREATE** `apps/operations/submissions/tests/test_tomorrow_block.py`. = 1 нон-тест + тесты. Селекторы/модели НЕ модифицируются (`current_for_many`/`required_division_ids` уже есть).
- **НЕ трогать:** `current_for_many`/`SubmissionControlSettingsSelector` (реюз), `traffic_light.py`/`division_traffic_light`/`traffic_light_tree` (соседний derive, не зависит), `submit_day`/`amend_day`/snapshot, `control_settings` модель/миграцию, RBAC/аудит/нотификации.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.6 + Декомпозиция-нота 5.6a] — derive-блокировка, blocked+laggards, границы.
- [Source: _bmad-output/planning-artifacts/epics.md:44,734 (FR-13/FR-18)] — Необходимые управления + контрольный час; блокировка «на завтра».
- [Source: _bmad-output/planning-artifacts/architecture.md:61,326,451 (NFR-4/bulk)] — запрет per-item в циклах.
- [Source: _bmad-output/planning-artifacts/architecture.md (ARCH-003 flat UUID / ARCH-004 operations↛core.models)].
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py:9-45] — `SubmissionControlSettings.required_division_ids`/`control_hour`; docstring называет «next-day lock (5.6)» потребителем.
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:103-124] — `SubmissionControlSettingsSelector.required_division_ids()`/`.control_hour()`.
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:23-44] — `DailySubmissionSelector.current_for_many` (bulk, 5.5b — реюз).
- [Source: Backend/VAPS/apps/operations/submissions/traffic_light.py] — образец read-only derive в app-root + value-объект + детерминизм.
- [Source: _bmad-output/implementation-artifacts/5-5b-каскад-по-дереву.md] — `current_for_many`, NFR-4 тест-паттерн, ARCH-004.
- [Source: _bmad-output/implementation-artifacts/5-3b-сервис-сдачи-дня.md] — `submit_day`/current-семантика/`control_hour`→`late`.

### Открытые вопросы (для Bratan — подтвердить при dev или сейчас)
- **Q1 — пустой required-дивизион: laggard или освобождён?** Дефолт Д1: **laggard** (required = required, ростер не смотрим; экономит запрос). Альтернатива: освобождать пустые (как светофор-NEUTRAL) → +`roster_on`, +1 запрос. Влияет на AC-3 и число запросов.
- **Q2 — тип `laggards`: `list[UUID]` или `list[str]`?** Дефолт: `UUID` (внутренний доменный результат; стрингование — на API-сериализаторе 5.8). Если удобнее сразу `str` для будущего JSON — сказать.
- **Q3 — место error-кода `TOMORROW_BLOCKED`.** Дефолт Д3: завести на API-стори (5.8/6.10), 5.6a — без error-кодов (read-only). Подтвердить, что 5.6a не трогает реестр кодов.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story, TDD.

### Debug Log References

- RED: `test_tomorrow_block.py` → `ModuleNotFoundError: tomorrow_block` (модуль ещё не создан) — тесты валидны.
- GREEN: после `tomorrow_block.py` — 7/7 passed (1.5s).
- Gate: `make gate` зелёный (Postgres :5433): ruff check чист, 1553 passed (+7), `makemigrations --check` «No changes detected», 27s.

### Completion Notes List

- Реализован read-only derive `tomorrow_block(business_date) -> TomorrowBlock(blocked, laggards)` в app-root `submissions/tomorrow_block.py` (Д4) — зеркало `traffic_light.py`, НЕ под `services/`.
- Логика: `SubmissionControlSettingsSelector.required_division_ids()` − ключи `DailySubmissionSelector.current_for_many(required, date)` (РЕЮЗ 5.5b) → `laggards = sorted(set(required) - set(submitted), key=str)`; пустой конфиг → ранний выход `(False, [])`. ОДИН bulk-запрос сдач (NFR-4).
- **Дефолты применены:** Д1 (laggard = required без current-сдачи, ростер НЕ читается — `roster_on` не нужен, экономит запрос), Д2 (`control_hour` не читается), Д3 (доменный результат `TomorrowBlock`, без 422/error-кода — на API 5.8/6.10), Q2 (laggards = UUID). Без модели/миграции/override/нотиф/аудита/RBAC.
- **ARCH-004:** модуль импортит ТОЛЬКО `apps.operations.submissions.selectors` (нет `core.models`/`Division`); `test_isolation` 3/3 зелёный, AST-бан зелёный.
- **NFR-4:** `test_query_count_invariant_to_number_of_required` — 1 vs 5 required → одинаковое число запросов (2: settings-get + current_for_many), `≤3`.
- Новых селекторов/моделей/миграций/error-кодов НЕТ. ruff format по 2 файлам (by-file). Артефакты НЕ закоммичены.
- 7 тестов: blocked+laggards (AC-3), all-submitted→False (AC-3), пустой конфиг→False (AC-4), детерминированный порядок (AC-5), не-required игнорируется (AC-2/3), query-count инвариант (AC-1/NFR-4), тип результата + laggards UUID.

### File List

- `Backend/VAPS/apps/operations/submissions/tomorrow_block.py` (CREATE — `TomorrowBlock` + `tomorrow_block`)
- `Backend/VAPS/apps/operations/submissions/tests/test_tomorrow_block.py` (CREATE — 7 тестов)

## Change Log

- 2026-06-30 — code-review (bmad-code-review, Opus 4.8 ×3 слоя Blind/Edge/Auditor, **same-model caveat**; scoped-дифф 5.6a vs `6104efb`). Acceptance Auditor: все 7 AC SATISFIED. Edge снял обе HIGH Blind (key-type UUID обе стороны SAFE; контракт current_for_many SAFE). 1 decision · 1 patch · 2 defer · 11 dismiss. Decision Q1 (пустое required → laggard vs освобождать; нестыковка epics-ноты vs Д1) → Bratan опц.A: оставить Д1 (required=required). Patch ПРИМЕНЁН: epics-нота поправлена (убран roster_on-clause) + 2 теста (пустое required без сдачи → laggard; со сдачей → не laggard). Defer: протухший required-id → вечный блок (гигиена конфига на admin/API 5.8); business_date=None → тихий блок (typed-kwarg, валидация на API 5.8) → deferred-work.md. `make gate` зелёный (Postgres :5433: 1555 passed +2, 24 deselected, makemigrations пуст, ruff чист, 26s). Артефакты НЕ закоммичены. Status review → done.
- 2026-06-30 — dev-story (bmad-dev-story, Opus 4.8, TDD): реализована derive-блокировка «на завтра». `tomorrow_block(business_date) -> TomorrowBlock(blocked, laggards)` — `required_division_ids` (конфиг) − `current_for_many` (реюз 5.5b) → отстающие, ОДНИМ bulk-запросом (NFR-4); пустой конфиг → не-блок. Дефолты Д1–Д4/Q2 применены (ростер не читается, control_hour не читается, доменный результат, app-root, laggards UUID). Без модели/миграции/override/HTTP/аудита/нотиф/RBAC/error-кодов. ARCH-004 цел (импорт только селекторов; test_isolation 3/3). 7 тестов, `make gate` зелёный (1553 passed +7, makemigrations пуст, ruff чист, 27s). Файлов 1 нон-тест + тесты. Status ready-for-dev → review.
- 2026-06-30 — Создана стори 5.6a (bmad-create-story, Opus 4.8): derive-блокировка «на завтра» — ПЕРВАЯ половина сплита 5.6 (2026-06-30, реш. Bratan; epics.md + sprint-status декомпозированы). `tomorrow_block(business_date) -> TomorrowBlock(blocked, laggards)`: `required_division_ids` (конфиг) − `current_for_many` (реюз 5.5b) → отстающие, ОДНИМ bulk-запросом (NFR-4). Без модели/миграции/override/HTTP/аудита/нотиф/RBAC (override → 5.6b; 422 → API 5.8/6.10). Файлов 1 нон-тест (`submissions/tomorrow_block.py`) + тесты; миграций/error-кодов НЕТ. Дефолты Д1–Д4, вопросы Q1–Q3. Конфиг-зависимость закрыта (`SubmissionControlSettings.required_division_ids` уже есть). Status → ready-for-dev.
