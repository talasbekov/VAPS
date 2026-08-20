# Живой бэк ГВО + Охраняемые лица — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** снять «Реестр ГВО» и «Охраняемые лица» с мока MSW: хранилище патчей сводок и каталог лиц — на Django-бэке, фронт переключается на live.

**Architecture:** модели в `apps/operations/models_gvo.py`, сервис+API — в `apps/ops` (как у остальных `/api/ops/*`); контракт повторяет мок 1:1 (`{results: []}`, camelCase вручную в сериализаторах); клиентская сборка сводки из бюллетеня не меняется.

**Tech Stack:** Django/DRF (Personnel-Records, :8100), pytest (settings `organization_management.config.settings.test`), Next.js PersonalRecordFront (:3106), MSW, Playwright.

## Global Constraints

- Рабочие директории: бэк `Backend/PersonnelStatus/Personnel-Records`, фронт `Backend/PersonnelStatus/PersonalRecordFront`. Пути ниже — от этих корней.
- Права: только существующие коды `event.view` (чтение) и `event.manage` (правка) — новых НЕ заводить.
- ID: бэк отдаёт int; клиент приводит `String(id)` на границе api-клиента; типы entities (`id: string`) не менять.
- Тесты сеют напрямую (bulk_create/objects.create), factory_boy не тянуть. `ruff format` — только по своим файлам; гейт `ruff check` (E,F).
- Прогоны Playwright проверять грепом `failed|✘`, не tail. Тестовая БД при параллельных сессиях — ручка `PR_TEST_DB_NAME`.
- Коммит после каждой задачи: `feat(ops-gvo): …` / `test(ops-gvo): …`; сообщения на русском, как в истории.
- 4 модуля портала не трогать.

## Команды

- Бэк-тесты: `python -m pytest organization_management/apps/ops/tests/test_ops_gvo_api.py -x -q` (из корня Personnel-Records, venv проекта).
- Миграции: `python manage.py makemigrations operations && python manage.py migrate` (settings `local_postgres` на стенде; в тестах — авто).

---

### Task 1: Модель OpsProtectedPerson + миграция + constraint-проба

**Files:**
- Create: `organization_management/apps/operations/models_gvo.py`
- Modify: `organization_management/apps/operations/models.py` (реэкспорт, если так делают соседи — проверить, как импортируются `models_event`)
- Test: `organization_management/apps/ops/tests/test_ops_gvo_models.py`

**Interfaces:**
- Produces: `OpsProtectedPerson(name, callsign, category, bio, is_active)`, `OpsProtectedPerson.Category.OURS/FOREIGN`; Meta.ordering `["name", "id"]`; CheckConstraint `chk_ops_protected_person_category`.

- [ ] **Step 1: Написать красный тест модели**

```python
# test_ops_gvo_models.py
"""Модели ГВО/охраняемых лиц: каталог лиц и патч сводки.

Инварианты уровня БД: category ограничен CheckConstraint (choice без
дефолта — практика проекта), один патч на мероприятие (OneToOne)."""
import pytest
from django.db import IntegrityError

from organization_management.apps.operations.models_gvo import OpsProtectedPerson


@pytest.mark.django_db
def test_protected_person_category_constraint_rejects_unknown():
    with pytest.raises(IntegrityError):
        OpsProtectedPerson.objects.create(
            name="Тест", category="ALIEN", bio=""
        )


@pytest.mark.django_db
def test_protected_person_ordering_by_name_then_id():
    OpsProtectedPerson.objects.create(name="Б", category="OURS")
    OpsProtectedPerson.objects.create(name="А", category="FOREIGN")
    assert list(
        OpsProtectedPerson.objects.values_list("name", flat=True)
    ) == ["А", "Б"]
```

- [ ] **Step 2: Прогнать — FAIL** (`ModuleNotFoundError: models_gvo`).
- [ ] **Step 3: Реализовать модель**

```python
# models_gvo.py
"""Каталог охраняемых лиц и патчи сводок ГВО (спека 2026-08-20)."""
from django.conf import settings
from django.db import models

from organization_management.apps.common.models import TimeStampedModel
from organization_management.apps.operations.models_event import OpsSecurityEvent


class OpsProtectedPerson(TimeStampedModel):
    class Category(models.TextChoices):
        OURS = "OURS", "Свои"
        FOREIGN = "FOREIGN", "Иностранные"

    name = models.CharField(max_length=200)
    callsign = models.CharField(max_length=100, blank=True)
    category = models.CharField(max_length=10, choices=Category.choices)
    bio = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(category__in=("OURS", "FOREIGN")),
                name="chk_ops_protected_person_category",
            ),
        ]

    def __str__(self):
        return self.name
```

