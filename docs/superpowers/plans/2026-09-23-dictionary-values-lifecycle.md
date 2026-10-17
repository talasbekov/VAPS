# UC-REF-001 «Жизненный цикл записи» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Значение справочника можно заменить преемником, удалить при отсутствии связей или деактивировать с датой при их наличии; связи считаются у всех справочников ОМ и у должностей и званий; всё это аудируется и доступно с экранов справочников.

**Architecture:** Бэкенд: один сборщик связей на справочник (`collect_usage`) поверх одного прохода по JSON событий и нескольких запросов; поля `inactive_since`/`supersedes` (и `is_active` у кадровых); операции `supersede_entry`/`remove_entry` в сервисе ОМ и зеркальный модуль `apps/dictionaries/lifecycle.py` для Position/Rank; новые коды ошибок и аудита. Фронт: типы и хуки, диалоги замены и удаления, бейджи. Аутентификация, права и kk из подпроекта 1 не меняются.

**Tech Stack:** Django 5.1.15, DRF 3.17.1, pytest-django, PostgreSQL 16 (Docker :5300); Next.js 15.5, React 19, TypeScript, TanStack Query, Radix Dialog, MSW.

**Spec:** `docs/superpowers/specs/2026-09-23-dictionary-values-lifecycle-design.md`

## Global Constraints

- Корень репозитория: `C:\проекты\smart-josparlau-offline-2026-09-19-1144\lan-1144-2026-09-19-final\source`, ветка создаётся от `main`. Bash в Git Bash, POSIX-пути `/c/...`. Пути к страницам содержат `[code]` и `[kind]` — в shell брать в кавычки.
- Бэкенд только через venv `backend/.venv/Scripts/python.exe`. Никаких `pip install`. Перед pytest/manage.py из `backend/`:

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/backend
export PR_DB_HOST=127.0.0.1 PR_DB_PORT=5300 PR_DB_NAME=smart_josparlau PR_DB_USER=smart_josparlau
export PR_DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' ../../.env)"
PY=.venv/Scripts/python.exe
```

- Тесты: `$PY -m pytest <путь> -q`. Любой `manage.py` — с `--settings=organization_management.config.settings.test`.
- Фронт: `cd frontend && ./node_modules/.bin/tsc --noEmit`. `node_modules` установлены; `npm install` не запускать.
- Тестовый помощник: `client_for(username, role_code=None, permission_codes=None, scope_division_id=None) -> (APIClient, User)` из `organization_management.apps.operations.tests.support`. Стиль: pytest-функции, `pytestmark = pytest.mark.django_db`.
- Права: мутации значений (в т.ч. новые `supersede`, `set_active` кадровых) — `dictionary_value.manage`; чтение — `dictionary.view`.
- JSON-ключи ОМ camelCase (`inactiveSince`, `supersedes`, `supersededBy`, `labelKk`), кадровых snake_case (`is_active`, `inactive_since`, `supersedes`, `superseded_by`, `name_kk`).
- Коды ошибок: `DICTIONARY_ENTRY_PROTECTED` 422, `DICTIONARY_ENTRY_SUPERSEDED` 409, `DICTIONARY_ENTRY_INACTIVE` 409 (регистрируются в `error_codes.CODES`, иначе `DomainError` падает с `ValueError`). Аудит: `DICTIONARY_ENTRY_SUPERSEDED` в `ACTIONS`, сущности `position`/`rank` в `ENTITY_TYPES`.
- Защищённые коды: `("EVENT_PARTICIPATION_KINDS","PHYSICAL_SQUAD")`, `("JOURNAL_ENTRY_TYPES","INSTRUCTION")`, `("JOURNAL_ENTRY_TYPES","ORDER")`, `("JOURNAL_ENTRY_TYPES","INCIDENT")`, `("JOURNAL_ENTRY_TYPES","REPLACEMENT")`.
- «Сегодня» для дат — `Clock.today_local()` из `organization_management.apps.operations.clock`.
- Миграции: `operations/0130_dictionary_entry_lifecycle` (после `0129_dictionary_manage_permission_name`), `dictionaries/0005_position_rank_lifecycle` (после `0004_position_rank_name_kk`). После любой миграционной задачи `makemigrations --check --dry-run` → «No changes detected».
- Коммиты: трейлер `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Не коммитить `node_modules`, `.venv`, `.next*`, `.superpowers`.

---

### Task 1: Отложенные мелочи подпроекта 1 на бэкенде

