---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.12: Edit-safety справочников — валидаторы + create_defaults (4/4)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Под-стори 4/4 (последняя) эпик-стори «Admin для справочников»** (2.8 User-auth → 2.10 платформа → 2.11 регистрация+страж → **2.12 edit-safety**). Закрывает ДВЕ отложенные позиции, которые материализовались, как только 2.11 сделал справочники editable через Admin:
> 1. **Ре-сид затирает оператор-правки** ([deferred-work.md#L174], ревью 2.2): `seed_statuses` форсит `is_active=True` и `color=""` в `defaults` → следующий прогон `seed_statuses` стирает ручные правки этих полей. → `create_defaults` (Django 5.0+).
> 2. **`Position.level` без `MinValueValidator`** ([deferred-work.md#L193], ревью 2.6): `level=IntegerField(default=0)` допускает отрицательные → канон `sort_roster` («меньше=старше») сортирует их СТАРШЕ level 0. Оператор, введя `-1` в Admin, молча создаёт фантом-«старшего». → field-валидатор неотрицательности.
>
> ⚠️ **Это НЕ «без миграции» стори (в отличие от 2.11).** Field-валидаторы — часть migration-state: `makemigrations` сгенерит ОДНУ `AlterField`-миграцию (`core/0017`), **no-DDL** (валидаторы — Python-уровень), обратимую. До её создания `makemigrations --check` будет НЕ «No changes detected» — это ожидаемо, не паника.

## Story

As a администратор справочников VAPS,
I want чтобы (а) повторный посев `seed_statuses` не затирал ручные правки `is_active`/`color`, сделанные оператором через Admin, и (б) Admin отклонял отрицательные значения порядковых/уровневых полей справочников,
so that держатель admin-доступа правит справочники без страха, что ночной ре-сид сотрёт его изменения, а опечатка «-1» в уровне должности не ломала канон сортировки списков (FR-5/FR-39; deferred-work #L174, #L193).

## Acceptance Criteria

1. **Ре-сид НЕ затирает оператор-владеемые поля StatusType.** **Given** `seed_statuses` отработал и оператор поменял у строки StatusType `is_active=False` и `color="#abc"`, **When** `seed_statuses` запускается повторно, **Then** у этой строки `is_active` и `color` СОХРАНЕНЫ (не сброшены в `True`/`""`); **And** канон-поля (`name`, `priority`, `report_column_code`, `is_hard_block`, `restricts_editing`, `counts_in_staff`, `counts_in_list`, `is_ku_owned`) по-прежнему РЕ-синхронизируются из кода (оператор не может форкнуть канон — drift-cross-check `test_seed_statuses` остаётся зелёным).
2. **Отрицательные ordinal-значения справочников отклоняются.** **Given** валидаторы на `Position.level`, `Position.sort_order`, `Rank.rank_index`, `DivisionType.sort_order`, **When** инстанс с отрицательным значением проходит `full_clean()` (путь, по которому валидирует Admin ModelForm), **Then** поднимается `ValidationError` на этом поле; **And** `0` и положительные — проходят. (Эталонный кейс: `Position(...).level = -1` → `ValidationError`; `= 0` → OK — закрывает «фантом-старшего» из #L193.)
3. **Ровно одна обратимая no-DDL миграция.** **Given** добавление `validators=[MinValueValidator(0)]` к 4 полям, **When** `makemigrations`, **Then** создаётся РОВНО одна миграция `apps/core/migrations/0017_*.py` (операции `AlterField` для затронутых полей, без изменения схемы БД); **And** она обратима (`migrate core 0016` откатывает чисто — валидаторы снимаются, данные не трогаются); **And** ПОСЛЕ её создания `makemigrations --check --dry-run` → «No changes detected».
4. **Нулевая регрессия и границы.** **Given** изменения, **Then**: `seed_statuses`/`seed_core`/`import_references` остаются идемпотентными (повторный прогон без дублей/ошибок); `seed_core` и `import_references` НЕ изменяются (они уже не кладут `is_active` в `defaults` — уже безопасны, правка = no-op churn → ЗАПРЕЩЕНО); ни одна бизнес-модель/структура поля не меняется кроме добавления `validators`; страж-тест реестра 2.11 и boundary-guard 2.9 зелёные; все существующие тесты зелёные.
5. **Гейт.** **When** `make gate` (Postgres :5433), **Then** `ruff check .` чист, pytest зелёный (+новые тесты re-seed-preservation и validator), `manage.py check` 0 issues, `makemigrations --check` «No changes detected», бюджет < 300с. **Артефакты НЕ коммитить** (за Bratan).

## Tasks / Subtasks

- [x] **Задача 1. `create_defaults` в `seed_statuses` (AC: 1)**
  - [x] В `apps/operations/statuses/management/commands/seed_statuses.py` перенести `"is_active": True` и `"color": ""` ИЗ `defaults` В `create_defaults={...}` (Django 5.0+; точный прецедент — `apps/operations/services.py:76`). Канон-поля (name/priority/report_column_code/is_hard_block/restricts_editing/counts_in_staff/counts_in_list/is_ku_owned) ОСТАЮТСЯ в `defaults` — они синхронизируются из кода на каждом прогоне.
  - [x] Семантика, которую закрепляем: на CREATE строка получает `is_active=True`/`color=""` (из create_defaults); на UPDATE существующей строки эти два поля НЕ перезаписываются (их нет в `defaults`) → оператор-правки выживают.
- [x] **Задача 2. `MinValueValidator(0)` на ordinal-поля справочников (AC: 2, 3)**
  - [x] В `apps/core/models.py` добавить `validators=[MinValueValidator(0)]` к: `Position.level` (стр. 117), `Position.sort_order` (стр. 118), `Rank.rank_index` (стр. 133), `DivisionType.sort_order` (стр. 104). `MinValueValidator` уже импортирован (стр. 6). Сигнатуру/тип/`default` полей НЕ менять — только добавить `validators=`.
  - [x] `python manage.py makemigrations core` → ожидается ОДНА миграция `0017_*` с `AlterField` по 4 полям. Проверить: миграция содержит ТОЛЬКО `AlterField` (нет `AddField`/`CreateModel`/`RunSQL`); `sqlmigrate core 0017` → пусто/no-op (валидаторы не дают DDL). Reverse-проверка: `migrate core 0016` затем `migrate core 0017` — оба `exit=0` (round-trip как в прецеденте 2.1/2.8 для рисковых миграций; здесь риск минимален — no-DDL).
- [x] **Задача 3. Тест re-seed-preservation (AC: 1)**
  - [x] В `apps/operations/statuses/tests/test_seed_statuses.py`: `call_command("seed_statuses")` → взять строку (напр. `IN_SERVICE`), `obj.is_active=False; obj.color="#abc"; obj.save()` → `call_command("seed_statuses")` снова → `refresh_from_db` → `assert is_active is False and color == "#abc"` (оператор-правки выжили); **И** проверить, что канон ре-синкнулся: подправить в БД `name` той же строки на мусор → ре-сид → `assert name == <канон из STATUS_TYPES>` (канон не форкается). Это и есть дискриминирующий тест (без create_defaults первый assert падает; без `defaults` для канона — второй).
- [x] **Задача 4. Тесты validator (AC: 2)**
  - [x] В `apps/core/tests/test_positions.py`: `with pytest.raises(ValidationError): Position(code="X", name="Y", level=-1).full_clean()`; и `Position(code="X", name="Y", level=0, sort_order=0).full_clean()` НЕ поднимает (используй `full_clean(validate_unique=False)` либо `@pytest.mark.django_db`, т.к. `validate_unique` бьёт в БД). Отдельный кейс на `sort_order=-1`.
  - [x] В `apps/core/tests/test_ranks.py`: аналогично для `Rank.rank_index=-1` → `ValidationError`; `=0` → OK.
  - [x] В `apps/core/tests/test_division_types.py`: аналогично для `DivisionType.sort_order=-1` → `ValidationError`; `=0` → OK.
- [x] **Задача 5. Гейт (AC: 5)**
  - [x] `make gate` (Postgres :5433): ruff чист, pytest зелёный, `manage.py check` 0 issues, `makemigrations --check` «No changes detected» (после создания 0017). **Артефакты НЕ коммитить.**

## Dev Notes

### Часть A — `create_defaults`: что и почему ровно в `seed_statuses` (и больше нигде)

**Корень (deferred #L174, ревью 2.2):** `seed_statuses.handle()` зовёт `update_or_create(code=…, defaults={… "color":"", "is_active":True})`. `defaults` применяется и на CREATE, и на UPDATE → каждый ре-сид форсит `is_active=True`/`color=""`, стирая то, что оператор поправил через Admin (2.11 сделал StatusType editable).

**Семантика `update_or_create(defaults, create_defaults)` (Django 5.0+):**
- CREATE новой строки → применяется `{**defaults, **create_defaults}` (create_defaults перекрывает defaults).
- UPDATE существующей → применяется ТОЛЬКО `defaults`.
- ⇒ Поле, лежащее в `create_defaults` и ОТСУТСТВУЮЩЕЕ в `defaults`, ставится лишь при создании и не трогается на апдейте.

**Рецепт (минимально-корректный):**
```python
StatusType.objects.update_or_create(
    code=code,
    defaults={                                    # КАНОН — ре-синк из кода каждый прогон
        "name": name,
        "priority": priority,
        "report_column_code": report_column_code,
        "is_hard_block": code in HARD_BLOCK_CODES,
        "restricts_editing": code in RESTRICTS_EDITING_CODES,
        "counts_in_staff": code not in NOT_COUNTED_IN_STAFF_CODES,
        "counts_in_list": True,
        "is_ku_owned": code in KU_OWNED_CODES,
    },
    create_defaults={                             # ОПЕРАТОР-ВЛАДЕЕМЫЕ — только на create
        "color": "",
        "is_active": True,
    },
)
```
Модельные дефолты (`color` default="", `is_active` default=True) и так дают эти значения новой строке, так что `create_defaults` здесь = явная фиксация контракта + паритет с прецедентом `services.py:76` (там `create_defaults={"is_active": True, "created_by": actor}` именно чтобы апдейт не переписывал append-once поле).

**ГРАНИЦА — НЕ трогать `seed_core` и `import_references`:**
- `seed_core` (Position/Rank/DivisionType): `defaults` НЕ содержит `is_active` (стр. 40/46/52 — только name/sort_order/level/category/rank_index). Уже безопасен. Добавлять create_defaults = no-op churn → **запрещено** (AC-4).
- `import_references.py` (2.7): дев осознанно держит `is_active` ВНЕ `defaults` («is_active НЕ в defaults — не затирается на update»). Уже безопасен. Не трогать.
- ⇒ Часть A = ровно один файл `seed_statuses.py`.

**Что Часть A НЕ делает (смежные deferred, остаются отложены):** реконсиляция выпавших из `STATUS_TYPES` кодов (#L173, grow-only soft-delete) — ОРТОГОНАЛЬНО, не в этой стори; перенос `is_active` в create_defaults НЕ авто-деактивирует удалённые коды.

### Часть B — `MinValueValidator(0)`: поля, миграция, реальная семантика энфорса

**Корень (deferred #L193, ревью 2.6):** `Position.level=IntegerField(default=0)`. Канон `apps/core/sorting.py` сортирует «меньший level = старше». Отрицательный level → строка всплывает СТАРШЕ level 0 (фантом). Узаконить неотрицательность.

**Поля (семейство «неотрицательный порядковый» на 3 core-справочниках, registered в Admin 2.11):**
| Поле | Файл:строка | Почему |
|---|---|---|
| `Position.level` | models.py:117 | первичный кейс #L193 (канон сортировки) |
| `Position.sort_order` | models.py:118 | то же семейство (явно назван в out-of-scope 2.11) |
| `Rank.rank_index` | models.py:133 | то же (явно назван в out-of-scope 2.11) |
| `DivisionType.sort_order` | models.py:104 | то же, паритет |

Паттерн уже в кодбазе: `models.py:205` (`height_cm` MinValue/MaxValue), `models.py:297` (`allocated_slots` MinValueValidator(0)). Импорт `MinValueValidator` уже есть (стр. 6) — НЕ дублировать.

**Подход = field-валидатор (НЕ кастомная Admin ModelForm).** Рассмотрена альтернатива — `clean_<field>` в кастомной admin-форме (даёт no-миграцию). ОТВЕРГНУТА: field-валидатор (а) идиоматичен здесь (height_cm/allocated_slots), (б) модель = источник истины, валидатор едет с полем и защитит будущие DRF-сериализаторы/формы, (в) миграция тривиальна (no-DDL). Admin-only форма оставила бы дыру для не-Admin путей.

**⚠️ МИГРАЦИЯ ОБЯЗАТЕЛЬНА (главное отличие от 2.11):**
- `validators` — часть `Field.deconstruct()` → `makemigrations` генерит `AlterField`. Это НЕ опционально: гейт гоняет `makemigrations --check`; без миграции он КРАСНЫЙ.
- Миграция **не трогает БД-схему** (`sqlmigrate` → пусто): валидаторы энфорсятся в Python через `full_clean()`, не в DDL.
- Обратима по построению (`AlterField` ↔ `AlterField`). Round-trip `migrate 0016 ↔ 0017` для самопроверки (прецедент рисковых миграций 2.1/2.8; тут риск минимален).
- Имя: `0017_*` (последняя core-миграция = `0016_user_groups_...`).

**Реальная семантика энфорса (важно для тестов и регрессии):**
- field `validators` бегут на `full_clean()` (ModelForm/Admin), **НЕ** на голом `Model.save()`/`update_or_create`.
- ⇒ Admin-правка оператора → ModelForm.full_clean() → валидатор ловит `-1` (целевой сценарий — закрыт). ✓
- ⇒ `seed_*`/`import_references` (голый upsert, без full_clean) валидаторы НЕ запускают — но их значения неотрицательны по построению → НЕ регрессия. Это правильный, соразмерный фикс под «валидатор/Admin-форма» из #L193.

### Gotchas

- **`makemigrations --check` НЕ «No changes detected» до создания 0017.** Это ожидаемо (Часть B меняет migration-state). 2.11 был «без миграции» — НЕ переносить эту установку сюда. Создать 0017, ПОТОМ check зелёный.
- **`full_clean()` бьёт в БД на `validate_unique`** (PK lookup). В юнит-тесте: `full_clean(validate_unique=False)` ИЛИ `@pytest.mark.django_db` (большинство core-тестов уже под django_db). `clean_fields()` тоже гоняет field-валидаторы без unique.
- **`color` валидный пустой default.** `color=CharField(max_length=20, blank=True, default="")` — оставить как есть; Часть A только меняет, где он задаётся в seed.
- **Drift-cross-check `test_seed_statuses`** сверяет канон-поля каталога с `strength_report`-константами. Перенос `is_active`/`color` в create_defaults канон НЕ трогает (они не канон) → cross-check остаётся зелёным. НЕ перемещать канон-поля в create_defaults (иначе ре-синк сломается → drift-тест красный).
- **boundary-guard 2.9** сканит `apps/operations/**`. `seed_statuses.py` — не вью, Django-perm-токенов нет → зелёный. Часть B в `apps/core/models.py` (вне скана operations). Страж-реестра 2.11 не затрагивается (регистрация не меняется).
- **Не плодить файлы:** тест-дома существуют — `test_positions.py`, `test_ranks.py`, `test_division_types.py`, `test_seed_statuses.py`. Дописать туда, новые файлы не нужны.

### Out of Scope (НЕ реализовывать в 2.12)

- **DB-level `CheckConstraint(level__gte=0)`** (был бы сильнее, но даёт DDL-миграцию + риск на существующих данных) → не сейчас; задокументировать как возможный future-hardening, если понадобится БД-гарантия.
- **`MinValueValidator` на `StatusType.priority`** — не в deferred-пунктах; priority seeded и cross-checked против strength_report; оператор-правка priority — отдельный вопрос. Не трогать.
- **Реконсиляция выпавших StatusType-кодов** (#L173, grow-only soft-delete) — отдельный отложенный пункт, не эта стори.
- **Валидация существования `required_division_ids`** (deferred 2.3) — не эта стори.
- **Любая кастомизация Admin-форм** сверх того, что бесплатно даёт field-валидатор; страж-реестр/регистрация (2.11) не меняются.
- **Гейт прав на core API** → 2.13. **Прод-hardening/STATIC_ROOT** → E12.

### Project Structure Notes

- **Изменить:** `Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py` (Часть A); `Backend/VAPS/apps/core/models.py` (Часть B, +validators на 4 поля).
- **Создать:** `Backend/VAPS/apps/core/migrations/0017_*.py` (сгенерить `makemigrations`, no-DDL AlterField, обратимая); тест-кейсы в существующих `test_seed_statuses.py` / `test_positions.py` / `test_ranks.py` / `test_division_types.py`.
- **НЕ трогать:** `seed_core.py`, `import_references.py` (уже безопасны), любые admin.py (2.11), бизнес-модели, RBAC, config. ≤2 файла кода + 1 миграция + тесты. Одна ответственность (edit-safety справочников).

### References

- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L174] — re-seed перетирает оператор-правки (`is_active`/`color`) → `create_defaults` (Django 5.0+). Ревью 2.2.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L193] — `Position.level` без `MinValueValidator`; отрицательные сортируются «старше» 0. Ревью 2.6.
- [Source: _bmad-output/implementation-artifacts/2-11-регистрация-справочников-в-admin.md#L149-151] — out-of-scope 2.11 → 2.12: «MinValueValidator (Position.level/sort_order, Rank.rank_index) + create_defaults; editable-admin без 2.12 подвержен ре-сид-затиранию».
- [Source: Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py:60-75] — целевой `update_or_create` (Часть A).
- [Source: Backend/VAPS/apps/operations/services.py:70-77] — ПРЕЦЕДЕНТ `create_defaults` (RoleAdminService.assign_role): «create_defaults (Django 5.0+), not defaults» для append-once поля.
- [Source: Backend/VAPS/apps/core/models.py:101-141] — `DivisionType`/`Position`/`Rank` (поля под валидатор); :6 импорт MinValueValidator; :205/:297 прецедент field-валидаторов.
- [Source: Backend/VAPS/apps/operations/statuses/models/status_type.py] — `StatusType` (`color` blank/default="", `is_active` default=True; docstring «plain reference table»).
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_seed_statuses.py] — drift-cross-check каталога ↔ strength_report (остаётся зелёным; дом теста re-seed-preservation).
- [Source: pyproject.toml] — `Django>=5.0,<5.2` → `create_defaults` доступен.
- [Decision] AskUserQuestion 2026-06-23 (в 2.8): «Django Admin + реанимация Django-auth» (Bratan) — декомпозиция 2.8/2.10/2.11/2.12.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23, TDD. baseline_commit `6658568`. Django 5.1.15.

### Debug Log References

- **TDD RED→GREEN:** написаны 8 тестов первыми — RED-прогон: 5 упали как задумано (4 `*_rejects_negative_*` → «DID NOT RAISE ValidationError»; `test_reseed_preserves_operator_edits_but_resyncs_canon` → is_active/color сброшены ре-сидом), 9 прошли (boundary `*_allows_zero_*` + существующие). После фикса — 22 passed.
- **ГЛАВНАЯ ловушка `create_defaults` (Django 5.x):** первая редакция перенесла ТОЛЬКО `color`/`is_active` в `create_defaults`, оставив канон в `defaults`. Это сломало ВСЕ seed-тесты `IntegrityError` (`priority=None`): когда `create_defaults` задан, на CREATE он **полностью ЗАМЕНЯЕТ** `defaults` (НЕ мёрджится) → канон не попадал в INSERT. Фикс: `create_defaults={**canon, "color": "", "is_active": True}` — полный супер-сет для валидного INSERT; `defaults=canon` без operator-полей → на UPDATE color/is_active не трогаются. Совпадает с прецедентом `services.py:76` (там `is_active` в ОБОИХ).
- **Миграция (отличие от 2.11):** `makemigrations core` → одна миграция `0017` с 4×`AlterField` (только validators). `sqlmigrate core 0017` → все 4 операции `-- (no-op)` (no-DDL, валидаторы — Python-уровень). Round-trip на dev-БД vaps: `migrate core 0017` → `migrate core 0016` (reverse OK) → `migrate core 0017` (forward OK) — три `exit=0`, обратима.
- **ruff E501 на сгенерированной 0017** (строки `field=models.IntegerField(... MinValueValidator(0))` 107>88, как в 0016): `ruff format` по файлу миграции (per memory-гайд: format по файлу, не по app-папке) → перенос аргументов под 88; `ruff check` чист без noqa-костылей.
- **Границы:** `seed_core`/`import_references` НЕ тронуты (уже безопасны — нет is_active в defaults); бизнес-модели/структура не менялись (только `validators=`); страж-реестр 2.11 и boundary-guard 2.9 (`test_authz_boundary.py`) зелёные.
- **Полный `make gate`** (Postgres :5433): **552 passed (+8)**, 18 deselected, 28 xfailed; `ruff check .` чист; `makemigrations --check` «No changes detected»; `manage.py check` 0 issues; 14s (бюджет NFR-8 = 300s).

### Completion Notes List

- **Часть A (`create_defaults`, deferred #L174):** `seed_statuses.py` — канон в `defaults` (ре-синк из кода каждый прогон, drift-cross-check цел), `color`/`is_active` в `create_defaults` (set-on-create, выживают на ре-сиде). Локальный `canon`-dict переиспользован в обоих, чтобы `create_defaults` был полным супер-сетом (иначе IntegrityError на create — см. Debug Log). `seed_core`/`import_references` не тронуты (уже безопасны).
- **Часть B (`MinValueValidator(0)`, deferred #L193):** добавлен к `Position.level`, `Position.sort_order`, `Rank.rank_index`, `DivisionType.sort_order` в `core/models.py` (импорт уже был). Энфорс на `full_clean()` (путь Admin ModelForm) — отрицательные отклоняются, `0` проходит; голый seed/import не валидируется (значения неотрицательны по построению → не регрессия).
- **Миграция `core/0017`:** одна, обратимая, no-DDL (`sqlmigrate` → `(no-op)`). Это ожидаемое отличие от 2.11 (валидаторы — часть migration-state).
- **Тесты (+8) в существующих файлах:** re-seed-preservation (operator-edits survive + canon re-sync); по 1 reject-negative + 1 allow-zero на каждый из 4 валидаторов (Position level/sort_order совмещены: 2 reject + 1 zero).
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.11). Status → review. E2 после ревью: останется только backlog-стори 2.13.

### File List

**Изменено:**
- `Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py` (Часть A: create_defaults)
- `Backend/VAPS/apps/core/models.py` (Часть B: MinValueValidator на 4 ordinal-поля)
- `Backend/VAPS/apps/core/tests/test_positions.py` (3 теста: reject level/sort_order, allow zero)
- `Backend/VAPS/apps/core/tests/test_ranks.py` (2 теста: reject/allow rank_index)
- `Backend/VAPS/apps/core/tests/test_division_types.py` (2 теста: reject/allow sort_order)
- `Backend/VAPS/apps/operations/statuses/tests/test_seed_statuses.py` (1 тест: re-seed preservation)
- `Backend/VAPS/apps/core/management/commands/import_references.py` (review-patch D1: негативные ordinal'ы → skip)
- `Backend/VAPS/apps/core/tests/test_import_references.py` (review-patch D1: +3 теста negative level/sort_order/rank_index)

**Создано:**
- `Backend/VAPS/apps/core/migrations/0017_alter_divisiontype_sort_order_alter_position_level_and_more.py` (4×AlterField, no-DDL, обратимая)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.12 (bmad-create-story, Opus 4.8): edit-safety справочников (4/4 декомпозиции «Admin для справочников»). Часть A — `create_defaults` в `seed_statuses` (is_active/color оператор-владеемы, перенести из defaults; seed_core/import_references уже безопасны — не трогать). Часть B — `MinValueValidator(0)` на Position.level/sort_order, Rank.rank_index, DivisionType.sort_order; порождает обратимую no-DDL AlterField-миграцию `core/0017` (отличие от 2.11). Закрывает deferred #L174 (ревью 2.2) и #L193 (ревью 2.6). Тесты в существующих файлах. Status → ready-for-dev. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): реализованы обе части. Часть A — `seed_statuses` переведён на `defaults=canon` + `create_defaults={**canon, color, is_active}` (ловушка Django 5.x: create_defaults полностью ЗАМЕНЯЕТ defaults на create, не мёрджит — первая редакция без канона в create_defaults валила seed IntegrityError priority=None; прецедент services.py:76). Часть B — `MinValueValidator(0)` на 4 ordinal-поля core, миграция `0017` (4×AlterField, sqlmigrate → no-op, round-trip forward→reverse→forward на vaps три exit=0; ruff format снял E501). +8 тестов в существующих файлах (re-seed-preservation + reject/allow по 4 валидаторам). seed_core/import_references не тронуты; страж-реестр 2.11 + boundary-guard 2.9 зелёные. `make gate` зелёный (Postgres :5433: 552 passed +8, 28 xfailed, ruff чист, makemigrations «No changes detected», check 0 issues, 14s). Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff ~250 строк по 7 файлам). Acceptance Auditor: **ACCEPT** — AC-1..5 SATISFIED эмпирически (re-seed-preservation + canon re-sync; 4 валидатора + boundary zero; одна no-DDL обратимая 0017; seed_core/import_references провер. НЕ тронуты; out-of-scope DB-constraint/priority/#L173 корректно опущены; File List точен; guards 2.9/2.11 зелёные). Edge эмпирически подтвердил безопасность create_defaults + что DRF-сериализаторы наследуют валидатор (reject на create+PATCH). 1 decision · 0 patch · 2 defer · 8 dismiss. См. ## Review Findings. |
| 2026-06-23 | Decision D1 РАЗРЕШЁН Bratan (вариант A): Edge вскрыл, что field-валидатор не покрывает bare-upsert `import_references` (FR-39 bulk-путь; дыра, отложенная ревью 2.7 → 2.12). Override AC-4 «не трогать import_references» (допущение «уже безопасен» ложно для Part B). ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО: guard'ы `import_references` расширены на отрицательные (`level/sort_order/rank_index < 0` → существующий skip-reason, без новой таксономии) + 3 теста. Инвариант неотрицательности теперь на ОБОИХ путях. 2 defer → deferred-work.md (data-at-rest негативы без DB-constraint; асимметрия деактивации системного StatusType → E3). `make gate` зелёный (Postgres :5433: 555 passed +3, 28 xfailed, ruff чист, makemigrations «No changes detected», 17s). Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat; 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor; scoped diff ~250 строк по 7 файлам). Acceptance Auditor: **ACCEPT** — все 5 AC SATISFIED, верифицировано реальным прогоном. Edge Case Hunter (с кодом + БД) эмпирически подтвердил безопасность `create_defaults` (preserve + re-sync) и что DRF-сериализаторы наследуют валидатор (reject на create+PATCH), но вскрыл один реальный gap по bare-upsert импорту. 1 decision · 0 patch · 2 defer · 8 dismiss._

### Decision (1) → РАЗРЕШЕНО (Patch применён)

- [x] [Review][Decision→Patch] **CSV-импорт (`import_references`) пишет отрицательные ordinal'ы мимо валидатора** [Backend/VAPS/apps/core/management/commands/import_references.py:146-156,189-191] — Edge эмпирически подтвердил: `_parse_int("-1")` → `-1` (фильтруются только blank→0 и нечисло→None; отрицательные проходят) → bare `update_or_create` без `full_clean` → отрицательный `level`/`sort_order`/`rank_index` персистится. Field-валидатор 2.12 закрывает Admin + DRF API (Edge подтвердил), но НЕ bare-upsert импорт — именно FR-39 bulk-путь этих полей (стори 2.7). Это ровно дыра, отложенная ревью 2.7 на «валидатор 2.8»(→2.12). **РЕШЕНИЕ Bratan: (A) пропатчить сейчас** (override AC-4 «не трогать import_references» — допущение «уже безопасен» было ложным для Part B). ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО: guard'ы расширены `if level is None or level < 0:` (то же sort_order/rank_index), переиспользуют существующие skip-reason'ы `invalid_level`/`invalid_sort_order`/`invalid_rank_index` (без новой таксономии); +3 теста (negative level/sort_order/rank_index → skipped, не персистится). 2.12 теперь даёт инвариант неотрицательности на ОБОИХ путях (Admin/API full_clean + bulk-импорт). `make gate` зелёный (Postgres :5433: 555 passed +3, 28 xfailed, ruff чист, makemigrations «No changes detected», 17s).

### Defer (2)

- [x] [Review][Defer] **Существующие отрицательные строки в БД не детектятся/не чинятся миграцией 0017** [Backend/VAPS/apps/core/migrations/0017_*.py] — deferred, pre-existing. 0017 = 4×AlterField (Python-валидатор), без DB CheckConstraint и data-migration; `sorting.py` читает `level` без floor. Если отрицательная строка уже попала в БД (напр. через import до фикса D1) — seniority-hazard остаётся живым для data-at-rest. Парно с разрешением D1; на пилоте (seed/import дают неотрицательные конст.) сейчас не материально.
- [x] [Review][Defer] **Ре-сид больше не реактивирует оператор-деактивированный системный StatusType** [Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py] — deferred, by-design (#L174). Перенос `is_active` в create_defaults означает: канонический системный тип (напр. `IN_SERVICE`, priority 999) можно через Admin выставить `is_active=False`, и ре-сид его больше НЕ восстановит. Асимметрия (канон форс-синкается, активация — нет) без safety-net. Гард «системно-критичные типы нельзя деактивировать» — естественный дом статус-движка E3.

### Dismissed (8)

- **`create_defaults` re-INSERT теряет правки / NOT NULL-риск** (blind HIGH): опровергнуто Edge эмпирически — create-путь валиден (модельные дефолты `color=""`/`is_active=True` + полный `create_defaults`-суперсет), 22 целевых теста зелёные (IntegrityError был бы при неполном create_defaults — ровно баг, пойманный в dev).
- **`create_defaults` требует Django 5.0+ без гарда** (blind HIGH): опровергнуто — `pyproject.toml` пинит `Django>=5.0,<5.2`, развёрнут 5.1.15; нижняя граница гарантирована зависимостью.
- **Тесты проверяют валидатор, не инвариант / `allows_zero` тавтологичны** (blind MED + edge LOW, merged): валидатор = специфицированный соразмерный фикс (Part B); DRF-путь эмпирически reject'ит отрицательные (Edge); reject-тесты ловят рас-вайринг; boundary-zero дёшев и намеренен. Энфорс-at-DB вынесен в D1/W1.
- **Canon re-sync проверен лишь на одном поле одной строки** (blind MED): опровергнуто — другие seed-тесты ассертят канон по-строчно по всем 17 строкам (`test_priorities_and_columns_match_strength_report`, `test_exactly_four_hard_blocks_match_constant`, `test_counts_in_staff_false_only_for_attached`).
- **Import `MinValueValidator` не показан в дифе** (blind LOW): опровергнуто — импорт уже на `models.py:6` (Auditor подтвердил); Blind без доступа к проекту.
- **Имя файла миграции усечено** (blind LOW): артефакт усечённого промпта; полный файл верифицирован — одна миграция, только 4×AlterField.
- **`color=""` невалиден для color-поля** (blind LOW): UI-палитра out of scope (отложена на UI-стори; `status_type.py:27` «concrete palette deferred to the UI story»).
- **Нет теста на create-путь `create_defaults`** (edge LOW): опровергнуто как материальное — `test_seed_creates_all_types` создаёт все 17 строк с нуля; набор упал бы IntegrityError при неполном `create_defaults` (covered implicitly).