(базовый класс `TimeStampedModel` — взять реальный импорт из `models_event.py`, там он уже используется.)

- [ ] **Step 4: makemigrations operations, прогнать тесты — PASS.**
- [ ] **Step 5: Красная проба constraint через МУТАЦИЮ МИГРАЦИИ** (снятие в модели тесты не ловят — практика проекта): временно закомментировать CheckConstraint в сгенерированной миграции, пересоздать тестовую БД (`pytest --create-db`), убедиться что `test_..._rejects_unknown` ПАДАЕТ; вернуть, `--create-db`, PASS.
- [ ] **Step 6: Commit** `feat(ops-gvo): каталог охраняемых лиц — модель с DB-инвариантом категории`.

### Task 2: Модель OpsGvoSummaryPatch + миграция

**Files:**
- Modify: `organization_management/apps/operations/models_gvo.py`
- Test: `organization_management/apps/ops/tests/test_ops_gvo_models.py`

**Interfaces:**
- Produces: `OpsGvoSummaryPatch(event OneToOne→OpsSecurityEvent related_name="gvo_patch", patch JSONField, updated_by FK settings.AUTH_USER_MODEL SET_NULL null=True)`.

- [ ] **Step 1: Красный тест**

```python
@pytest.mark.django_db
def test_gvo_patch_one_per_event():
    from organization_management.apps.operations.models_gvo import OpsGvoSummaryPatch
    ev = OpsSecurityEvent.objects.create(code="ОМ-Т-1", title="Т")
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "X"})
    with pytest.raises(IntegrityError):
        OpsGvoSummaryPatch.objects.create(event=ev, patch={})
```

(`OpsSecurityEvent.objects.create` — сверить обязательные поля по `models_event.py`; если create требует больше полей — сеять их литералами.)

- [ ] **Step 2: FAIL → реализация**

```python
class OpsGvoSummaryPatch(TimeStampedModel):
    event = models.OneToOneField(
        OpsSecurityEvent, on_delete=models.CASCADE, related_name="gvo_patch"
    )
    patch = models.JSONField()
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["event_id"]
```

- [ ] **Step 3: makemigrations, PASS.**
- [ ] **Step 4: Commit** `feat(ops-gvo): патч сводки ГВО — один на мероприятие`.

### Task 3: API «Охраняемые лица» (list) + права

**Files:**
- Create: `organization_management/apps/ops/gvo.py` (сервис)
- Modify: `organization_management/apps/ops/api/views.py`, `serializers.py`, `urls.py`
- Test: `organization_management/apps/ops/tests/test_ops_gvo_api.py`

**Interfaces:**
- Consumes: `OpsProtectedPerson` из Task 1; `RequirePermissionMixin` (`apps/operations/api/permissions.py`), permission_map.
- Produces: `GET /api/ops/protected-persons/` → `{"results": [{"id": "1", "name", "callsign", "category", "bio"}]}` (id строкой — сериализатор приводит, чтобы фронт не менять вовсе: `id = serializers.SerializerMethodField()` → `str(obj.id)`).

- [ ] **Step 1: Красные тесты** (сеять персоны напрямую; учётки/права — тем же способом, что в `test_ops_objects_api.py` — открыть его и скопировать хелпер выдачи права):

```python
"""API каталога охраняемых лиц: чтение под event.view, актив-фильтр."""
# фикстуры персон: user_with(["event.view"]), user_with([]) — по образцу
# соседнего test_ops_objects_api.py (не выдумывать свой механизм!)

@pytest.mark.django_db
def test_list_returns_active_only_ordered(client_event_view):
    OpsProtectedPerson.objects.bulk_create([
        OpsProtectedPerson(name="Б", category="OURS"),
        OpsProtectedPerson(name="А", category="FOREIGN"),
        OpsProtectedPerson(name="В", category="OURS", is_active=False),
    ])
    r = client_event_view.get("/api/ops/protected-persons/")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()["results"]]
    assert names == ["А", "Б"]          # ordering + фильтр is_active
    assert isinstance(r.json()["results"][0]["id"], str)  # ID-конвенция

@pytest.mark.django_db
def test_list_denied_without_event_view(client_no_perms):
    assert client_no_perms.get("/api/ops/protected-persons/").status_code == 403

@pytest.mark.django_db
def test_list_denied_anonymous(client):
    assert client.get("/api/ops/protected-persons/").status_code == 403
```

