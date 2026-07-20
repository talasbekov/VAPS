---
baseline_commit: |
  e41aea8 (chore graphify после 14.1; feat 14.1 = 232ee4e). Ветка
  `claude/frosty-villani-bb0be9`, дерево чистое. E12 продолжается в worktree
  vigilant-sutherland — пересечений по файлам не создавать; дисциплина
  worktree: коммит по File List, HEAD до/после.
prerequisite: |
  14.1 done (232ee4e): app `ops_facilities`, Facility/FacilityPassport/
  FacilityPassportHistory, FacilitySelector, сервисы с локами, реестры
  FACILITY_*. Все ревью-каноны 14.1 действуют как ДЕФОЛТ этой стори:
  Lower-unique для кодов/имён, строгая pk-канонизация, select_for_update в
  селекторе внутри atomic, капы длин до БД, quantize десятичных, честная
  идемпотентность (noop без history/audit + снимок updated_at), state-ошибки
  = структурный 409 (не VALIDATION_ERROR), миграции по-сущности,
  <Domain>Selector-класс, kwarg `actor`, json.dumps-проба для JSON-полей,
  NaN-гард для чисел.
context:
  - _bmad-output/planning-artifacts/epics.md#L1402 (14.2 = Post (тип, задачи, предельное время, требования) и Sector со старшим)
  - /home/erda/Музыка/VAPS/docs/PersonnelStatus/VAPS_7.8.2.md#L544-568 (DDL ops_object_sectors: name, sort_order, UNIQUE(object,name); ops_object_posts: sector SET_NULL, code, name, post_type default FIXED RESTRICT, max_service_minutes DEFAULT 480 CHECK 30..1440, requirements JSONB '{}') · #L570-592 (DB-OPS-006 JSON-схема requirements: schema_version enum[1], min_height_cm 120..230, gender M/F/null, min/max_rank_index ≥0, required_position_codes uniq, allow_overqualification) · #L2330-2343 (DB-OPS-016: tasks/features/location_description TEXT, is_outdoor BOOL null, max_continuous_minutes INT null, min_rating NUMERIC(3,1) null, requires_weapon/special_equipment FALSE, requires_uniform TRUE) · #L2345-2349 (BR-POST-001 перегрузка по max_continuous; BR-POST-002 задачи доводятся при ознакомлении; BR-POST-003 в печать не выводить рейтинг/чувствительное) · #L451,#L519 (ops_post_types(code,name); seed FIXED, MOBILE, CHECKPOINT, RESERVE) · #L523 (ops_assignment_roles: SECTOR_SENIOR — «старший сектора» это РОЛЬ расстановки) · #L1228 (деактивация поста блокируется будущей занятостью — 409 POST_IN_USE)
  - /home/erda/Музыка/VAPS/docs/PersonnelStatus/ТЗ VAPS.md#L204-208 (FR-5.2 пост: задачи/особенности/тип/предельное время/требования; FR-5.3 предельное время — основа сменяемости, OQ-5; FR-5.4 сектор = зона из постов, старший сектора) · #L53,#L101 (старший сектора — служебная РОЛЬ на дату, не атрибут сектора)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L55-56 (глоссарий: Пост/Сектор) · #L124 (FR-19)
  - Backend/VAPS/apps/operations/facilities/ (весь app 14.1 — модели/селектор/сервисы/тесты = ПРЯМОЙ образец каждого слоя)
  - Backend/VAPS/apps/operations/statuses/models/status_type.py:4-16 (справочник с natural code-PK, is_active вместо delete, seed-команда) · statuses/admin.py (регистрация справочника в admin)
  - Backend/VAPS/apps/operations/management/commands/seed_operations.py (идемпотентный update_or_create-seed)
  - Backend/VAPS/apps/core/api/exception_handler.py:27-44 (CONSTRAINT_ERROR_MAP — race-бэкстопы уников)
  - docs/registries/audit-events.yaml (FACILITY_* образец записей 14.1) · docs/registries/error-codes.yaml (FACILITY_ALREADY_*)