**Files:**
- Modify: `backend/organization_management/apps/ops/dictionaries.py` (`create_entry`, `update_entry`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py` (дополнить), `backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py` (дополнить)

**Interfaces:**
- Produces: `labelKk` длиннее 255 символов → `DomainError("VALIDATION_ERROR", 400)` с `field_errors["labelKk"] = ["Не более 255 символов."]` в `create_entry` и `update_entry`.

- [ ] **Step 1: Красные пробы**

В конец `test_dictionary_values_bilingual.py`:

```python
def test_label_kk_null_is_stored_as_empty_string(api):
    response = api.post(
        ENTRIES, {"code": "NULLKK", "label": "Ноль", "labelKk": None, "description": ""},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == ""


def test_label_kk_longer_than_column_is_a_form_error(api):
    response = api.post(
        ENTRIES,
        {"code": "LONGKK", "label": "Длинно", "labelKk": "ә" * 300, "description": ""},
        format="json",
    )
    assert response.status_code == 400, response.content
    assert response.json()["details"]["labelKk"] == ["Не более 255 символов."]
    assert not OpsDictionaryEntry.objects.filter(code="LONGKK").exists()
```

В конец `test_dictionary_values_permission.py`:

```python
def test_anonymous_is_refused_on_read_and_write(entry):
    from rest_framework.test import APIClient

    api = APIClient()
    assert api.get(ENTRIES).status_code in (401, 403)
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code in (401, 403), created.content
```

- [ ] **Step 2: Убедиться, что длинная проба красная (500 или не 400)**

Run: `$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q -k "longer or null"`
Expected: `test_label_kk_longer_than_column_is_a_form_error` failed (DataError/500), `null` — passed.

- [ ] **Step 3: Проверка длины в сервисе**

В `create_entry` после блока `if not str(label or "").strip():` добавить:

```python
    if len(str(label_kk or "").strip()) > 255:
        field_errors["labelKk"] = ["Не более 255 символов."]
```

В `update_entry` после блока проверки `label` добавить:

```python
    if label_kk is not UNSET and len(str(label_kk or "").strip()) > 255:
        field_errors["labelKk"] = ["Не более 255 символов."]
```

- [ ] **Step 4: Проверить**

Run: `$PY -m pytest organization_management/apps/ops/tests -q`
Expected: все зелёные (18 прежних + 3 новых).

- [ ] **Step 5: Commit**

```bash
git add backend/organization_management/apps/ops
git commit -m "fix(dictionaries): validate labelKk length, cover anonymous and null cases

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Поля жизненного цикла у OpsDictionaryEntry, коды ошибок и аудита

**Files:**
- Modify: `backend/organization_management/apps/operations/models_settings.py` (класс `OpsDictionaryEntry`, после `is_active`)
- Create: `backend/organization_management/apps/operations/migrations/0130_dictionary_entry_lifecycle.py`
- Modify: `backend/organization_management/apps/operations/error_codes.py` (блок «Настройки и справочники раздела ОМ»)
- Modify: `backend/organization_management/apps/operations/audit_service.py` (константы ~296-301, `ACTIONS` ~389-392, сущности ~427 и ~451)
- Modify: `backend/organization_management/apps/ops/dictionaries.py` (`serialize_entry`, `list_entries`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_lifecycle.py` (новый)

**Interfaces:**
- Produces: `OpsDictionaryEntry.inactive_since: date|None`, `OpsDictionaryEntry.supersedes: FK self|None` (`related_name="superseded_by"`); `serialize_entry` отдаёт `inactiveSince`, `supersedes`, `supersededBy`; `audit_service.DICTIONARY_ENTRY_SUPERSEDED`, `ENTITY_POSITION="position"`, `ENTITY_RANK="rank"`; коды `DICTIONARY_ENTRY_PROTECTED`, `DICTIONARY_ENTRY_SUPERSEDED`, `DICTIONARY_ENTRY_INACTIVE`.

- [ ] **Step 1: Красные пробы**

`backend/organization_management/apps/ops/tests/test_dictionary_lifecycle.py`:

```python
"""Жизненный цикл значения справочника (UC-REF-001, подпроект 2)."""
import datetime

import pytest

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops import dictionaries as service

pytestmark = pytest.mark.django_db


def make(code, dictionary="RETURN_REASONS", **extra):
    return OpsDictionaryEntry.objects.create(
        dictionary_code=dictionary, code=code, label=code.title(),
        description="", is_active=True, **extra,
    )


@pytest.fixture
def api():
    client, _ = client_for(
        "lifecycle-editor", "LIFECYCLE_EDITOR",
        ["dictionary.view", "dictionary_value.manage"],
    )
    return client


def test_serialize_entry_exposes_lifecycle_fields():
    old = make("OLD", inactive_since=datetime.date(2026, 9, 1))
    new = make("NEW", supersedes=old)
    old.is_active = False
    old.save(update_fields=["is_active"])

    rows = {row["code"]: row for row in service.list_entries("RETURN_REASONS")}

    assert rows["OLD"]["inactiveSince"] == "2026-09-01"
    assert rows["OLD"]["supersedes"] is None
    assert rows["OLD"]["supersededBy"] == {"id": str(new.pk), "code": "NEW"}
    assert rows["NEW"]["supersedes"] == {"id": str(old.pk), "code": "OLD"}
    assert rows["NEW"]["supersededBy"] is None
    assert rows["NEW"]["inactiveSince"] is None


def test_new_error_and_audit_codes_are_registered():
    for code, status in (
        ("DICTIONARY_ENTRY_PROTECTED", 422),
        ("DICTIONARY_ENTRY_SUPERSEDED", 409),
        ("DICTIONARY_ENTRY_INACTIVE", 409),
    ):
        DomainError(code, status)  # не бросает ValueError
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in audit_service.ACTIONS
    assert audit_service.ENTITY_POSITION in audit_service.ENTITY_TYPES
    assert audit_service.ENTITY_RANK in audit_service.ENTITY_TYPES
```

- [ ] **Step 2: Убедиться, что пробы красные**

Run: `$PY -m pytest organization_management/apps/ops/tests/test_dictionary_lifecycle.py -q`
Expected: 2 failed (`TypeError: unexpected keyword 'inactive_since'`, `AttributeError`/`ValueError`).

- [ ] **Step 3: Модель**

В `models_settings.py`, в классе `OpsDictionaryEntry` после строки `is_active = models.BooleanField()`:

```python
    # Жизненный цикл значения (UC-REF-001, подпроект 2).
    # Дата неактуальности: ставится при деактивации, снимается при активации.
    inactive_since = models.DateField(null=True, blank=True)
    # Запись-преемник («редактирование по сути» заводит новую запись и
    # закрывает прежнюю). PROTECT, как у OpsIssuedDocument.supersedes: цепь
    # «взамен» рваться не должна.
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True,
        related_name="superseded_by",
    )
```

- [ ] **Step 4: Миграция**

`backend/organization_management/apps/operations/migrations/0130_dictionary_entry_lifecycle.py`:

```python
"""Жизненный цикл значения справочника (UC-REF-001, подпроект 2): дата
неактуальности и ссылка на прежнюю запись при замене."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0129_dictionary_manage_permission_name")]

    operations = [
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="inactive_since",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="supersedes",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="superseded_by",
                to="operations.opsdictionaryentry",
            ),
        ),
    ]
```

- [ ] **Step 5: Коды ошибок и аудита**

В `error_codes.py` после строки `"DICTIONARY_ENTRY_IN_USE": frozenset({409}),`:

```python
    # Системный код (физнаряд, типы журнала штаба) зашит в расчёты: снимать,
    # удалять и заменять его нельзя, только править подпись.
    "DICTIONARY_ENTRY_PROTECTED": frozenset({422}),
    # У значения уже есть преемник: оно история, активировать или удалять
    # его нельзя.
    "DICTIONARY_ENTRY_SUPERSEDED": frozenset({409}),
    # Заменить можно только активное значение.
    "DICTIONARY_ENTRY_INACTIVE": frozenset({409}),
```

В `audit_service.py` после строки `DICTIONARY_ENTRY_UPDATED = "DICTIONARY_ENTRY_UPDATED"`:

```python
# Замена значения преемником (UC-REF-001): прежняя запись закрыта, новая
# ссылается на неё. Пишется на ПРЕЖНЮЮ запись; у преемника — CREATED.
DICTIONARY_ENTRY_SUPERSEDED = "DICTIONARY_ENTRY_SUPERSEDED"
```

В `ACTIONS` после `DICTIONARY_ENTRY_UPDATED,` добавить `DICTIONARY_ENTRY_SUPERSEDED,`.

После `ENTITY_DICTIONARY_ENTRY = "dictionary_entry"`:

```python
# Кадровые справочники (UC-REF-001): у них свои таблицы и свои id, поэтому
# свои сущности, а не dictionary_entry, иначе id столкнутся.
ENTITY_POSITION = "position"
ENTITY_RANK = "rank"
```

В `ENTITY_TYPES` после `ENTITY_DICTIONARY_ENTRY,` добавить `ENTITY_POSITION,` и `ENTITY_RANK,`.

- [ ] **Step 6: Сериализация и список**

В `apps/ops/dictionaries.py` `serialize_entry` после строки `"usage": usage_of(entry),` добавить:

```python
        "inactiveSince": (
            entry.inactive_since.isoformat() if entry.inactive_since else None
        ),
        "supersedes": (
            {"id": str(entry.supersedes_id), "code": entry.supersedes.code}
            if entry.supersedes_id else None
        ),
        "supersededBy": _successor_of(entry),
```

Перед `serialize_entry` добавить:

```python
def _successor_of(entry):
    """Преемник записи, если есть. `superseded_by` — обратная связь; список
    предзагружает её, чтобы не ходить в базу на каждую строку."""
    successor = next(iter(entry.superseded_by.all()), None)
    if successor is None:
        return None
    return {"id": str(successor.pk), "code": successor.code}
```

В `list_entries` заменить запрос на:

```python
    entries = list(
        OpsDictionaryEntry.objects.filter(dictionary_code=dictionary_code)
        .select_related("supersedes")
        .prefetch_related("superseded_by")
    )
```

- [ ] **Step 7: Проверить**

Run: `$PY manage.py makemigrations --check --dry-run --settings=organization_management.config.settings.test` → `No changes detected`.
Run: `$PY -m pytest organization_management/apps/ops/tests -q` → все зелёные.

- [ ] **Step 8: Commit**

```bash
git add backend/organization_management/apps/operations/models_settings.py backend/organization_management/apps/operations/migrations/0130_dictionary_entry_lifecycle.py backend/organization_management/apps/operations/error_codes.py backend/organization_management/apps/operations/audit_service.py backend/organization_management/apps/ops/dictionaries.py backend/organization_management/apps/ops/tests/test_dictionary_lifecycle.py
git commit -m "feat(dictionaries): inactive_since and supersedes on OM entries, lifecycle codes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Сборщик связей для всех справочников ОМ

**Files:**
- Modify: `backend/organization_management/apps/ops/dictionaries.py` (заменить `usage_of`, `_NOT_TRACKED_REASON`; дополнить `serialize_entry`/`list_entries`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_lifecycle.py` (дополнить)

**Interfaces:**
- Produces: `collect_usage(dictionary_code) -> dict[str, list[dict]]` (код → список `{"sourceLabel","count","samples"}`); `usage_of(entry, collected=None) -> {"status","reason","references","totalCount"}`; `serialize_entry(entry, *, owners=None, own_ids=None, usage=None)`; `list_entries` считает карту один раз.

- [ ] **Step 1: Красные пробы (по одному источнику на справочник)**

В конец `test_dictionary_lifecycle.py`:

```python
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus, OpsStatusParticipation,
)


def event(**overrides):
    """Минимальное событие: обязательные JSON-поля пустые, остальное из overrides.
    Если у OpsSecurityEvent есть другие обязательные поля без default, дополни
    их здесь (прочитай models_event.py:71-260) — проба не должна лечиться
    подменой сборщика."""
    base = dict(
        code=overrides.pop("code", "OM-USAGE"), title="Проба связей",
        recon_sector_posts=[], force_requests=[], force_allocation=[],
        placement_assignments=[], journal_entries=[],
    )
    base.update(overrides)
    return OpsSecurityEvent.objects.create(**base)


def refs(entry):
    return {ref["sourceLabel"]: ref["count"] for ref in service.usage_of(entry)["references"]}


def test_journal_entry_types_count_journals():
    entry = make("BRIEFING", "JOURNAL_ENTRY_TYPES")
    event(journal_entries=[{"type": "BRIEFING", "title": "Инструктаж утром"},
                           {"type": "OTHER", "title": "Не считается"}])
    usage = service.usage_of(entry)
    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 1
    assert usage["references"][0]["samples"] == ["OM-USAGE: Инструктаж утром"]


def test_placement_roles_and_sections_count_assignments():
    role = make("SENIOR", "PLACEMENT_ROLES")
    section = make("GATE", "PLACEMENT_SECTIONS")
    event(placement_assignments=[{"roleCode": "SENIOR", "sectionCode": "GATE"},
                                 {"roleCode": "SENIOR", "sectionCode": "OTHER"}])
    assert service.usage_of(role)["totalCount"] == 2
    assert service.usage_of(section)["totalCount"] == 1


def test_participation_kinds_count_json_and_rows():
    kind = make("GROUP_A", "EVENT_PARTICIPATION_KINDS")
    ev = event(
        recon_sector_posts=[{"demandKindCode": "GROUP_A"}],
        force_requests=[{"groupDemands": [{"kindCode": "GROUP_A"}],
                         "groupOffers": [{"kindCode": "GROUP_A"}]}],
        force_allocation=[{"members": [{"kindCode": "GROUP_A", "roleCode": "LEAD"}]}],
    )
    counts = refs(kind)
    assert counts["Расчёт постов ОМ"] == 1
    assert counts["Запросы сил ОМ"] == 2
    assert counts["Выделение сил ОМ"] == 1
    assert service.usage_of(kind)["totalCount"] == 4


def test_group_roles_count_allocation_members_and_children_link_parent():
    kind = make("GROUP_B", "EVENT_PARTICIPATION_KINDS")
    role = make("LEAD_B", "EVENT_GROUP_ROLES", group_code="GROUP_B")
    event(force_allocation=[{"members": [{"kindCode": "GROUP_B", "roleCode": "LEAD_B"}]}])
    assert refs(role)["Выделение сил ОМ"] == 1
    assert refs(kind)["Роли внутри группы"] == 1


def test_post_requirement_groups_count_children():
    group = make("ACCESS", "POST_REQUIREMENT_GROUPS")
    make("ACCESS_A", "POST_REQUIREMENTS", group_code="ACCESS")
    assert refs(group) == {"Требования к постам": 1}


@pytest.mark.parametrize("dictionary", ["RETURN_REASONS", "POST_REQUIREMENTS", "SEASONAL_CORRECTIONS"])
def test_free_text_dictionaries_are_tracked_with_zero_references(dictionary):
    entry = make("FREE", dictionary)
    usage = service.usage_of(entry)
    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 0
    assert usage["references"] == []
    assert "не хранится" in usage["reason"]


def test_list_entries_uses_one_collection_per_dictionary(django_assert_max_num_queries):
    for index in range(5):
        make(f"R{index}", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "R1", "sectionCode": ""}])
    with django_assert_max_num_queries(6):
        rows = service.list_entries("PLACEMENT_ROLES")
    assert {row["code"]: row["usage"]["totalCount"] for row in rows}["R1"] == 1
```

Проба участий по строкам БД: если `OpsEmployeeStatus` создаётся без сложных обязательных полей, добавь также:

```python
def test_participation_rows_are_counted():
    kind = make("GROUP_C", "EVENT_PARTICIPATION_KINDS")
    role = make("LEAD_C", "EVENT_GROUP_ROLES", group_code="GROUP_C")
    ev = event(code="OM-ROWS")
    status = OpsEmployeeStatus.objects.create(**MINIMAL_STATUS_FIELDS)  # см. models_status.py
    OpsStatusParticipation.objects.create(status=status, event_id=ev.pk, kind_code="GROUP_C", role_code="LEAD_C")
    assert refs(kind)["Участия в мероприятиях"] == 1
    assert refs(role)["Участия в мероприятиях"] == 1
```

где `MINIMAL_STATUS_FIELDS` — словарь обязательных полей `OpsEmployeeStatus` (прочитай модель; если создание статуса требует больше десятка связанных объектов, оставь эту пробу закомментированной с пояснением и доложи в отчёте).

- [ ] **Step 2: Убедиться, что пробы красные**

Run: `$PY -m pytest organization_management/apps/ops/tests/test_dictionary_lifecycle.py -q`
Expected: новые пробы красные (у placement/participation/free-text `NOT_TRACKED` либо неверные счётчики).

- [ ] **Step 3: Сборщик**

В `apps/ops/dictionaries.py` заменить блок `_NOT_TRACKED_REASON = {...}` на:

```python
#: Справочники, чей код в деловых данных не хранится вовсе (свободный текст).
#: Связей у них нет по построению, и это не «не отслеживается», а «нечего
#: отслеживать»: удалять такие значения безопасно.
_FREE_TEXT_REASON = {
    "RETURN_REASONS": (
        "Возврат расстановки хранит свободный комментарий, код причины в "
        "данных не хранится — связей быть не может."
    ),
    "POST_REQUIREMENTS": (
        "Паспорт объекта и расчёт ОМ хранят требования строкой, код в данных "
        "не хранится — связей быть не может."
    ),
    "SEASONAL_CORRECTIONS": (
        "Поправки не читает ни один расчёт, код в данных не хранится — связей "
        "быть не может."
    ),
}

#: Системные коды, зашитые в расчёты раздела (бакетирование расхода, журнал
#: штаба): снимать, удалять и заменять их нельзя.
PROTECTED_CODES = frozenset({
    ("EVENT_PARTICIPATION_KINDS", "PHYSICAL_SQUAD"),
    ("JOURNAL_ENTRY_TYPES", "INSTRUCTION"),
    ("JOURNAL_ENTRY_TYPES", "ORDER"),
    ("JOURNAL_ENTRY_TYPES", "INCIDENT"),
    ("JOURNAL_ENTRY_TYPES", "REPLACEMENT"),
})
```

Заменить функцию `usage_of` целиком на:

```python
def _json_values(node, key):
    """Все значения ключа `key` в произвольно вложенном JSON."""
    if isinstance(node, dict):
        for name, value in node.items():
            if name == key and isinstance(value, str) and value:
                yield value
            else:
                yield from _json_values(value, key)
    elif isinstance(node, list):
        for item in node:
            yield from _json_values(item, key)


class _Carriers:
    """Накопитель связей: код → источник → носители."""

    def __init__(self):
        self._rows = {}

    def add(self, code, source, sample):
        if not code:
            return
        self._rows.setdefault(code, {}).setdefault(source, []).append(sample)

    def as_references(self):
        return {
            code: [
                {"sourceLabel": source, "count": len(samples), "samples": samples[:3]}
                for source, samples in sources.items()
            ]
            for code, sources in self._rows.items()
        }


def _event_scan(dictionary_code, carriers):
    """Один проход по JSON событий — для всех кодов сразу."""
    fields = (
        "code", "journal_entries", "placement_assignments",
        "recon_sector_posts", "force_requests", "force_allocation",
    )
    for code, journals, placements, recon, requests, allocation in (
        OpsSecurityEvent.objects.values_list(*fields)
    ):
        if dictionary_code == "JOURNAL_ENTRY_TYPES":
            for journal in journals or []:
                if isinstance(journal, dict) and journal.get("type"):
                    label = _JOURNAL_TYPE_LABEL.get(journal["type"], journal["type"])
                    carriers.add(journal["type"], f"Журналы ОМ ({label})",
                                 f"{code}: {journal.get('title')}")
        elif dictionary_code == "PLACEMENT_ROLES":
            for value in _json_values(placements, "roleCode"):
                carriers.add(value, "Расстановка ОМ", code)
        elif dictionary_code == "PLACEMENT_SECTIONS":
            for value in _json_values(placements, "sectionCode"):
                carriers.add(value, "Расстановка ОМ", code)
        elif dictionary_code == _PARTICIPATION_DICTIONARY:
            for value in _json_values(recon, "demandKindCode"):
                carriers.add(value, "Расчёт постов ОМ", code)
            for value in _json_values(requests, "kindCode"):
                carriers.add(value, "Запросы сил ОМ", code)
            for value in _json_values(allocation, "kindCode"):
                carriers.add(value, "Выделение сил ОМ", code)
        elif dictionary_code == "EVENT_GROUP_ROLES":
            for value in _json_values(allocation, "roleCode"):
                carriers.add(value, "Выделение сил ОМ", code)


def collect_usage(dictionary_code):
    """Связи всех значений справочника одним заходом: код → ссылки."""
    carriers = _Carriers()
    child_code = next(
        (child for child, parent in GROUP_PARENT.items() if parent == dictionary_code),
        None,
    )
    if child_code is not None:
        for group_code, label in OpsDictionaryEntry.objects.filter(
            dictionary_code=child_code, group_code__isnull=False
        ).values_list("group_code", "label"):
            carriers.add(group_code, _CHILD_LABEL.get(child_code, child_code), label)
    if dictionary_code in (
        "JOURNAL_ENTRY_TYPES", "PLACEMENT_ROLES", "PLACEMENT_SECTIONS",
        _PARTICIPATION_DICTIONARY, "EVENT_GROUP_ROLES",
    ):
        _event_scan(dictionary_code, carriers)
    if dictionary_code == _PARTICIPATION_DICTIONARY:
        from organization_management.apps.operations.models_forces import (
            OpsForceCampaignAssignment, OpsForceCampaignPoolMember,
        )
        from organization_management.apps.operations.models_status import OpsStatusParticipation

        for kind, event_id, status_id in OpsStatusParticipation.objects.values_list(
            "kind_code", "event_id", "status_id"
        ):
            carriers.add(kind, "Участия в мероприятиях", f"ОМ {event_id}, статус {status_id}")
        for kind, event_id in OpsForceCampaignAssignment.objects.values_list("kind_code", "event_id"):
            carriers.add(kind, "Назначения из общего пула", f"ОМ {event_id}")
        for kind, name in OpsForceCampaignPoolMember.objects.filter(
            removed_at__isnull=True
        ).values_list("kind_code", "employee_name"):
            carriers.add(kind, "Общий пул сил", name or "сотрудник")
    if dictionary_code == "EVENT_GROUP_ROLES":
        from organization_management.apps.operations.models_status import OpsStatusParticipation

        for role, event_id, status_id in OpsStatusParticipation.objects.exclude(
            role_code=""
        ).values_list("role_code", "event_id", "status_id"):
            carriers.add(role, "Участия в мероприятиях", f"ОМ {event_id}, статус {status_id}")
    return carriers.as_references()


def usage_of(entry, collected=None):
    """Связи одного значения. `collected` — готовая карта `collect_usage`,
    чтобы список не собирал её заново на каждую строку."""
    try:
        references = (
            collected if collected is not None
            else collect_usage(entry.dictionary_code)
        ).get(entry.code, [])
    except Exception:
        logger.exception("Связи справочника %s посчитать не удалось", entry.dictionary_code)
        return {
            "status": "UNKNOWN",
            "reason": "Связи посчитать не удалось — удаление запрещено, используйте деактивацию.",
            "references": [], "totalCount": 0,
        }
    return {
        "status": "TRACKED",
        "reason": _FREE_TEXT_REASON.get(entry.dictionary_code),
        "references": references,
        "totalCount": sum(ref["count"] for ref in references),
    }
```

Если в модуле нет `logger`, добавить после импортов `import logging` и `logger = logging.getLogger(__name__)`.

`serialize_entry`: сигнатура `def serialize_entry(entry, *, owners=None, own_ids=None, usage=None):` и `"usage": usage if usage is not None else usage_of(entry),`.

`list_entries`: перед return добавить `collected = collect_usage(dictionary_code)` и передавать `usage=usage_of(entry, collected=collected)` в `serialize_entry`.

- [ ] **Step 4: Проверить**

Run: `$PY -m pytest organization_management/apps/ops/tests -q` → все зелёные. Если `django_assert_max_num_queries(6)` падает, подними до фактического числа запросов `collect_usage` + 2 и поясни в отчёте.

- [ ] **Step 5: Commit**

```bash
git add backend/organization_management/apps/ops
git commit -m "feat(dictionaries): usage collector for every OM dictionary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Операции сервиса и API значений ОМ

**Files:**
- Modify: `backend/organization_management/apps/ops/dictionaries.py` (`create_entry`, `set_entry_active`, новые `supersede_entry`, `remove_entry`, `delete_entry` как обёртка)
- Modify: `backend/organization_management/apps/ops/api/views.py` (`OpsDictionariesViewSet`: `permission_map`, `delete_entry` DELETE-ветка, новое действие `supersede_entry`)
- Modify: `backend/organization_management/apps/operations/admin_dictionaries.py` (`delete_model` без изменений; убедиться, что зовёт `delete_entry`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_lifecycle.py` (дополнить)

**Interfaces:**
- Produces: `supersede_entry(entry_id, *, code, label, label_kk="", description, group_code, owner_division_id=None, actor) -> OpsDictionaryEntry`; `remove_entry(entry_id, *, actor, deactivate_when_used=True) -> tuple[str, OpsDictionaryEntry|None]`; `delete_entry(entry_id, *, actor)` (только удаление, иначе 409 как раньше); `set_entry_active` с датами и отказами; HTTP: `DELETE .../entries/<id>/` → 204 или 200 `{"result":"deactivated","entry":{...}}`; `POST .../entries/<id>/supersede/` → 201 с преемником.

- [ ] **Step 1: Красные пробы**

В конец `test_dictionary_lifecycle.py`:

```python
def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


def test_deactivation_sets_and_activation_clears_inactive_since(api):
    entry = make("DATES")
    off = api.post(entry_url(entry) + "set-active/", {"isActive": False}, format="json")
    assert off.status_code == 200, off.content
    assert off.json()["inactiveSince"] == service.Clock.today_local().isoformat()
    on = api.post(entry_url(entry) + "set-active/", {"isActive": True}, format="json")
    assert on.status_code == 200, on.content
    assert on.json()["inactiveSince"] is None


def test_remove_without_references_deletes(api):
    entry = make("GONE")
    response = api.delete(entry_url(entry))
    assert response.status_code == 204, response.content
    assert not OpsDictionaryEntry.objects.filter(pk=entry.pk).exists()


def test_remove_with_references_deactivates_instead(api):
    role = make("BUSY", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "BUSY", "sectionCode": ""}])
    response = api.delete(entry_url(role))
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["result"] == "deactivated"
    assert body["entry"]["isActive"] is False
    assert body["entry"]["inactiveSince"] == service.Clock.today_local().isoformat()
    role.refresh_from_db()
    assert role.is_active is False


def test_protected_code_cannot_be_removed_deactivated_or_superseded(api):
    squad = make("PHYSICAL_SQUAD", "EVENT_PARTICIPATION_KINDS")
    assert api.delete(entry_url(squad)).status_code == 422
    off = api.post(entry_url(squad) + "set-active/", {"isActive": False}, format="json")
    assert off.status_code == 422, off.content
    replaced = api.post(entry_url(squad) + "supersede/",
                        {"code": "SQUAD2", "label": "Наряд", "description": ""}, format="json")
    assert replaced.status_code == 422, replaced.content
    assert replaced.json()["error_code"] == "DICTIONARY_ENTRY_PROTECTED"


def test_supersede_creates_successor_and_closes_predecessor(api, monkeypatch):
    old = make("WEATHER")
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))

    response = api.post(
        entry_url(old) + "supersede/",
        {"code": "weather2", "label": "Погодные условия", "labelKk": "Ауа райы",
         "description": "уточнено"},
        format="json",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["code"] == "WEATHER2"
    assert body["supersedes"] == {"id": str(old.pk), "code": "WEATHER"}
    assert body["isActive"] is True
    old.refresh_from_db()
    assert old.is_active is False
    assert old.inactive_since == service.Clock.today_local()
    assert old.superseded_by.get().code == "WEATHER2"
    actions = [item["action"] for item in recorded]
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in actions
    assert audit_service.DICTIONARY_ENTRY_CREATED in actions
    superseded = next(item for item in recorded if item["action"] == audit_service.DICTIONARY_ENTRY_SUPERSEDED)
    assert superseded["entity_id"] == old.pk
    assert superseded["new_value"]["successorCode"] == "WEATHER2"


def test_supersede_rejects_inactive_duplicate_and_reactivation(api):
    old = make("OLDONE")
    first = api.post(entry_url(old) + "supersede/", {"code": "NEWONE", "label": "Новое", "description": ""}, format="json")
    assert first.status_code == 201, first.content
    again = api.post(entry_url(old) + "supersede/", {"code": "NEWTWO", "label": "Ещё", "description": ""}, format="json")
    assert again.status_code == 409 and again.json()["error_code"] == "DICTIONARY_ENTRY_INACTIVE"
    dup = api.post(entry_url(OpsDictionaryEntry.objects.get(code="NEWONE")) + "supersede/",
                   {"code": "OLDONE", "label": "Дубль", "description": ""}, format="json")
    assert dup.status_code == 400, dup.content
    back = api.post(entry_url(old) + "set-active/", {"isActive": True}, format="json")
    assert back.status_code == 409 and back.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"
    gone = api.delete(entry_url(old))
    assert gone.status_code == 409 and gone.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"


def test_supersede_requires_value_permission():
    api, _ = client_for("lifecycle-manage-only", "LIFECYCLE_MANAGE_ONLY", ["dictionary.view", "dictionary.manage"])
    old = make("NOPERM")
    response = api.post(entry_url(old) + "supersede/", {"code": "NOPERM2", "label": "x", "description": ""}, format="json")
    assert response.status_code == 403


def test_admin_delete_entry_still_refuses_when_used():
    role = make("ADMINBUSY", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "ADMINBUSY", "sectionCode": ""}])
    with pytest.raises(DomainError) as failure:
        service.delete_entry(role.pk, actor="admin")
    assert failure.value.code == "DICTIONARY_ENTRY_IN_USE"
    role.refresh_from_db()
    assert role.is_active is True
```

В шапку файла добавить `from organization_management.apps.operations.clock import Clock` и в модуле сервиса он должен быть импортирован как `Clock` (проба обращается к `service.Clock`).

- [ ] **Step 2: Убедиться, что пробы красные**

Run: `$PY -m pytest organization_management/apps/ops/tests/test_dictionary_lifecycle.py -q -k "remove or supersede or protected or inactive_since or admin_delete"`
Expected: все красные (404 на supersede, 409/422 на delete, нет дат).

- [ ] **Step 3: Сервис**

В `apps/ops/dictionaries.py` добавить импорт `from organization_management.apps.operations.clock import Clock`.

`create_entry`: сигнатура получает `supersedes=None` (после `owner_division_id=None`); в `objects.create(...)` добавить `supersedes=supersedes,`; в `new_value` события CREATED добавить `"supersedes": supersedes.code if supersedes is not None else None,`.

Добавить перед `set_entry_active`:

```python
def _require_unprotected(entry):
    if (entry.dictionary_code, entry.code) in PROTECTED_CODES:
        raise DomainError(
            "DICTIONARY_ENTRY_PROTECTED", 422,
            detail={"code": entry.code},
            message="Системное значение: его нельзя снять, удалить или заменить, только исправить подпись.",
        )


def _has_successor(entry):
    return entry.superseded_by.exists()
```

Заменить `set_entry_active`:

```python
@transaction.atomic
def set_entry_active(entry_id, *, is_active, actor, reason=""):
    entry = _lock_entry(entry_id)
    wanted = is_active is True
    if not wanted:
        _require_unprotected(entry)
    elif _has_successor(entry):
        raise DomainError(
            "DICTIONARY_ENTRY_SUPERSEDED", 409,
            detail={"code": entry.code},
            message="У значения есть преемник — прежнее остаётся историей и не активируется.",
        )
    old = {"isActive": entry.is_active,
           "inactiveSince": entry.inactive_since.isoformat() if entry.inactive_since else None}
    entry.is_active = wanted
    if wanted:
        entry.inactive_since = None
    elif entry.inactive_since is None:
        entry.inactive_since = Clock.today_local()
    entry.updated_by = actor
    entry.save(update_fields=["is_active", "inactive_since", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_SET_ACTIVE,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value=old,
        new_value={"isActive": entry.is_active,
                   "inactiveSince": entry.inactive_since.isoformat() if entry.inactive_since else None},
        reason=reason,
    )
    return entry
```

Добавить после него:

```python
@transaction.atomic
def supersede_entry(entry_id, *, code, label, label_kk="", description, group_code,
                    owner_division_id=None, actor):
    """«Редактирование по сути»: новая запись взамен прежней.

    Прежняя закрывается для нового выбора (is_active=False, дата
    неактуальности), но остаётся в старых данных: на неё ссылаются по коду.
    """
    old = _lock_entry(entry_id)
    _require_unprotected(old)
    if not old.is_active:
        raise DomainError(
            "DICTIONARY_ENTRY_INACTIVE", 409,
            detail={"code": old.code},
            message="Заменить можно только активное значение.",
        )
    successor = create_entry(
        old.dictionary_code, code=code, label=label, label_kk=label_kk,
        description=description, group_code=group_code,
        owner_division_id=owner_division_id, actor=actor, supersedes=old,
    )
    old.is_active = False
    old.inactive_since = Clock.today_local()
    old.updated_by = actor
    old.save(update_fields=["is_active", "inactive_since", "updated_by", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_SUPERSEDED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=old.pk,
        old_value={"code": old.code, "label": old.label, "isActive": True},
        new_value={"successorId": successor.pk, "successorCode": successor.code,
                   "inactiveSince": old.inactive_since.isoformat()},
    )
    return successor


@transaction.atomic
def remove_entry(entry_id, *, actor, deactivate_when_used=True):
    """Удаление по правилу UC-REF-001: нет связей — физически, есть —
    деактивация с датой. Возвращает ("deleted", None) или ("deactivated", entry)."""
    entry = _lock_entry(entry_id)
    _require_unprotected(entry)
    if _has_successor(entry):
        raise DomainError(
            "DICTIONARY_ENTRY_SUPERSEDED", 409,
            detail={"code": entry.code},
            message="У значения есть преемник — прежнее остаётся историей и не удаляется.",
        )
    usage = usage_of(entry)
    if usage["status"] != "TRACKED":
        raise DomainError(
            "DICTIONARY_USAGE_UNKNOWN", 422,
            message=usage["reason"] or "Связи посчитать не удалось — удаление запрещено.",
        )
    if usage["totalCount"] > 0:
        joined = "; ".join(
            f"{ref['sourceLabel']} — {', '.join(ref['samples'])}"
            for ref in usage["references"]
        )
        if not deactivate_when_used:
            raise DomainError(
                "DICTIONARY_ENTRY_IN_USE", 409,
                detail={"usage": usage},
                message=f"Значение используется ({usage['totalCount']}): {joined}.",
            )
        if entry.is_active:
            entry = set_entry_active(
                entry.pk, is_active=False, actor=actor,
                reason=f"удаление при наличии связей ({usage['totalCount']}): {joined}",
            )
        return "deactivated", entry
    audit_service.record(
        actor=actor,
        action=audit_service.DICTIONARY_ENTRY_DELETED,
        entity_type=audit_service.ENTITY_DICTIONARY_ENTRY,
        entity_id=entry.pk,
        old_value={"dictionary": entry.dictionary_code, "code": entry.code, "label": entry.label},
    )
    entry.delete()
    return "deleted", None


def delete_entry(entry_id, *, actor):
    """Только физическое удаление (админка Django): со связями — 409, как раньше."""
    remove_entry(entry_id, actor=actor, deactivate_when_used=False)
```

Старое тело `delete_entry` удалить.

- [ ] **Step 4: Viewset**

В `apps/ops/api/views.py`, `OpsDictionariesViewSet.permission_map` добавить `"supersede_entry": "dictionary_value.manage",`.

В действии `delete_entry` ветку DELETE (после `if request.method.upper() == "PATCH": ...`) заменить на:

```python
        result, entry = dict_service.remove_entry(
            entry_id, actor=resolve_actor_id(request)
        )
        if result == "deleted":
            return Response(status=204)
        rows = dict_service.list_entries(
            entry.dictionary_code, actor_id=resolve_actor_id(request)
        )
        return Response({
            "result": "deactivated",
            "entry": next(row for row in rows if row["id"] == str(entry.pk)),
        })
```

Обновить докстринг `delete_entry`: «DELETE удаляет значение без связей и деактивирует значение со связями (UC-REF-001)».

Добавить после `delete_entry`:

```python
    @action(
        detail=False,
        methods=["post"],
        url_path=r"entries/(?P<entry_id>[^/]+)/supersede",
    )
    def supersede_entry(self, request, entry_id=None):
        """Запись-преемник взамен прежней (UC-REF-001, «Редактирование»)."""
        data = request.data or {}
        entry = dict_service.supersede_entry(
            entry_id,
            code=data.get("code"),
            label=data.get("label"),
            label_kk=data.get("labelKk", ""),
            description=data.get("description"),
            group_code=data.get("groupCode"),
            owner_division_id=data.get("ownerDivisionId"),
            actor=resolve_actor_id(request),
        )
        rows = dict_service.list_entries(
            entry.dictionary_code, actor_id=resolve_actor_id(request)
        )
        return Response(
            next(row for row in rows if row["id"] == str(entry.pk)), status=201
        )
```

- [ ] **Step 5: Проверить**

Run: `$PY -m pytest organization_management/apps/ops/tests -q` → все зелёные, включая старую пробу `test_value_permission_allows_every_entry_mutation` (DELETE без связей по-прежнему 204).

- [ ] **Step 6: Commit**

```bash
git add backend/organization_management/apps/ops backend/organization_management/apps/operations/admin_dictionaries.py
git commit -m "feat(dictionaries): supersede and remove-by-references for OM entries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Кадровые справочники: модель, жизненный цикл, API, аудит

**Files:**
- Modify: `backend/organization_management/apps/dictionaries/models.py` (`Position`, `Rank`)
- Create: `backend/organization_management/apps/dictionaries/migrations/0005_position_rank_lifecycle.py`
- Create: `backend/organization_management/apps/dictionaries/lifecycle.py`
- Modify: `backend/organization_management/apps/dictionaries/api/serializers.py`, `backend/organization_management/apps/dictionaries/api/views.py`
- Modify: `backend/organization_management/apps/staff_unit/serializers.py` (`position` queryset), `backend/organization_management/apps/employees/api/serializers.py` (`rank`)
- Create: `backend/organization_management/apps/dictionaries/tests/__init__.py`, `backend/organization_management/apps/dictionaries/tests/test_lifecycle.py`

**Interfaces:**
- Produces: поля `is_active`, `inactive_since`, `supersedes` у Position/Rank; `lifecycle.usage_of(instance)`, `lifecycle.set_active(instance, *, is_active, actor)`, `lifecycle.supersede(instance, *, data, actor)`, `lifecycle.remove(instance, *, actor) -> (str, instance|None)`; API `POST /api/dictionaries/positions/<id>/set-active/` `{"is_active": bool}`, `POST .../<id>/supersede/`, `DELETE` 204 или 200 `{"result":"deactivated","row":{...}}`; сериализаторы отдают `is_active`, `inactive_since`, `supersedes`, `superseded_by`, `usage`.

- [ ] **Step 1: Красные пробы**

`backend/organization_management/apps/dictionaries/tests/__init__.py` — пустой.

`backend/organization_management/apps/dictionaries/tests/test_lifecycle.py`:

```python
"""Жизненный цикл должностей и званий (UC-REF-001, подпроект 2)."""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

POSITIONS = "/api/dictionaries/positions/"
RANKS = "/api/dictionaries/ranks/"


@pytest.fixture
def api():
    client, _ = client_for("staff-lifecycle", "STAFF_LIFECYCLE", ["dictionary.view", "dictionary_value.manage"])
    return client


def position(code="P1", **extra):
    return Position.objects.create(name=code, code=code, level=10, **extra)


def staff_unit_for(pos):
    """Одна штатная единица на должность. Прочитай StaffUnit (apps/staff_unit/models.py)
    и дополни обязательные поля здесь, если create() их требует."""
    division = Division.objects.create(
        name="Проба", code="DIV-LIFE", division_type=Division.DivisionType.ORGANIZATION,
    )
    return StaffUnit.objects.create(division=division, position=pos)


def test_rows_expose_lifecycle_fields_and_usage(api):
    pos = position("EXPOSED")
    staff_unit_for(pos)
    response = api.get(f"{POSITIONS}{pos.pk}/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["is_active"] is True
    assert body["inactive_since"] is None
    assert body["supersedes"] is None
    assert body["superseded_by"] is None
    assert body["usage"]["status"] == "TRACKED"
    assert body["usage"]["totalCount"] == 1
    assert body["usage"]["references"][0]["sourceLabel"] == "Штатное расписание"


def test_remove_deletes_unused_and_deactivates_used(api):
    unused = position("UNUSED")
    used = position("USED")
    staff_unit_for(used)
    assert api.delete(f"{POSITIONS}{unused.pk}/").status_code == 204
    assert not Position.objects.filter(pk=unused.pk).exists()
    response = api.delete(f"{POSITIONS}{used.pk}/")
    assert response.status_code == 200, response.content
    assert response.json()["result"] == "deactivated"
    used.refresh_from_db()
    assert used.is_active is False
    assert used.inactive_since == Clock.today_local()


def test_set_active_and_supersede(api, monkeypatch):
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))
    old = position("OLDPOS")
    off = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": False}, format="json")
    assert off.status_code == 200 and off.json()["inactive_since"] == Clock.today_local().isoformat()
    on = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": True}, format="json")
    assert on.status_code == 200 and on.json()["inactive_since"] is None

    replaced = api.post(
        f"{POSITIONS}{old.pk}/supersede/",
        {"name": "Старший инспектор", "name_kk": "Аға инспектор", "code": "NEWPOS", "level": 9},
        format="json",
    )
    assert replaced.status_code == 201, replaced.content
    body = replaced.json()
    assert body["supersedes"] == old.pk
    old.refresh_from_db()
    assert old.is_active is False and old.superseded_by.get().code == "NEWPOS"
    assert api.get(f"{POSITIONS}{old.pk}/").json()["superseded_by"] == body["id"]
    again = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": True}, format="json")
    assert again.status_code == 409 and again.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"
    entities = {item["entity_type"] for item in recorded}
    assert audit_service.ENTITY_POSITION in entities
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in {item["action"] for item in recorded}


def test_rank_lifecycle_mirrors_position(api):
    rank = Rank.objects.create(name="Капитан", code="CPT", level=5)
    replaced = api.post(f"{RANKS}{rank.pk}/supersede/", {"name": "Капитан (нов.)", "code": "CPT2", "level": 5}, format="json")
    assert replaced.status_code == 201, replaced.content
    rank.refresh_from_db()
    assert rank.is_active is False
    gone = api.delete(f"{RANKS}{rank.pk}/")
    assert gone.status_code == 409


def test_create_and_update_are_audited(api, monkeypatch):
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))
    created = api.post(POSITIONS, {"name": "Аудит", "code": "AUD", "level": 50}, format="json")
    assert created.status_code == 201, created.content
    patched = api.patch(f"{POSITIONS}{created.json()['id']}/", {"name": "Аудит-2"}, format="json")
    assert patched.status_code == 200, patched.content
    actions = [item["action"] for item in recorded]
    assert audit_service.DICTIONARY_ENTRY_CREATED in actions
    assert audit_service.DICTIONARY_ENTRY_UPDATED in actions


def test_inactive_position_is_not_selectable_for_new_staff_unit(api):
    inactive = position("INACTIVE", is_active=False)
    from organization_management.apps.staff_unit.serializers import StaffUnitSerializer
    assert not StaffUnitSerializer().fields["position"].queryset.filter(pk=inactive.pk).exists()


def test_mutations_require_value_permission():
    api, _ = client_for("staff-manage-only", "STAFF_MANAGE_ONLY", ["dictionary.view", "dictionary.manage"])
    pos = position("NOPERM")
    assert api.post(f"{POSITIONS}{pos.pk}/set-active/", {"is_active": False}, format="json").status_code == 403
    assert api.post(f"{POSITIONS}{pos.pk}/supersede/", {"name": "x", "code": "NOPERM2", "level": 1}, format="json").status_code == 403
```

- [ ] **Step 2: Убедиться, что пробы красные**

Run: `$PY -m pytest organization_management/apps/dictionaries/tests -q` → красные (нет полей/ручек).

- [ ] **Step 3: Модели и миграция**

В `apps/dictionaries/models.py` в `Position` после поля `level` и в `Rank` после `level` добавить:

```python
    # Жизненный цикл значения (UC-REF-001, подпроект 2): активность, дата
    # неактуальности и ссылка на прежнюю запись при замене.
    is_active = models.BooleanField(default=True, db_index=True)
    inactive_since = models.DateField(null=True, blank=True)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True,
        related_name="superseded_by",
    )
```

`backend/organization_management/apps/dictionaries/migrations/0005_position_rank_lifecycle.py`:

```python
"""Жизненный цикл должностей и званий (UC-REF-001, подпроект 2)."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dictionaries", "0004_position_rank_name_kk")]

    operations = [
        migrations.AddField(model_name="position", name="is_active",
                            field=models.BooleanField(db_index=True, default=True)),
        migrations.AddField(model_name="position", name="inactive_since",
                            field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="position", name="supersedes",
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                                    related_name="superseded_by", to="dictionaries.position")),
        migrations.AddField(model_name="rank", name="is_active",
                            field=models.BooleanField(db_index=True, default=True)),
        migrations.AddField(model_name="rank", name="inactive_since",
                            field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="rank", name="supersedes",
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                                    related_name="superseded_by", to="dictionaries.rank")),
    ]