- [ ] **Step 2: FAIL (404) → реализация**: сериализатор + ReadOnly ViewSet `ProtectedPersonViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet)` c `permission_map = {"list": "event.view", "retrieve": "event.view"}`, `queryset = OpsProtectedPerson.objects.filter(is_active=True)`; `router.register("protected-persons", ..., basename="ops-protected-persons")`.
- [ ] **Step 3: PASS. Спектакльная проверка формы list** (грабля `many=False` на классе): если у соседей есть тест схемы — добавить строку на новый путь по их образцу.
- [ ] **Step 4: Commit** `feat(ops-gvo): каталог охраняемых лиц — живой GET под event.view`.

### Task 4: API сводок ГВО: list / patch / reset + аудит

**Files:**
- Modify: `organization_management/apps/ops/gvo.py`, `api/views.py`, `api/serializers.py`, `api/urls.py`
- Test: `organization_management/apps/ops/tests/test_ops_gvo_api.py`

**Interfaces:**
- Consumes: `OpsGvoSummaryPatch`, `OpsSecurityEvent.code`; список разрешённых ключей патча — **скопировать литералом** из `entities/gvo-summary/model/types.ts` фронта (`gvoSectionPatchKeys`: country, persons, groups, arrival, departure, head и т.д. — открыть файл и перенести точный список в `ALLOWED_PATCH_KEYS`).
- Produces: `GET /api/ops/gvo-summaries/` → `{"results": [{"omCode", "patch", "updatedAt"}]}`; `PATCH /api/ops/gvo-summaries/{omCode}/` (merge по ключам верхнего уровня: присланный ключ замещает секцию, отсутствующий не трогается); `POST /api/ops/gvo-summaries/{omCode}/reset/` → удаляет патч.

- [ ] **Step 1: Красные тесты** — happy list/patch/reset; 404 по несуществующему omCode; 400 по неизвестному ключу (`{"weird": 1}`); 403 на PATCH/reset у персоны с только `event.view`; аудит: до PATCH таблица журнала пуста → после PATCH появился НОВЫЙ pk (механизм журнала — как у соседних правок в `apps/ops`; найти по grep «audit» в `security_events.py` и повторить; ассерт по pk, не по счётчику).
- [ ] **Step 2: FAIL → реализация**: ViewSet с `lookup_field="event__code"`, `lookup_url_kwarg="omCode"` (или явные path() — как проще в существующем роутере), `permission_map = {"list": "event.view", "partial_update": "event.manage", "reset": "event.manage"}`; merge: `stored.patch = {**stored.patch, **{k: v for k, v in body.items() if k in ALLOWED_PATCH_KEYS}}`; неизвестный ключ → `ValidationError`.
- [ ] **Step 3: PASS.**
- [ ] **Step 4: Commit** `feat(ops-gvo): сводки ГВО — хранение патчей на бэке (list/patch/reset)`.

### Task 5: Сид каталога лиц

**Files:**
- Create: `organization_management/apps/operations/management/commands/seed_protected_persons.py`
- Test: дописать в `test_ops_gvo_models.py`

- [ ] **Step 1: Красный тест**: `call_command("seed_protected_persons")` дважды → ровно 5 записей (идемпотентность по name), категории 3×OURS + 2×FOREIGN.
- [ ] **Step 2: Реализация** — 5 записей дословно из `mocks/ops/protected-persons-handlers.ts` (Оспанов/Салимова/Ахметов OURS, Miller/Al-Farsi FOREIGN, с их callsign и bio), `update_or_create(name=..., defaults=...)`.
- [ ] **Step 3: PASS → Commit** `feat(ops-gvo): сид каталога охраняемых лиц (5 записей мока)`.

### Task 6: Фронт — live-переключение доменов