---

# Story 14.2: Post (тип, задачи, предельное время, требования) и Sector со старшим

Status: done

## Story

As a Администратор / Старший объекта,
I want вести на объекте Секторы (зоны ответственности) и Посты с типом, задачами, предельным временем несения и требованиями к сотруднику,
so that расстановка (E16) и план дежурств (14.5) опираются на выверенную топологию объекта, а требования постов готовы для проверки соответствия (FR-25).

## Acceptance Criteria

1. **Справочник типов постов.** Given seed-команда, when посев, then PostType содержит FIXED/MOBILE/CHECKPOINT/RESERVE идемпотентно; справочник зарегистрирован в admin (канон «Admin = справочники»); Sector/Post в admin НЕ регистрируются.
2. **Sector.** Given валидные данные, when `create_sector(actor, facility_id, name, sort_order?)`, then сектор создан под активным объектом, аудит `SECTOR_CREATED`; имя уникально в пределах объекта регистронезависимо (Lower-unique, race-бэкстоп в CONSTRAINT_ERROR_MAP) — дубль → структурный 409.
3. **Post.** Given валидные данные, when `create_post(actor, facility_id, code, name, ...)`, then пост создан (тип по умолчанию FIXED, max_service_minutes по умолчанию 480), код уникален в пределах объекта регистронезависимо → дубль 409; сектор, если указан, обязан принадлежать ТОМУ ЖЕ объекту (кросс-объектный сектор → VALIDATION_ERROR); аудит `POST_CREATED`.
4. **Requirements по схеме.** Given `requirements` в changes/create, then сервис валидирует их по DB-OPS-006 (schema_version=1 обязателен, min_height_cm 120..230, gender ∈ {M,F,null}, rank-индексы ≥0 и min≤max, required_position_codes — список уникальных строк, allow_overqualification bool, additionalProperties запрещены) → нарушение = VALIDATION_ERROR 400 с именем поля; пустой dict запрещён (нет schema_version).
5. **DB-инварианты.** Then на уровне БД отвергаются: max_service_minutes вне [30,1440]; max_continuous_minutes ≤ 0; min_rating < 0; пустые (\S) name сектора / code и name поста; sort_order < 0. Drift-пробы транзакционные, обе границы диапазонов.
6. **Обновление и деактивация.** Given `update_sector/update_post` (whitelist полей + drift-тест против модели, лок, дифф, honest-noop) и `deactivate_sector/deactivate_post`, then мутации под select_for_update, аудит `*_UPDATED`/`*_DEACTIVATED`; повторная деактивация и мутация под деактивированным объектом/сущностью → структурный 409 (FACILITY_ALREADY_INACTIVE / новые SECTOR_/POST_ALREADY_INACTIVE); деактивация сектора отвязывает его посты (sector→NULL, зеркало донорского SET_NULL) с аудитом.
7. **Чтение.** `FacilitySelector`-канон: `SectorSelector`/`PostSelector` со строгой pk-канонизацией, list по объекту (сектора: sort_order,name,id; посты: code,id), actor первым аргументом.

## Tasks / Subtasks

- [x] Task 1: Модели (AC: 1,2,3,5) — `models/post_type.py`, `models/sector.py`, `models/post.py` + реэкспорт
  - [x] PostType: code PK(50), name(255), is_active (house-канон справочника; расширение донора)
  - [x] Sector(TimeStampedModel): facility FK CASCADE, name(255), sort_order PositiveInt-семантика через CHECK, is_active; uq_sector_facility_name = Lower(name) per facility; chk_sector_name_not_blank, chk_sector_sort_order_min
  - [x] Post(TimeStampedModel): facility FK CASCADE, sector FK SET_NULL null (внутрисубдоменный), code(50), name(255), post_type FK PROTECT db_column="post_type_code" default FIXED, max_service_minutes default 480, requirements JSONField default dict, tasks/features/location_description Text "", is_outdoor BooleanField null, max_continuous_minutes null, min_rating Decimal(3,1) null, requires_weapon/special_equipment False, requires_uniform True, is_active; uq_post_facility_code = Lower(code) per facility; chk_post_service_minutes_range (30..1440), chk_post_continuous_minutes_min (>0 или NULL), chk_post_min_rating_min (≥0 или NULL), chk_post_code_not_blank, chk_post_name_not_blank