```

- [ ] **Step 4: Модуль жизненного цикла**

`backend/organization_management/apps/dictionaries/lifecycle.py`:

```python
"""Жизненный цикл кадровых справочников (UC-REF-001, подпроект 2).

Зеркало сервиса значений ОМ (`apps/ops/dictionaries.py`) для должностей и
званий: связи, деактивация с датой, запись-преемник, удаление по связям.
Аудит пишется в общий журнал раздела своими сущностями `position`/`rank`.
"""
from django.db import transaction
from django.db.models import Q

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError

ENTITY_OF = {Position: audit_service.ENTITY_POSITION, Rank: audit_service.ENTITY_RANK}


def _entity(instance):
    return ENTITY_OF[type(instance)]


def _snapshot(instance):
    return {
        "code": instance.code, "name": instance.name, "nameKk": instance.name_kk,
        "level": instance.level, "isActive": instance.is_active,
        "inactiveSince": instance.inactive_since.isoformat() if instance.inactive_since else None,
    }


def usage_of(instance):
    references = []
    if isinstance(instance, Position):
        units = list(instance.staff_units.all()[:1000])
        if units:
            references.append({"sourceLabel": "Штатное расписание", "count": len(units),
                               "samples": [str(unit) for unit in units[:3]]})
        from organization_management.apps.employees.models import EmployeeTransferHistory
        transfers = EmployeeTransferHistory.objects.filter(
            Q(from_position=instance) | Q(to_position=instance)
        )
        count = transfers.count()
        if count:
            references.append({"sourceLabel": "История перемещений", "count": count,
                               "samples": [str(row.employee) for row in transfers[:3]]})
    else:
        employees = instance.employee_set.all()
        count = employees.count()
        if count:
            references.append({"sourceLabel": "Сотрудники", "count": count,
                               "samples": [str(row) for row in employees[:3]]})
    return {"status": "TRACKED", "reason": None, "references": references,
            "totalCount": sum(ref["count"] for ref in references)}