**Files:**
- Modify: `lib/ops-env.ts` (домены `gvo`, `protected-persons` + `isOpsGvoLive()`, `isOpsProtectedPersonsLive()` — по образцу соседей)
- Modify: `mocks/ops/browser.ts` (или где собирается список handlers): gvo/persons-handlers регистрировать только когда домен НЕ live
- Modify: `lib/api-gaps.ts` (убрать `GVO_NO_BACKEND`, `PROTECTED_PERSONS_NO_BACKEND` и ветки, их возвращающие)
- Modify: api-клиент лиц (`entities/protected-person` или его hook): `String(id)` на границе (если бэк-ответ уже строковый по Task 3 — приведение тривиально-безопасно, оставить)
- Test: `npm run lint` + существующие unit по этим entities

- [ ] **Step 1:** домены + условная регистрация handlers. ВАЖНО: у мока паттерны с ведущей `*` — не менять; коллизии путей MSW молчаливы, поэтому после правки грепнуть `gvo-summaries|protected-persons` по `mocks/` — каждый путь должен остаться ровно у одного handler-набора.
- [ ] **Step 2:** снять оба NO_BACKEND из `lib/api-gaps.ts`; грепнуть их имена по src — использований остаться не должно.
- [ ] **Step 3:** `npm run lint` зелёный (помнить `varsIgnorePattern`: не оставлять неиспользуемых импортов).
- [ ] **Step 4: Commit** `feat(ops-gvo): фронт — домены gvo/protected-persons с live-переключателем, сняты баннеры NO_BACKEND`.

### Task 7: e2e на моке — зелёные

- [ ] **Step 1:** прогнать существующие e2e сценариев ГВО/лиц (`npx playwright test`— каталог тестов найти грепом `gvo|persons` по `e2e/`); в тестовом окружении домены НЕ live → мок работает как раньше.
- [ ] **Step 2:** результат проверять `grep -E "failed|✘"` по полному логу; упавшее — чинить (вероятные места: условная регистрация handlers).
- [ ] **Step 3: Commit** (если были правки) `test(ops-gvo): e2e мок-сценарии зелёные при доменной регистрации handlers`.

### Task 8: live-smoke на стенде

- [ ] **Step 1:** поднять стенд: Django :8100 (settings `local_postgres`; гасить процессы по PID, не pkill -f), фронт :3106 с live-доменами gvo/persons; `python manage.py migrate && python manage.py seed_protected_persons`.
- [ ] **Step 2:** smoke: под персоной с полными правами — список лиц (5 записей), правка сводки ГВО на карточке ОМ (PATCH уходит на :8100, ответ 200), reset; под персоной только-`event.view` — правка запрещена (диалог/403); аноним — раздел закрыт. Фикстуры нести перехватом/API, не ручной мутацией стенда; помнить: расход соединений Postgres при серии спек — перезапуск Django лечит.
- [ ] **Step 3:** зафиксировать результат в отчёте задачи (скрин/лог сетевых запросов), откатить временные live-флаги если они локальные.
- [ ] **Step 4: Commit** конфиг-правок, если были.

### Task 9: Документация и леджер

**Files:**
- Modify: `obsidian-vault/Personnel-Records/Decisions.md` (два решения: права — существующие коды event.*, новых не заводим, «долг префикса ops.*» закрыт как уже-разрешённый в живом коде; ID — бэк int, строкой на границе сериализатора/клиента)
- Modify: `obsidian-vault/Продукт/Карта-модулей.md` (Реестр ГВО и Охраняемые лица: мок → живой), `obsidian-vault/Продукт/Охранные-мероприятия/{Реестр-ГВО,Охраняемые-лица}.md` (tags mock-backend → live-backend, раздел «Данные и API», updated)
- Modify: `obsidian-vault/Продукт/_backlog-unverified.md` (строку про «формат кодов прав ops.*» закрыть с пометкой-решением; «связь лицо→ОМ только через сводки» — обновить формулировку)
- Modify: `obsidian-vault/Personnel-Records/Changelog.md` (строка с хэшами)

- [ ] **Step 1:** внести все правки; frontmatter `updated: <дата>`.
- [ ] **Step 2:** `graphify update .` НЕ гонять в рамках плана (отдельный chore по практике проекта; зафиксировать напоминание в Changelog-строке).
- [ ] **Step 3: Commit** `docs(vault): ГВО и Охраняемые лица переведены на живой бэк — решения и карта модулей`.