- [x] Task 2: Миграции по-сущности: 0004_post_type, 0005_sector, 0006_post (ручные имена, dependencies цепочкой)
- [x] Task 3: Seed (AC: 1): `management/commands/seed_facilities.py` — update_or_create 4 типов; admin.py: только PostTypeAdmin
- [x] Task 4: Селекторы (AC: 7): SectorSelector, PostSelector (get/get_for_update/list_for_facility) + канонизация pk через общий канон 14.1
- [x] Task 5: Сервисы (AC: 2,3,4,6): create/update/deactivate для Sector и Post; валидатор requirements (DB-OPS-006, ручной — jsonschema-зависимость НЕ тянуть); same-facility инвариант сектора; локи; аудит 6 литералов + реестры (audit-events: SECTOR_*/POST_*; error-codes: SECTOR_ALREADY_EXISTS, POST_ALREADY_EXISTS, SECTOR_ALREADY_INACTIVE, POST_ALREADY_INACTIVE; CONSTRAINT_ERROR_MAP: оба Lower-уника)
- [x] Task 6: Тесты: модельные красные пробы всех констрейнтов (обе границы), сервисные (аудит/дубли/локи FOR UPDATE/атомарность через monkeypatch record/honest-noop со снимком/чужой сектор/деактивация каскад sector→NULL/requirements-валидатор позитив+негатив по каждому полю схемы), селекторные, drift-тесты (whitelist↔модель для post и sector), seed идемпотентность
- [x] Task 7: `make gate` из Backend/VAPS зелёный; ruff по файлам стори; schema не трогается (API нет)

## Dev Notes

### Ключевые решения (Д)

- **Д1. «Со старшим» — НЕ колонка.** Старший сектора — служебная роль на дату (ТЗ:53,101; ops_assignment_roles.SECTOR_SENIOR), назначается расстановкой E16. В доноре у ops_object_sectors старшего нет. Модель Sector без senior-поля; в docstring зафиксировать, где живёт старший.
- **Д2. post_type — честный FK** (PROTECT, db_column="post_type_code", default="FIXED"): внутри субдомена ARCH-003 не запрещает; донор даёт RESTRICT. Прецедент statuses (плоский CharField) — легаси-отсрочка, не канон для новых моделей.
- **Д3. requirements — ручная валидация** по DB-OPS-006 (jsonschema в зависимостях нет и не тянуть): schema_version==1, границы, типы, additionalProperties=false, min_rank_index ≤ max_rank_index (если оба заданы). Дефолт создания — {"schema_version": 1}, НЕ пустой dict (донорский DEFAULT '{}' нарушает собственную схему донора — required schema_version; дыра донора, закрываем).
- **Д4. min_rating хранится, не энфорсится** (RATING-DECISION-002); шкала неизвестна → CHECK только ≥0, верхнюю границу не выдумывать. BR-POST-003 (не выводить в печать) — зона печатных форм, не наша.
- **Д5. POST_IN_USE** (блокировка деактивации занятого поста, 7.8.2:1228) — named-defer до 14.5: дежурств ещё нет, проверять нечего. deactivate_post сейчас свободен; в 14.5 сервис деактивации обязан получить guard.
- **Д6. Деактивация сектора → его посты sector=NULL** (зеркало SET_NULL донора на уровне сервиса, т.к. это soft-delete, а не DELETE) — с включением списка отвязанных постов в audit new_value.
- **Д7. История паспорта НЕ трогается**: FacilityPassportHistory — только для полей паспорта (AC-041); топология секторов/постов подотчётна через audit_logs. Границу зафиксировать.
- **Д8. is_outdoor — BooleanField(null=True)**: донор BOOLEAN без NOT NULL; null = «не указано» (FR-5.2 «тип наружный/внутренний» уже есть отдельно в post_type? нет — FIXED/MOBILE это иная ось; is_outdoor остаётся самостоятельным трёхзначным).