def record_created(instance, *, actor):
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_CREATED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         new_value=_snapshot(instance))


def record_updated(instance, *, actor, old):
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_UPDATED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=old, new_value=_snapshot(instance))


def _has_successor(instance):
    return instance.superseded_by.exists()


@transaction.atomic
def set_active(instance, *, is_active, actor, reason=""):
    wanted = is_active is True
    if wanted and _has_successor(instance):
        raise DomainError("DICTIONARY_ENTRY_SUPERSEDED", 409, detail={"code": instance.code},
                          message="У значения есть преемник — прежнее остаётся историей и не активируется.")
    old = _snapshot(instance)
    instance.is_active = wanted
    if wanted:
        instance.inactive_since = None
    elif instance.inactive_since is None:
        instance.inactive_since = Clock.today_local()
    instance.save(update_fields=["is_active", "inactive_since", "updated_at"])
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_SET_ACTIVE,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=old, new_value=_snapshot(instance), reason=reason)
    return instance


@transaction.atomic
def supersede(instance, *, data, actor):
    """`data` — validated_data сериализатора создания (name, name_kk, code, level)."""
    if not instance.is_active:
        raise DomainError("DICTIONARY_ENTRY_INACTIVE", 409, detail={"code": instance.code},
                          message="Заменить можно только активное значение.")
    successor = type(instance).objects.create(**data, supersedes=instance)
    instance.is_active = False
    instance.inactive_since = Clock.today_local()
    instance.save(update_fields=["is_active", "inactive_since", "updated_at"])
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_SUPERSEDED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value={"code": instance.code, "name": instance.name, "isActive": True},
                         new_value={"successorId": successor.pk, "successorCode": successor.code,
                                    "inactiveSince": instance.inactive_since.isoformat()})
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_CREATED,
                         entity_type=_entity(successor), entity_id=successor.pk,
                         new_value={**_snapshot(successor), "supersedes": instance.code})
    return successor


@transaction.atomic
def remove(instance, *, actor):
    if _has_successor(instance):
        raise DomainError("DICTIONARY_ENTRY_SUPERSEDED", 409, detail={"code": instance.code},
                          message="У значения есть преемник — прежнее остаётся историей и не удаляется.")
    usage = usage_of(instance)
    if usage["totalCount"] > 0:
        joined = "; ".join(f"{ref['sourceLabel']} — {', '.join(ref['samples'])}" for ref in usage["references"])
        if instance.is_active:
            instance = set_active(instance, is_active=False, actor=actor,
                                  reason=f"удаление при наличии связей ({usage['totalCount']}): {joined}")
        return "deactivated", instance
    audit_service.record(actor=actor, action=audit_service.DICTIONARY_ENTRY_DELETED,
                         entity_type=_entity(instance), entity_id=instance.pk,
                         old_value=_snapshot(instance))
    instance.delete()
    return "deleted", None
```

- [ ] **Step 5: Сериализаторы и viewset**

`apps/dictionaries/api/serializers.py` — заменить `PositionSerializer` и `RankSerializer`:

```python
class _LifecycleFields(serializers.ModelSerializer):
    supersedes = serializers.PrimaryKeyRelatedField(read_only=True)
    superseded_by = serializers.SerializerMethodField()
    usage = serializers.SerializerMethodField()

    def get_superseded_by(self, obj) -> int | None:
        successor = obj.superseded_by.first()
        return successor.pk if successor else None

    def get_usage(self, obj) -> dict:
        from organization_management.apps.dictionaries import lifecycle
        return lifecycle.usage_of(obj)