### Наследуемые каноны 14.1 (не повторять ошибок)

Полный список — ревью-секция 14.1: локи в селекторе внутри atomic; Lower-уники + iexact pre-check + CONSTRAINT_ERROR_MAP; капы длин (code 50, name 255, actor 100); NaN/quantize для Decimal (min_rating!); строгая pk-канонизация; honest-noop со снимком updated_at; strip TEXT-полей; sorted(key=str) unknown-ключей; state-конфликты = структурные 409; json.dumps-проба; координатный урок «обе границы» → у minutes/rating пробировать 30 и 1440, 29 и 1441.

### Границы (что 14.2 НЕ делает)

Чек-листы (14.3), виды дежурств (14.4), план дежурств и POST_IN_USE-guard (14.5+), проверка соответствия требованиям FR-25 (16.3 конфликт-детектор — 14.2 только ХРАНИТ requirements), старший сектора как назначение (E16), HTTP API и экраны (14.11), печатные формы (BR-POST-003).

### Открытые вопросы → приняты дефолты Д1–Д8, поднять на ревью при несогласии.

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code, полный цикл в одной сессии 2026-07-20)

### Debug Log References

- Красная фаза: тесты топологии падают на ImportError до реализации.
- Разрез сгенерированной миграции на 0004/0005/0006: NameError на `apps.` в default requirements — добавлен импорт модуля в 0006; `makemigrations --check` чист.
- ruff: E501 в сгенерированных миграциях (формат по трём файлам), 4×F401 unused-import (autofix).
- Тесты стори: 195 passed (вся папка facilities, вместе с 14.1); `make gate`: **2686 passed, 72s**.

### Completion Notes List

- Все 7 AC покрыты прямыми тестами; requirements-валидатор — негативная проба на каждое поле схемы DB-OPS-006 + обе границы каждого диапазона (урок 14.1).
- Таблицы: `ops_post_types` (donor-имя), `ops_sectors`, `ops_posts` (канон `ops_<plural_snake>`; донорские `ops_object_*` переименованы вслед за `ops_facilities`).
- PostType расширен `is_active` против донора (house-канон справочников); зарегистрирован в admin, добавлен в `CATALOG_MODELS` стража admin-платформы (легитимный рост реестра справочников).
- Дефолт `requirements` = `{"schema_version": 1}` — донорский `DEFAULT '{}'` нарушает его же схему (Д3).
- «Старший сектора» — НЕ колонка (Д1): роль расстановки SECTOR_SENIOR (E16); зафиксировано в docstring модели.
- Деактивация сектора отвязывает посты bulk-UPDATE'ом под локами (сервисное зеркало донорского SET_NULL), `untied_post_ids` в audit new_value только при непустом списке.
- POST_IN_USE — named-defer до 14.5 (дежурств нет), закомментирован в deactivate_post и в реестре аудита.
- 6 audit-литералов и 4 error-кода добавлены тем же коммитом; оба Lower-уника — в CONSTRAINT_ERROR_MAP.
- `PostSelector.get_for_update` — `of=("self",)`: FOR UPDATE на nullable-стороне LEFT JOIN (sector) запрещён Postgres'ом.

### File List