class PositionSerializer(_LifecycleFields):
    """Должность. `code` в полях ОБЯЗАТЕЛЕН (Plane №274). Поля жизненного
    цикла только на чтение: активность меняется действием set-active,
    преемник — действием supersede (UC-REF-001)."""

    class Meta:
        model = Position
        fields = ["id", "name", "name_kk", "code", "level",
                  "is_active", "inactive_since", "supersedes", "superseded_by", "usage"]
        read_only_fields = ["is_active", "inactive_since"]


class RankSerializer(_LifecycleFields):
    class Meta:
        model = Rank
        fields = ["id", "name", "name_kk", "code", "level",
                  "is_active", "inactive_since", "supersedes", "superseded_by", "usage"]
        read_only_fields = ["is_active", "inactive_since"]
```

(`RankSerializer` перестаёт быть `__all__`: `created_at`/`updated_at` из ответа уходят; `EmployeeSerializer.rank_detail` их не использует.)

`apps/dictionaries/api/views.py` — в `_StaffDictionaryViewSet`: `permission_map` дополнить `"set_active": _MANAGE, "supersede": _MANAGE`; `perform_create`/`perform_update`:

```python
    def perform_create(self, serializer):
        instance = serializer.save()
        lifecycle.record_created(instance, actor=resolve_actor_id(self.request))

    def perform_update(self, serializer):
        old = lifecycle._snapshot(serializer.instance)
        instance = serializer.save()
        lifecycle.record_updated(instance, actor=resolve_actor_id(self.request), old=old)
```

`destroy` заменить на:

```python
    def destroy(self, request, *args, **kwargs):
        result, instance = lifecycle.remove(self.get_object(), actor=resolve_actor_id(request))
        if result == "deleted":
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"result": "deactivated", "row": self.get_serializer(instance).data})

    @action(detail=True, methods=["post"], url_path="set-active")
    def set_active(self, request, pk=None):
        instance = lifecycle.set_active(
            self.get_object(), is_active=(request.data or {}).get("is_active"),
            actor=resolve_actor_id(request),
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def supersede(self, request, pk=None):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        successor = lifecycle.supersede(
            self.get_object(), data=serializer.validated_data, actor=resolve_actor_id(request),
        )
        return Response(self.get_serializer(successor).data, status=status.HTTP_201_CREATED)
```

Импорты: `from organization_management.apps.dictionaries import lifecycle`, `from organization_management.apps.operations.api.permissions import RequirePermissionMixin, resolve_actor_id`. Старые `_usage_count`, `usage_related_name`, `usage_label`, `ProtectedError`, `ValidationError` удалить, если больше не используются.

`apps/staff_unit/serializers.py`: `queryset=Position.objects.all()` у поля `position` → `queryset=Position.objects.filter(is_active=True)` с комментарием «неактивная должность закрыта для нового выбора (UC-REF-001); существующие записи с ней остаются».

`apps/employees/api/serializers.py`: в `EmployeeSerializer` добавить поле

```python
    rank = serializers.PrimaryKeyRelatedField(
        queryset=Rank.objects.filter(is_active=True), allow_null=True, required=False,
    )
```

с импортом `Rank`.

- [ ] **Step 6: Проверить**

Run: `$PY manage.py makemigrations --check --dry-run --settings=organization_management.config.settings.test` → `No changes detected`.
Run: `$PY -m pytest organization_management/apps/dictionaries organization_management/apps/ops/tests organization_management/apps/divisions -q` → все зелёные. Если `DomainError` из viewset кадровых отдаёт 500, а не конверт, — проверь `REST_FRAMEWORK["EXCEPTION_HANDLER"]` в `base.py` и, если он не глобальный, добавь в `_StaffDictionaryViewSet` `def handle_exception(self, exc)` с вызовом `ops_exception_handler`.

- [ ] **Step 7: Commit**

```bash
git add backend/organization_management/apps/dictionaries backend/organization_management/apps/staff_unit/serializers.py backend/organization_management/apps/employees/api/serializers.py
git commit -m "feat(dictionaries): lifecycle for positions and ranks with audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Типы, хуки и моки фронта

**Files:**
- Modify: `frontend/entities/dictionary/index.ts`, `frontend/hooks/use-dictionaries.ts`
- Modify: `frontend/entities/staff-dictionary/index.ts`, `frontend/hooks/use-staff-dictionaries.ts`, `frontend/lib/api.ts` (типы `Position`, `Rank`)
- Modify: `frontend/mocks/ops/dictionaries-handlers.ts`

**Interfaces:**
- Produces: `DictionaryEntry.inactiveSince: string | null`, `supersedes: DictionaryEntryRef | null`, `supersededBy: DictionaryEntryRef | null` (`DictionaryEntryRef = {id: string; code: string}`); `SupersedeDictionaryEntryRequest = CreateDictionaryEntryRequest`; `RemoveDictionaryEntryResult`; `dictionaryEntrySupersedePath(id)`; хуки `useSupersedeDictionaryEntry(options)`, `useDeleteDictionaryEntry` → `RemoveDictionaryEntryResult`; `StaffDictionaryRow` с `is_active`, `inactive_since`, `supersedes: number|null`, `superseded_by: number|null`, `usage: DictionaryUsage`; хуки `useSetStaffDictionaryRowActive(kind)`, `useSupersedeStaffDictionaryRow(kind)`, `useDeleteStaffDictionaryRow` → результат; `Position.is_active`, `Rank.is_active`.

- [ ] **Step 1: Типы ОМ**

В `entities/dictionary/index.ts` после интерфейса `DictionaryEntry` (в него добавить три поля после `updatedAt: string;`):

```ts
  /** Дата неактуальности (UC-REF-001): ставится при деактивации. */
  inactiveSince: string | null;
  /** Прежняя запись, которую эта заменила. */
  supersedes: DictionaryEntryRef | null;
  /** Преемник; у записи с преемником активировать и удалять нечего. */
  supersededBy: DictionaryEntryRef | null;
```

и перед `DictionaryEntry`:

```ts
export interface DictionaryEntryRef {
  id: string;
  code: string;
}
```

После `dictionaryEntryPath` добавить:

```ts
/** Замена преемником (UC-REF-001, «Редактирование»). */
export function dictionaryEntrySupersedePath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/supersede/`;
}
```

В конец файла:

```ts
export type SupersedeDictionaryEntryRequest = CreateDictionaryEntryRequest;

/** Ответ DELETE: 204 — удалено; 200 с телом — деактивировано по связям. */
export type RemoveDictionaryEntryResult =
  | { result: "deleted" }
  | { result: "deactivated"; entry: DictionaryEntryView };
```

- [ ] **Step 2: Хуки ОМ**

В `hooks/use-dictionaries.ts` `useDeleteDictionaryEntry` заменить на:

```ts
export function useDeleteDictionaryEntry() {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<RemoveDictionaryEntryResult, { entryId: string }>({
    mutationFn: async ({ entryId }) => {
      const body = await opsApiClient.del<RemoveDictionaryEntryResult | undefined>(
        dictionaryEntryPath(entryId)
      );
      return body ?? { result: "deleted" };
    },
    onSuccess: invalidate,
  });
}

export function useSupersedeDictionaryEntry(options?: {
  onFormError?: (details: Record<string, unknown>) => void;
}) {
  const invalidate = useInvalidateDictionaries();
  return useOpsMutation<
    DictionaryEntryView,
    SupersedeDictionaryEntryRequest & { entryId: string }
  >({
    mutationFn: ({ entryId, ...body }) =>
      opsApiClient.post<DictionaryEntryView>(dictionaryEntrySupersedePath(entryId), body),
    onSuccess: invalidate,
    onFormError: options?.onFormError,
  });
}
```

Импорты `RemoveDictionaryEntryResult`, `SupersedeDictionaryEntryRequest`, `dictionaryEntrySupersedePath` добавить. Проверь `opsApiClient.del` в `lib/ops-api.ts`: если он не разбирает тело при 200, доработай его так, чтобы при пустом ответе возвращался `undefined`, а при JSON — разобранное тело.

- [ ] **Step 3: Типы и хуки кадровых**

`entities/staff-dictionary/index.ts`: в `StaffDictionaryRow` после `level: number;`:

```ts
  is_active: boolean;
  inactive_since: string | null;
  supersedes: number | null;
  superseded_by: number | null;
  usage: DictionaryUsage;
```

с `import type { DictionaryUsage } from "@/entities/dictionary";`. Добавить:

```ts
export type StaffDictionaryWrite = Pick<StaffDictionaryRow, "name" | "name_kk" | "code" | "level">;
export type RemoveStaffDictionaryRowResult =
  | { result: "deleted" }
  | { result: "deactivated"; row: StaffDictionaryRow };
export function staffDictionaryRowActionPath(kind: string, id: number, action: "set-active" | "supersede"): string {
  return `${staffDictionaryRowPath(kind, id)}${action}/`;
}
```

`hooks/use-staff-dictionaries.ts`: `useCreateStaffDictionaryRow` тело `StaffDictionaryWrite`; `useUpdateStaffDictionaryRow` тело `Partial<StaffDictionaryWrite> & { id: number }`; `useDeleteStaffDictionaryRow` возвращает `RemoveStaffDictionaryRowResult` (как в Step 2: `body ?? { result: "deleted" }`); добавить:

```ts
export function useSetStaffDictionaryRowActive(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<StaffDictionaryRow, Error, { id: number; is_active: boolean }>({
    mutationFn: ({ id, is_active }) =>
      opsApiClient.post<StaffDictionaryRow>(staffDictionaryRowActionPath(kind, id, "set-active"), { is_active }),
    onSuccess: invalidate,
  });
}

export function useSupersedeStaffDictionaryRow(kind: string) {
  const invalidate = useInvalidate(kind);
  return useMutation<StaffDictionaryRow, Error, StaffDictionaryWrite & { id: number }>({
    mutationFn: ({ id, ...body }) =>
      opsApiClient.post<StaffDictionaryRow>(staffDictionaryRowActionPath(kind, id, "supersede"), body),
    onSuccess: invalidate,
  });
}
```

`lib/api.ts`: в интерфейсы `Position` и `Rank` добавить `is_active?: boolean;` (необязательное: старые ответы без поля читаются как активные).

- [ ] **Step 4: Моки**

В `mocks/ops/dictionaries-handlers.ts`: в `entry()` добавить `inactiveSince: null, supersedes: null, supersededBy: null`; в `usageOf` заменить последний `return { status: "NOT_TRACKED", ... }` на `TRACKED` с `reason: NOT_TRACKED_REASON[item.dictionaryCode] ?? null`, `references: []`, `totalCount: 0`; в DELETE-обработчике: убрать ветку 422, при `usage.totalCount > 0` — деактивировать (`isActive: false`, `inactiveSince: nowIso().slice(0, 10)`), сохранить и вернуть `HttpResponse.json({ result: "deactivated", entry: view(updated) })`; добавить обработчик:

```ts
  http.post(`*${dictionaryEntrySupersedePath(":id")}`, async ({ params, request }) => {
    const id = params.id as string;
    const existing = getEntries().find((item) => item.id === id);
    if (existing === undefined) {
      return errorEnvelope("ENTITY_NOT_FOUND", "Запись не найдена.", { id }, 404);
    }
    if (!existing.isActive) {
      return errorEnvelope("DICTIONARY_ENTRY_INACTIVE", "Заменить можно только активное значение.", {}, 409);
    }
    const body = (await request.json()) as CreateDictionaryEntryRequest;
    const code = body.code.trim().toUpperCase();
    if (code === "" || getEntries().some((item) => item.dictionaryCode === existing.dictionaryCode && item.code === code)) {
      return errorEnvelope("VALIDATION_ERROR", "Проверьте заполнение формы.", { code: ["Код уже используется в этом справочнике."] }, 400);
    }
    seq += 1;
    const successor: DictionaryEntry = {
      ...existing,
      id: `dict-${existing.dictionaryCode}-new-${Date.now()}-${seq}`,
      code,
      label: body.label.trim(),
      labelKk: (body.labelKk ?? "").trim(),
      description: (body.description ?? "").trim(),
      isActive: true,
      updatedAt: nowIso(),
      inactiveSince: null,
      supersedes: { id: existing.id, code: existing.code },
      supersededBy: null,
    };
    const retired: DictionaryEntry = {
      ...existing, isActive: false, inactiveSince: nowIso().slice(0, 10),
      supersededBy: { id: successor.id, code: successor.code }, updatedAt: nowIso(),
    };
    entries = [...getEntries().map((item) => (item.id === id ? retired : item)), successor];
    persist();
    return HttpResponse.json(view(successor), { status: 201 });
  }),
```

с импортом `dictionaryEntrySupersedePath`.

- [ ] **Step 5: Проверить и закоммитить**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit` — ошибки допустимы только в двух страницах справочников (их чинят Tasks 7-8); все остальные должны быть чистыми. Если `tsc` показывает ошибки в других файлах, исправь их в рамках типов (например, `labelKk`-подобные литералы в моках).

```bash
git add frontend/entities frontend/hooks frontend/lib/api.ts frontend/mocks
git commit -m "feat(front): lifecycle fields, supersede/remove hooks and mocks for dictionaries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Экран значений ОМ: замена, удаление с исходом, бейджи

**Files:**
- Modify: `frontend/app/security-ops/dictionaries/[code]/page.tsx`

**Interfaces:**
- Consumes: хуки и типы из Task 6.

- [ ] **Step 1: Импорты и состояние**

Добавить импорты `Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle` из `@/components/ui/dialog`, `useSupersedeDictionaryEntry` из хуков, `formatIsoDateTime` не нужен — даты печатать через `new Date(value).toLocaleDateString("ru-RU")`.

В компоненте страницы рядом с `const [editing, setEditing] = useState<string | null>(null);` добавить:

```tsx
  const [removing, setRemoving] = useState<DictionaryEntryView | null>(null);
  const [replacing, setReplacing] = useState<DictionaryEntryView | null>(null);
  const [replaceErrors, setReplaceErrors] = useState<Record<string, unknown> | null>(null);
  const supersede = useSupersedeDictionaryEntry({ onFormError: (details) => setReplaceErrors(details) });