- NEW `Backend/VAPS/apps/operations/facilities/models/post_type.py`
- NEW `Backend/VAPS/apps/operations/facilities/models/sector.py`
- NEW `Backend/VAPS/apps/operations/facilities/models/post.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0004_post_type.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0005_sector.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0006_post.py`
- NEW `Backend/VAPS/apps/operations/facilities/management/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/management/commands/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/management/commands/seed_facilities.py`
- NEW `Backend/VAPS/apps/operations/facilities/admin.py`
- NEW `Backend/VAPS/apps/operations/facilities/services/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/services/topology_service.py`
- NEW `Backend/VAPS/apps/operations/facilities/validators.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_topology_models.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_topology_services.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_topology_selectors.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_requirements_schema.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_seed_facilities.py`
- MODIFY `Backend/VAPS/apps/operations/facilities/models/__init__.py` (+3 реэкспорта)
- RENAME `Backend/VAPS/apps/operations/facilities/services.py` → `services/facility_service.py` (git mv; канон L415 + маска wall-clock-стража)
- MODIFY `Backend/VAPS/apps/operations/facilities/selectors.py` (общий `_canonize_pk`, +SectorSelector, +PostSelector)
- MODIFY `Backend/VAPS/apps/core/api/exception_handler.py` (+2 строки CONSTRAINT_ERROR_MAP)
- MODIFY `Backend/VAPS/apps/core/tests/test_admin_platform.py` (+PostType в CATALOG_MODELS)
- MODIFY `docs/registries/audit-events.yaml` (+6 action SECTOR_*/POST_*)
- MODIFY `docs/registries/error-codes.yaml` (+4 кода, расширено описание FACILITY_ALREADY_INACTIVE)

### Change Log

- 2026-07-20: Реализация 14.2 (3 модели + 3 миграции + seed + admin-справочник + селекторы + сервисы топологии + requirements-валидатор); тестов в app 195, гейт 2686 passed. Статус → review.

- 2026-07-20: Same-model max-ревью (5 finder-агентов, 10 углов): 19 сведённых находок, 15 исправлено, 3 задокументировано, 1 отложена (core-hoist, чип 14.1). Тестов в app 215; гейт 2706 passed. Статус → done.

## Senior Developer Review (AI)

**Модель:** claude-fable-5 (same-model max). **Итог:** Changes Requested → применено, гейт зелёный.

**Исправлено (15):** [High] deactivate-пути без гварда замороженного объекта (мутировали посты soft-deleted агрегата); [High] TOCTOU резолва сектора без лока (пост на мёртвом секторе без бэкстопа) → локированный резолв внутри транзакции; [High] of=("self") не лочил facility + create-пути проверяли объект вне транзакции → of=("self","facility") + get_for_update в create; [High] int4-потолок (_canonize_int всегда ≤ 2^31-1); [Med] seed воскрешал is_active → create_defaults (канон seed_statuses); [Med] bulk-untie без updated_at → Clock.now(); [Med] ключи аудита sector/post_type vs sector_id/post_type_code → единые плоские ключи; [Med] тотальный уник скваттил имя/код за неактивной строкой → partial-unique (is_active=True); [Med] дивергенция create/update-валидации → единая таблица _POST_CANONIZERS, вайтлист производен; [Med] пакет services/ (git mv, wall-clock-страж покрывает) + validators.py (канон L424); [Med] битая ссылка в пейлоаде 404→400; [Low] instance-лазейка _resolve_post_type; [Low] null-асимметрия allow_overqualification; [Low] 15+ тест-пинов (атомарность всех мутаций, локи, rename-дубль, noop сектора, обе границы, замороженные пути, освобождение имён); [Low] дрейф-гвард CONSTRAINT_ERROR_MAP.
**Без правки (3):** стори крупнее CLAUDE.md-лимитов (наследие эпик-каркаса — урок: остаток E14 декомпозировать мельче при create-story); default="FIXED" висяч до сида для raw-ORM (донор-контракт, сервис защищён); schema_version внутри JSON (донор DB-OPS-006).
**Отложено (1):** общий _diff_update/_canonize_decimal — в core-hoist задачу (чип 14.1).