```

`mutationError` дополнить `?? supersede.error`.

- [ ] **Step 2: Карточка**

В `EntryCard`: кнопка «Редактировать» → текст «Исправить»; кнопка «Удалить» → `onClick={onRemoveRequest}`; новая кнопка перед «Удалить»: `<Button type="button" variant="outline" size="sm" onClick={onReplaceRequest}>Заменить</Button>`; пропсы `onRemoveRequest: () => void; onReplaceRequest: () => void` вместо `onDelete`. Кнопки «Активировать» и «Заменить» не показываются, когда `entry.supersededBy !== null`. Бейдж активности заменить на:

```tsx
          <Badge className={entry.isActive ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-muted text-muted-foreground hover:bg-muted"}>
            {entry.isActive
              ? "Активна"
              : entry.inactiveSince
                ? `Неактивна с ${new Date(entry.inactiveSince).toLocaleDateString("ru-RU")}`
                : "Неактивна"}
          </Badge>
          {entry.supersededBy !== null && (
            <Badge variant="outline">заменена на {entry.supersededBy.code}</Badge>
          )}
          {entry.supersedes !== null && (
            <Badge variant="outline">заменяет {entry.supersedes.code}</Badge>
          )}
```

В обоих полях kk (форма добавления и редактор) добавить `maxLength={255}`; `useState(entry.labelKk ?? "")`.

В вызове `<EntryCard>` на странице: `onRemoveRequest={() => setRemoving(entry)}`, `onReplaceRequest={() => { setReplaceErrors(null); setReplacing(entry); }}`.

- [ ] **Step 3: Диалог удаления**

После списка карточек (внутри `query.data !== undefined && (...)`) добавить:

```tsx
          <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Удалить {removing?.code}?</DialogTitle>
                <DialogDescription>
                  {removing !== null && removing.usage.totalCount === 0
                    ? `«${removing.label}»: связей нет, значение будет удалено безвозвратно; след останется только в журнале действий.`
                    : removing !== null
                      ? `«${removing.label}» используется (${removing.usage.totalCount}): ${removing.usage.references
                          .map((ref) => `${ref.sourceLabel} — ${ref.samples.join(", ")}`)
                          .join("; ")}. Удалить нельзя: значение будет деактивировано с сегодняшней датой и останется в старых данных.`
                      : ""}
                </DialogDescription>
              </DialogHeader>
              {remove.error !== null && (
                <p className="text-sm text-destructive-ink" role="alert">{remove.error.message}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoving(null)}>Отмена</Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending || removing === null}
                  onClick={() => {
                    if (removing === null) return;
                    remove.mutate({ entryId: removing.id }, { onSuccess: () => setRemoving(null) });
                  }}
                >
                  {remove.isPending
                    ? "Выполняется…"
                    : removing !== null && removing.usage.totalCount > 0
                      ? "Деактивировать"
                      : "Удалить"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
```

- [ ] **Step 4: Диалог замены**

Компонент внизу файла:

```tsx
function ReplaceDialog({
  entry, isPending, errors, onCancel, onSubmit,
}: {
  entry: DictionaryEntryView | null;
  isPending: boolean;
  errors: Record<string, unknown> | null;
  onCancel: () => void;
  onSubmit: (values: { code: string; label: string; labelKk: string; description: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [labelKk, setLabelKk] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    setCode("");
    setLabel(entry?.label ?? "");
    setLabelKk(entry?.labelKk ?? "");
    setDescription(entry?.description ?? "");
  }, [entry]);
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Заменить {entry?.code}</DialogTitle>
          <DialogDescription>
            Значение меняется по сути: заводится новая запись с новым кодом, прежняя закрывается
            для выбора с сегодняшней датой и остаётся в старых данных.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="replace-code">Новый код *</Label>
            <Input id="replace-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-label">Название *</Label>
            <Input id="replace-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-label-kk">Название (kk)</Label>
            <Input id="replace-label-kk" maxLength={255} value={labelKk} onChange={(e) => setLabelKk(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-description">Описание</Label>
            <Input id="replace-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        {errors !== null && Object.keys(errors).length > 0 && (
          <ul className="list-disc pl-5 text-xs text-destructive-ink" role="alert">
            {Object.entries(errors).map(([field, value]) => (
              <li key={field}>{field}: {Array.isArray(value) ? String(value[0]) : String(value)}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Отмена</Button>
          <Button disabled={isPending} onClick={() => onSubmit({ code, label, labelKk, description })}>
            {isPending ? "Замена…" : "Заменить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

(`useEffect` добавить в импорт из `react`.) Использование на странице после диалога удаления:

```tsx
          <ReplaceDialog
            entry={replacing}
            isPending={supersede.isPending}
            errors={replaceErrors}
            onCancel={() => setReplacing(null)}
            onSubmit={(values) => {
              if (replacing === null) return;
              setReplaceErrors(null);
              supersede.mutate(
                {
                  entryId: replacing.id,
                  ...values,
                  groupCode: replacing.groupCode,
                  ownerDivisionId: replacing.ownerDivisionId ?? null,
                },
                { onSuccess: () => setReplacing(null) }
              );
            }}
          />
```

Описание страницы (`PageHeader description`) заменить на «Значения и их связи: без связей значение удаляется, со связями — деактивируется с датой; замена заводит запись-преемника.»

- [ ] **Step 5: Проверить и закоммитить**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit` → без ошибок в этом файле.

```bash
git add "frontend/app/security-ops/dictionaries/[code]/page.tsx"
git commit -m "feat(front): OM dictionary values: replace with successor, remove with outcome, lifecycle badges

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Экран кадровых справочников и выбор должности/звания

**Files:**
- Modify: `frontend/app/security-ops/dictionaries/personnel/[kind]/page.tsx`
- Modify: `frontend/features/service-employees/ui/EmployeeAdminDialog.tsx` (селекты должности и звания)

- [ ] **Step 1: Страница кадровых**

По образцу Task 7: состояние `removing`/`replacing`, хуки `useSetStaffDictionaryRowActive(kind)`, `useSupersedeStaffDictionaryRow(kind)`; в `RowCard`: кнопка «Редактировать» → «Исправить», новые кнопки «Деактивировать»/«Активировать» (скрыта при `row.superseded_by !== null`) и «Заменить» (скрыта при `row.superseded_by !== null`), «Удалить» открывает диалог подтверждения с текстом по `row.usage` (как в Task 7, `usage.references` со `sourceLabel — samples`); бейджи: «Активна» / «Неактивна с дд.мм.гггг», «заменена на #id» / «заменяет #id» (кода преемника в ответе нет, показывать `superseded_by`/`supersedes` как номер); диалог замены с полями «Название *», «Название (kk)», «Код *», «Уровень *» (значения по умолчанию из строки, код пустой), сабмит → `supersede.mutate({ id: row.id, name, name_kk, code, level })`. Ошибки замены/удаления показывать в диалоге через `error.message`. Поля kk с `maxLength={255}`; `useState(row.name_kk ?? "")`.

- [ ] **Step 2: Выбор должности и звания**

В `EmployeeAdminDialog.tsx` в `positions.data?.map(...)` и `ranks.data?.map(...)` добавить фильтр `.filter((item) => item.is_active !== false)` перед `.map`, с комментарием «неактивная должность/звание закрыты для нового выбора (UC-REF-001)».

- [ ] **Step 3: Проверить и закоммитить**

Run: `cd frontend && ./node_modules/.bin/tsc --noEmit` → без ошибок.

```bash
git add "frontend/app/security-ops/dictionaries/personnel/[kind]/page.tsx" frontend/features/service-employees/ui/EmployeeAdminDialog.tsx
git commit -m "feat(front): staff dictionaries lifecycle actions, inactive rows hidden from selection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Сквозная проверка

- [ ] **Step 1: Бэкенд целиком** — `$PY -m pytest -q` → все зелёные; `makemigrations --check` → No changes.
- [ ] **Step 2: Фронт** — `tsc --noEmit`; `NEXTAUTH_SECRET=build-only-placeholder ./node_modules/.bin/next build` → без `Failed to compile`.
- [ ] **Step 3: Образы и стенд** — из корня репо: `DOCKER_BUILDKIT=1 docker build -f deploy/contour/Dockerfile.backend -t smart-josparlau/lan-backend-base:slim .`, затем `docker build -f <scratchpad>/Dockerfile.lan-backend-slim -t smart-josparlau/lan-backend:slim .` (файл лежит в scratchpad контроллера; если недоступен, создай его по образцу `deploy/lan/Dockerfile.backend` с `FROM smart-josparlau/lan-backend-base:slim`), `docker build -f deploy/contour/Dockerfile.frontend -t smart-josparlau/lan-frontend:slim .`; в папке бандла `bash ctl.sh up -d --pull never --no-build --wait` (backend, worker, frontend перезапустятся; миграции 0130 и 0005 применит entrypoint).
- [ ] **Step 4: Живой прогон** (Playwright MCP, вход `admin`/`admin12345`, http://127.0.0.1:3300): в `RETURN_REASONS` заменить значение (преемник появился, прежнее «Неактивна с …», «заменена на …»); удалить значение без связей (исчезло); в `PLACEMENT_ROLES` «удалить» значение, у которого есть связь (если связей нет, создать нельзя без мероприятия — тогда проверить текст диалога для нулевых связей); в кадровых заменить должность и деактивировать звание; открыть журнал «Аудит» и найти `DICTIONARY_ENTRY_SUPERSEDED`. Скриншоты в `.playwright-mcp/`.
- [ ] **Step 5: Итог** — `git status --short` пуст, `git log --oneline main..HEAD` показывает 8 коммитов.
