# UC-REF-001 «Фундамент» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдельное право `dictionary_value.manage` на все мутации значений справочников и казахское наименование у значений ОМ, должностей и званий, с тестами.

**Architecture:** Право добавляется в сид и data-миграцией (прецедент `operations/0126`), затем подменяется в `permission_map` двух viewset и в двух гейтах фронта. Двуязычие — вторая колонка (`label_kk` / `name_kk`) с пустым значением по умолчанию, протянутая через сервис, сериализаторы, типы и формы. Тесты бэка идут на PostgreSQL из Docker-стека; тестовый помощник `client_for` восстанавливается, потому что в экспорте его нет.

**Tech Stack:** Django 5.1.15, DRF 3.17.1, pytest-django, PostgreSQL 16 (Docker, порт 5300); Next.js 15.5, React 19, TypeScript, TanStack Query, MSW.

**Spec:** `docs/superpowers/specs/2026-09-23-dictionary-values-foundation-design.md`

## Global Constraints

- Корень репозитория: `C:\проекты\smart-josparlau-offline-2026-09-19-1144\lan-1144-2026-09-19-final\source`. Все пути ниже относительно него. Bash-команды в Git Bash, POSIX-пути `/c/...`.
- Бэкенд запускается только через venv: `backend/.venv/Scripts/python.exe`. Никаких `pip install`: venv уже собран по пиннутому `requirements.txt` без `uvloop`.
- Перед любым `pytest`, `manage.py` в `backend/` экспортируй окружение БД (Docker-стек должен быть поднят, `bash ../../ctl.sh ps` показывает `db` healthy):

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/backend
export PR_DB_HOST=127.0.0.1 PR_DB_PORT=5300 PR_DB_NAME=smart_josparlau PR_DB_USER=smart_josparlau
export PR_DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' ../../.env)"
PY=.venv/Scripts/python.exe
```

- Тесты: `$PY -m pytest <путь> -q` (settings-модуль `organization_management.config.settings.test` задан в `pytest.ini`; тестовая база создаётся сама).
- Фронт: `cd frontend && ./node_modules/.bin/tsc --noEmit` для проверки типов. `node_modules` уже установлены.
- Код права: `dictionary_value.manage`, имя `Изменение справочных значений`. Поля: `label_kk` (ОМ), `name_kk` (Position, Rank), `CharField(max_length=255, blank=True, default="")`. JSON-ключи: `labelKk` у значений ОМ, `name_kk` у кадровых.
- Право самостоятельное: держатель только `dictionary.manage` получает 403 на все мутации значений. `OpsProtectedPersonsViewSet` и страница `persons` остаются на `dictionary.manage` — не трогать.
- Коммиты: `git commit` с трейлером `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Идентичность репо задаётся в Task 1. Не коммитить `node_modules`, `.venv`, `.next*`.
- Стиль тестов бэка: pytest-функции, `pytestmark = pytest.mark.django_db`, `client_for` из `organization_management.apps.operations.tests.support`. Существующий образец: `backend/organization_management/apps/divisions/api/test_write_permissions.py`.

---

### Task 1: Тестовый харнесс `client_for`

**Files:**
- Create: `backend/organization_management/apps/operations/tests/__init__.py`
- Create: `backend/organization_management/apps/operations/tests/support.py`
- Create: `backend/organization_management/apps/operations/tests/test_bulk_status_api.py`
- Create: `backend/organization_management/apps/ops/tests/__init__.py`

**Interfaces:**
- Produces: `client_for(username, role_code=None, permission_codes=None, scope_division_id=None) -> tuple[APIClient, User]`. Пользователь создаётся `create_user(username, password="x")`; при `role_code` заводятся `Role`, `Permission` для каждого кода, `RolePermission`, `UserRole(user_id=str(user.pk), scope_division_id, is_active=True)`; клиент авторизован `force_authenticate`.

- [ ] **Step 1: Задать идентичность git в репозитории**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git config user.name "almaz.amantaiyli"
git config user.email "almaz.amantaiyli@gmail.com"
git status --short
```

Expected: пустой вывод `git status --short` (рабочее дерево чистое).

- [ ] **Step 2: Убедиться, что сборка тестов сейчас падает на импорте**

```bash
cd backend && $PY -m pytest --collect-only -q 2>&1 | tail -8
```

Expected: `ModuleNotFoundError: No module named 'organization_management.apps.operations.tests'` и `5 errors during collection`.

- [ ] **Step 3: Создать пакет и помощник**

`backend/organization_management/apps/operations/tests/__init__.py` — пустой файл.

`backend/organization_management/apps/operations/tests/support.py`:

```python
"""Общие помощники проб раздела ОМ.

`client_for` заводит учётку с ролью и правами нового RBAC и возвращает
авторизованный APIClient. В рабочем репозитории помощник живёт в
`test_bulk_status_api.py`; экспорт исходников этого модуля не содержит,
поэтому помощник вынесен сюда, а старый путь импорта сохранён шимом.
"""
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.services import LegacyRoleSync


def client_for(username, role_code=None, permission_codes=None,
               scope_division_id=None):
    """Учётка + роль + права → (APIClient, User).

    Без `role_code` — просто вошедший пользователь без единого права:
    ровно то, что нужно пробам «один IsAuthenticated не право».
    """
    user = get_user_model().objects.create_user(
        username=username, password="x"
    )
    if role_code is not None:
        Role.objects.get_or_create(code=role_code, defaults={"name": role_code})
        for code in permission_codes or []:
            Permission.objects.get_or_create(code=code, defaults={"name": code})
            RolePermission.objects.get_or_create(
                role_code_id=role_code, permission_code_id=code
            )
        UserRole.objects.get_or_create(
            user_id=LegacyRoleSync.actor_id_for_user(user),
            role_code_id=role_code,
            scope_division_id=scope_division_id,
            defaults={"is_active": True},
        )
    api = APIClient()
    api.force_authenticate(user)
    return api, user
```

`backend/organization_management/apps/operations/tests/test_bulk_status_api.py`:

```python
"""Шим для экспорта исходников: старый путь импорта `client_for`.

В рабочем репозитории здесь лежат пробы массовых статусов вместе с
помощником `client_for`; в экспорт они не вошли, а пять модулей проб
импортируют помощник отсюда. При переносе в рабочий репозиторий этот
файл удаляется, а `support.py` остаётся.
"""
from organization_management.apps.operations.tests.support import (  # noqa: F401
    client_for,
)
```

`backend/organization_management/apps/ops/tests/__init__.py` — пустой файл (сюда лягут новые пробы справочников).

- [ ] **Step 4: Проверить, что все пробы собираются и старые проходят**

```bash
$PY -m pytest --collect-only -q 2>&1 | tail -3
$PY -m pytest organization_management/apps/divisions -q 2>&1 | tail -5
```

Expected: `0 errors` при сборке; пробы `divisions` зелёные (они первые потребители `client_for`). Если какая-то из них красная по причине, не связанной с `client_for` (например, отсутствующие в экспорте фикстуры), зафиксируй имя пробы в отчёте и не чини её здесь.

- [ ] **Step 5: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/operations/tests backend/organization_management/apps/ops/tests
git commit -m "test: restore client_for harness missing from the source export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Право `dictionary_value.manage` в сиде и миграции

**Files:**
- Modify: `backend/organization_management/apps/operations/management/commands/seed_operations.py:146-147` (PERMISSIONS) и `:380-383` (REFERENCE_ADMIN)
- Create: `backend/organization_management/apps/operations/migrations/0127_dictionary_value_manage_permission.py`
- Test: `backend/organization_management/apps/operations/tests/test_seed_dictionary_value_permission.py`

**Interfaces:**
- Produces: код `dictionary_value.manage` в каталоге прав и в наборе REFERENCE_ADMIN; после миграции 0127 на засеянной базе право выдано REFERENCE_ADMIN.

- [ ] **Step 1: Написать красные пробы**

`backend/organization_management/apps/operations/tests/test_seed_dictionary_value_permission.py`:

```python
"""Право на значения справочников в сиде (UC-REF-001, BR13)."""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from organization_management.apps.operations.models import (
    Permission,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.services import (
    LegacyRoleSync,
    PermissionService,
)

pytestmark = pytest.mark.django_db

CODE = "dictionary_value.manage"


def test_seed_declares_the_value_permission_and_grants_it_to_reference_admin():
    call_command("seed_operations", reference_only=True)

    assert Permission.objects.get(code=CODE).name == "Изменение справочных значений"
    granted = set(
        RolePermission.objects.filter(role_code_id="REFERENCE_ADMIN")
        .values_list("permission_code_id", flat=True)
    )
    assert {"dictionary.view", "dictionary.manage", CODE} <= granted


def test_reference_admin_holder_gets_the_value_permission():
    call_command("seed_operations", reference_only=True)
    user = get_user_model().objects.create_user(username="ref-admin", password="x")
    actor = LegacyRoleSync.actor_id_for_user(user)
    UserRole.objects.create(user_id=actor, role_code_id="REFERENCE_ADMIN", is_active=True)

    assert CODE in PermissionService.effective_permissions(actor)
```

- [ ] **Step 2: Убедиться, что пробы красные**

```bash
$PY -m pytest organization_management/apps/operations/tests/test_seed_dictionary_value_permission.py -q 2>&1 | tail -5
```

Expected: 2 failed, `Permission matching query does not exist` / `assert CODE in ...`.

- [ ] **Step 3: Добавить право в сид**

В `seed_operations.py` в `PERMISSIONS` после строки `("dictionary.manage", "Управление справочниками раздела ОМ"),` добавить:

```python
    # Значения справочников — отдельное право (UC-REF-001, BR13): все четыре
    # операции над значениями любого справочника раздела и кадровых. Не
    # выводится из `dictionary.manage`, выдаётся ролям явно.
    ("dictionary_value.manage", "Изменение справочных значений"),
```

В `ROLE_PERMISSIONS` заменить блок REFERENCE_ADMIN:

```python
    "REFERENCE_ADMIN": [
        "dictionary.view", "dictionary.manage", "dictionary_value.manage",
        "settings.view", "settings.manage",
    ],
```

- [ ] **Step 4: Написать data-миграцию по образцу 0126**

`backend/organization_management/apps/operations/migrations/0127_dictionary_value_manage_permission.py`:

```python
"""`dictionary_value.manage` — «Изменение справочных значений» (UC-REF-001, BR13).

Право самостоятельное: не выводится из `dictionary.manage`, выдаётся ролям
явно. REFERENCE_ADMIN получает его сразу, ADMIN покрыт wildcard `*`.

Миграцией, а не только сидом: сид на уже засеянной базе сам себя не
применит (прецедент 0126). Строку `Permission` миграция заводит сама.
"""
from django.db import migrations

PERMISSION = "dictionary_value.manage"
NAME = "Изменение справочных значений"
ROLE = "REFERENCE_ADMIN"


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Role.objects.filter(code=ROLE).exists():
        # База, не видевшая сида, ролей не знает — раскладку заведёт сид.
        return
    Permission.objects.get_or_create(code=PERMISSION, defaults={"name": NAME})
    RolePermission.objects.get_or_create(
        role_code_id=ROLE, permission_code_id=PERMISSION
    )


def _revoke(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(permission_code_id=PERMISSION).delete()
    Permission.objects.filter(code=PERMISSION).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0126_duty_officer_status_manage_root")]

    operations = [migrations.RunPython(_grant, _revoke)]
```

- [ ] **Step 5: Проверить пробы и миграции**

```bash
$PY -m pytest organization_management/apps/operations/tests/test_seed_dictionary_value_permission.py -q 2>&1 | tail -3
$PY manage.py makemigrations --check --dry-run 2>&1 | tail -2
```

Expected: `2 passed`; `No changes detected`.

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/operations/management/commands/seed_operations.py backend/organization_management/apps/operations/migrations/0127_dictionary_value_manage_permission.py backend/organization_management/apps/operations/tests/test_seed_dictionary_value_permission.py
git commit -m "feat(rbac): add dictionary_value.manage permission, grant to REFERENCE_ADMIN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Значения ОМ под новым правом

**Files:**
- Modify: `backend/organization_management/apps/ops/api/views.py:4305-4312` (`OpsDictionariesViewSet.permission_map`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py`

**Interfaces:**
- Consumes: `client_for` из Task 1.
- Produces: `create_entry`, `set_active`, `delete_entry` требуют `dictionary_value.manage`; чтение по-прежнему `dictionary.view`.

- [ ] **Step 1: Написать красные пробы**

`backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py`:

```python
"""Право на значения справочников отделено от `dictionary.manage` (UC-REF-001, BR13).

Держатель только `dictionary.manage` видит справочники, но не меняет значения:
все четыре операции отбиваются сервером 403, включая прямые запросы.
"""
import pytest

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db

VALUE = "dictionary_value.manage"
# JOURNAL_ENTRY_TYPES — единственный справочник, где удаление доходит до 204:
# связи у него отслеживаются, и у свежей записи их ноль.
ENTRIES = "/api/ops/dictionaries/JOURNAL_ENTRY_TYPES/entries/"
POSITIONS = "/api/dictionaries/positions/"


def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


@pytest.fixture
def entry():
    return OpsDictionaryEntry.objects.create(
        dictionary_code="JOURNAL_ENTRY_TYPES", code="PROBE",
        label="Проба", description="", is_active=True,
    )


@pytest.fixture
def position():
    return Position.objects.create(name="Проба", code="PROBE_POS", level=50)


def _entry_mutations(api, entry):
    body = {"code": "NEW_ONE", "label": "Новое", "description": ""}
    return {
        "create": api.post(ENTRIES, body, format="json"),
        "patch": api.patch(
            entry_url(entry), {"label": "Иначе", "description": ""}, format="json"
        ),
        "set_active": api.post(
            entry_url(entry) + "set-active/", {"isActive": False}, format="json"
        ),
        "delete": api.delete(entry_url(entry)),
    }


def test_dictionary_manage_alone_is_refused_on_every_entry_mutation(entry):
    api, _ = client_for(
        "dict-manage-only", "DICT_MANAGE_ONLY",
        ["dictionary.view", "dictionary.manage"],
    )
    for name, response in _entry_mutations(api, entry).items():
        assert response.status_code == 403, (name, response.content)
    assert api.get(ENTRIES).status_code == 200


def test_value_permission_allows_every_entry_mutation(entry):
    api, _ = client_for(
        "dict-value-manager", "DICT_VALUE_MANAGER", ["dictionary.view", VALUE]
    )
    responses = _entry_mutations(api, entry)
    assert responses["create"].status_code == 201, responses["create"].content
    assert responses["patch"].status_code == 200, responses["patch"].content
    assert responses["set_active"].status_code == 200, responses["set_active"].content
    assert responses["delete"].status_code == 204, responses["delete"].content


def test_view_only_reads_entries_but_cannot_write(entry):
    api, _ = client_for("dict-viewer", "DICT_VIEWER", ["dictionary.view"])
    assert api.get(ENTRIES).status_code == 200
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code == 403, created.content


def test_signed_in_user_without_rights_is_refused(entry):
    api, _ = client_for("dict-nobody")
    assert api.get(ENTRIES).status_code == 403
    created = api.post(
        ENTRIES, {"code": "X", "label": "X", "description": ""}, format="json"
    )
    assert created.status_code == 403, created.content
```

- [ ] **Step 2: Убедиться, что пробы красные**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_permission.py -q 2>&1 | tail -6
```

Expected: `test_dictionary_manage_alone_is_refused_on_every_entry_mutation` и `test_value_permission_allows_every_entry_mutation` красные (сейчас мутации открыты по `dictionary.manage`), два остальных зелёные.

- [ ] **Step 3: Перевести карту прав**

В `backend/organization_management/apps/ops/api/views.py` заменить `permission_map` класса `OpsDictionariesViewSet`:

```python
    permission_map = {
        "list": "dictionary.view",
        "entries": "dictionary.view",
        # Значения — отдельное право (UC-REF-001, BR13): `dictionary.manage`
        # мутаций значений больше не даёт.
        "create_entry": "dictionary_value.manage",
        "set_active": "dictionary_value.manage",
        # Правка и удаление значения — одно действие на два метода.
        "delete_entry": "dictionary_value.manage",
    }
```

В докстринге `delete_entry` (`views.py:4409`) фразу `оба метода всё равно требуют одного права \`dictionary.manage\`` заменить на `оба метода всё равно требуют одного права \`dictionary_value.manage\``.

- [ ] **Step 4: Проверить**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_permission.py -q 2>&1 | tail -3
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/ops/api/views.py backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py
git commit -m "feat(rbac): gate OM dictionary value mutations by dictionary_value.manage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Кадровые справочники под новым правом

**Files:**
- Modify: `backend/organization_management/apps/dictionaries/api/views.py:20-24` (`_MANAGE`) и докстринги `:87`, `:95`
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py` (дополнить)

**Interfaces:**
- Produces: `create`, `update`, `partial_update`, `destroy` у `PositionViewSet` и `RankViewSet` требуют `dictionary_value.manage`.

- [ ] **Step 1: Дописать красные пробы в конец файла из Task 3**

```python
def _staff_mutations(api, position):
    return {
        "create": api.post(
            POSITIONS, {"name": "Новая", "code": "NEW_POS", "level": 60},
            format="json",
        ),
        "patch": api.patch(
            f"{POSITIONS}{position.pk}/", {"name": "Иначе"}, format="json"
        ),
        "delete": api.delete(f"{POSITIONS}{position.pk}/"),
    }


def test_staff_dictionary_refuses_dictionary_manage_alone(position):
    api, _ = client_for(
        "staff-manage-only", "STAFF_MANAGE_ONLY",
        ["dictionary.view", "dictionary.manage"],
    )
    for name, response in _staff_mutations(api, position).items():
        assert response.status_code == 403, (name, response.content)
    assert api.get(POSITIONS).status_code == 200


def test_staff_dictionary_accepts_value_permission(position):
    api, _ = client_for(
        "staff-value-manager", "STAFF_VALUE_MANAGER", ["dictionary.view", VALUE]
    )
    responses = _staff_mutations(api, position)
    assert responses["create"].status_code == 201, responses["create"].content
    assert responses["patch"].status_code == 200, responses["patch"].content
    assert responses["delete"].status_code == 204, responses["delete"].content
```

- [ ] **Step 2: Убедиться, что новые пробы красные**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_permission.py -q -k staff 2>&1 | tail -4
```

Expected: `2 failed`.

- [ ] **Step 3: Перевести константу права**

В `backend/organization_management/apps/dictionaries/api/views.py` заменить блок констант:

```python
#: Право на правку кадровых справочников. ТО ЖЕ, что у значений справочников
#: раздела ОМ — решение заказчика 28.08.2026 (Plane №274 Ш-1): «Открыть под
#: тем же правом, что и ОМ». С UC-REF-001 это отдельное право на значения,
#: `dictionary.manage` мутаций больше не даёт. Одно правило на все справочники.
_MANAGE = "dictionary_value.manage"
_VIEW = "dictionary.view"
```

В докстрингах `PositionViewSet` и `RankViewSet` заменить `правка по \`dictionary.manage\`` на `правка по \`dictionary_value.manage\``.

- [ ] **Step 4: Проверить весь файл проб**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_permission.py -q 2>&1 | tail -3
```

Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/dictionaries/api/views.py backend/organization_management/apps/ops/tests/test_dictionary_values_permission.py
git commit -m "feat(rbac): gate staff dictionary mutations by dictionary_value.manage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Поля kk в моделях и миграции

**Files:**
- Modify: `backend/organization_management/apps/operations/models_settings.py:147-160` (`OpsDictionaryEntry`)
- Modify: `backend/organization_management/apps/dictionaries/models.py:5-16` (`Position`), `:158-170` (`Rank`)
- Create: `backend/organization_management/apps/operations/migrations/0128_dictionary_entry_label_kk.py`
- Create: `backend/organization_management/apps/dictionaries/migrations/0004_position_rank_name_kk.py`
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py`

**Interfaces:**
- Produces: `OpsDictionaryEntry.label_kk: str`, `Position.name_kk: str`, `Rank.name_kk: str`; все `blank=True, default=""`.

- [ ] **Step 1: Написать красные пробы моделей**

`backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py`:

```python
"""Двуязычные значения справочников: `labelKk` у ОМ, `name_kk` у кадровых (UC-REF-001)."""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db

ENTRIES = "/api/ops/dictionaries/RETURN_REASONS/entries/"


def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


@pytest.fixture
def api():
    client, _ = client_for(
        "kk-editor", "KK_EDITOR", ["dictionary.view", "dictionary_value.manage"]
    )
    return client


def test_models_store_kazakh_names():
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="KK", label="Погода",
        label_kk="Ауа райы", is_active=True,
    )
    position = Position.objects.create(
        name="Инспектор", name_kk="Тексеруші", code="KK_POS", level=40
    )
    rank = Rank.objects.create(name="Лейтенант", name_kk="Лейтенант", code="KK_LT", level=10)

    assert OpsDictionaryEntry.objects.get(pk=entry.pk).label_kk == "Ауа райы"
    assert Position.objects.get(pk=position.pk).name_kk == "Тексеруші"
    assert Rank.objects.get(pk=rank.pk).name_kk == "Лейтенант"


def test_kazakh_name_defaults_to_empty_string():
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="EMPTY", label="Пусто", is_active=True,
    )
    assert entry.label_kk == ""
```

- [ ] **Step 2: Убедиться, что пробы красные**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q 2>&1 | tail -4
```

Expected: `2 failed`, `TypeError: ... unexpected keyword arguments: 'label_kk'`.

- [ ] **Step 3: Добавить поля**

В `models_settings.py` в классе `OpsDictionaryEntry` после строки `label = models.CharField(max_length=255)`:

```python
    # Казахское наименование (UC-REF-001). Пустая строка — «перевода нет»:
    # существующие данные и сиды перевода не имеют. Уникален код, не подпись.
    label_kk = models.CharField(max_length=255, blank=True, default="")
```

В `dictionaries/models.py` в классе `Position` после строки `name = models.CharField(max_length=255, verbose_name=_("Название должности"))`:

```python
    name_kk = models.CharField(
        max_length=255, blank=True, default="",
        verbose_name=_("Название должности (kk)"),
    )
```

В классе `Rank` после строки `name = models.CharField(max_length=50, unique=True, verbose_name=_("Звание"))`:

```python
    name_kk = models.CharField(
        max_length=255, blank=True, default="", verbose_name=_("Звание (kk)")
    )
```

- [ ] **Step 4: Написать миграции**

`backend/organization_management/apps/operations/migrations/0128_dictionary_entry_label_kk.py`:

```python
"""Казахское наименование у значений справочников раздела ОМ (UC-REF-001).

Необязательное: существующие данные и сиды перевода не имеют, пустая строка
означает «перевода нет». Уникальности нет — уникален код.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0127_dictionary_value_manage_permission")]

    operations = [
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="label_kk",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
```

`backend/organization_management/apps/dictionaries/migrations/0004_position_rank_name_kk.py`:

```python
"""Казахское наименование у должностей и званий (UC-REF-001).

Необязательное, пустая строка — «перевода нет»; уникален код.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dictionaries", "0003_position_rank_code")]

    operations = [
        migrations.AddField(
            model_name="position",
            name="name_kk",
            field=models.CharField(
                blank=True, default="", max_length=255,
                verbose_name="Название должности (kk)",
            ),
        ),
        migrations.AddField(
            model_name="rank",
            name="name_kk",
            field=models.CharField(
                blank=True, default="", max_length=255, verbose_name="Звание (kk)"
            ),
        ),
    ]
```

- [ ] **Step 5: Проверить пробы и паритет миграций**

```bash
$PY manage.py makemigrations --check --dry-run 2>&1 | tail -3
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q 2>&1 | tail -3
```

Expected: `No changes detected`; `2 passed`. Если `makemigrations` предлагает изменения, значит объявление поля в модели и в миграции разошлись: выровняй миграцию под модель (не наоборот).

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/operations/models_settings.py backend/organization_management/apps/operations/migrations/0128_dictionary_entry_label_kk.py backend/organization_management/apps/dictionaries/models.py backend/organization_management/apps/dictionaries/migrations/0004_position_rank_name_kk.py backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py
git commit -m "feat(dictionaries): add Kazakh name columns to OM entries, positions and ranks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `labelKk` в сервисе и API значений ОМ

**Files:**
- Modify: `backend/organization_management/apps/ops/dictionaries.py:269-285` (`serialize_entry`), `:414-467` (`create_entry`), `:470-548` (`update_entry`)
- Modify: `backend/organization_management/apps/ops/api/views.py:4362-4380` (`create_entry`), `:4394-4432` (`delete_entry`, ветка PATCH)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py` (дополнить)

**Interfaces:**
- Consumes: `OpsDictionaryEntry.label_kk` из Task 5.
- Produces: `create_entry(dictionary_code, *, code, label, description, group_code, label_kk="", owner_division_id=None, actor)`; `update_entry(entry_id, *, label, description, group_code, label_kk=UNSET, owner_division_id=UNSET, actor)`; `serialize_entry` отдаёт `"labelKk"`; POST принимает `labelKk`, PATCH меняет kk только при наличии ключа `labelKk`.

- [ ] **Step 1: Дописать красные пробы API в конец файла из Task 5**

```python
def test_create_returns_and_stores_label_kk(api):
    response = api.post(
        ENTRIES,
        {"code": "weather", "label": "Погода", "labelKk": " Ауа райы ", "description": ""},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == "Ауа райы"
    assert OpsDictionaryEntry.objects.get(code="WEATHER").label_kk == "Ауа райы"


def test_create_without_label_kk_yields_empty_string(api):
    response = api.post(
        ENTRIES, {"code": "fog", "label": "Туман", "description": ""}, format="json"
    )
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == ""


def test_patch_updates_label_kk(api):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="ICE", label="Гололёд", is_active=True,
    )
    response = api.patch(
        entry_url(entry),
        {"label": "Гололёд", "description": "", "labelKk": "Көктайғақ"},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["labelKk"] == "Көктайғақ"
    entry.refresh_from_db()
    assert (entry.label, entry.label_kk) == ("Гололёд", "Көктайғақ")


def test_patch_without_label_kk_key_leaves_it_untouched(api):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="WIND", label="Ветер",
        label_kk="Жел", is_active=True,
    )
    response = api.patch(
        entry_url(entry), {"label": "Сильный ветер", "description": ""}, format="json"
    )
    assert response.status_code == 200, response.content
    entry.refresh_from_db()
    assert (entry.label, entry.label_kk) == ("Сильный ветер", "Жел")


def test_update_audit_carries_old_and_new_label_kk(api, monkeypatch):
    entry = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="RAIN", label="Дождь",
        label_kk="Жаңбыр", is_active=True,
    )
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))

    response = api.patch(
        entry_url(entry),
        {"label": "Дождь", "description": "", "labelKk": "Нөсер"},
        format="json",
    )

    assert response.status_code == 200, response.content
    event = next(
        item for item in recorded
        if item["action"] == audit_service.DICTIONARY_ENTRY_UPDATED
    )
    assert event["old_value"]["labelKk"] == "Жаңбыр"
    assert event["new_value"]["labelKk"] == "Нөсер"
```

- [ ] **Step 2: Убедиться, что новые пробы красные**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q 2>&1 | tail -8
```

Expected: 4 failed (`KeyError: 'labelKk'` и расхождения значений), `test_patch_without_label_kk_key_leaves_it_untouched` может быть зелёной уже сейчас.

- [ ] **Step 3: Сервис**

В `backend/organization_management/apps/ops/dictionaries.py`:

`serialize_entry` — после строки `"label": entry.label,` добавить:

```python
        "labelKk": entry.label_kk,
```

`create_entry` — сигнатура и тело:

```python
@transaction.atomic
def create_entry(dictionary_code, *, code, label, description, group_code,
                 label_kk="", owner_division_id=None, actor):
```

в вызове `OpsDictionaryEntry.objects.create(...)` после `label=str(label).strip(),` добавить:

```python
        label_kk=str(label_kk or "").strip(),
```

в `new_value` события `DICTIONARY_ENTRY_CREATED` после `"label": entry.label,` добавить `"labelKk": entry.label_kk,`.

`update_entry` — сигнатура:

```python
@transaction.atomic
def update_entry(
    entry_id, *, label, description, group_code, label_kk=UNSET,
    owner_division_id=UNSET, actor
):
```

в словарь `old` после `"label": entry.label,` добавить `"labelKk": entry.label_kk,`; после строки `entry.label = str(label).strip()` добавить:

```python
    if label_kk is not UNSET:
        entry.label_kk = str(label_kk or "").strip()
```

в `update_fields` добавить `"label_kk"` после `"label"`; в `new_value` события `DICTIONARY_ENTRY_UPDATED` после `"label": entry.label,` добавить `"labelKk": entry.label_kk,`.

- [ ] **Step 4: Viewset**

В `backend/organization_management/apps/ops/api/views.py`:

`create_entry` — в вызов `dict_service.create_entry(...)` после `label=data.get("label"),` добавить:

```python
            label_kk=data.get("labelKk", ""),
```

`delete_entry`, ветка PATCH — после блока `if "ownerDivisionId" in data:` добавить:

```python
            if "labelKk" in data:
                update_kwargs["label_kk"] = data.get("labelKk")
```

- [ ] **Step 5: Проверить**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q 2>&1 | tail -3
```

Expected: `7 passed`.

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/ops/dictionaries.py backend/organization_management/apps/ops/api/views.py backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py
git commit -m "feat(dictionaries): expose labelKk on OM dictionary entries API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `name_kk` у должностей и званий через API

**Files:**
- Modify: `backend/organization_management/apps/dictionaries/api/serializers.py:11-22` (`PositionSerializer`)
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py` (дополнить)

**Interfaces:**
- Produces: `PositionSerializer.Meta.fields = ["id", "name", "name_kk", "code", "level"]`; `RankSerializer` с `__all__` отдаёт `name_kk` сам.

- [ ] **Step 1: Дописать красные пробы в конец файла**

```python
def test_position_round_trips_name_kk(api):
    created = api.post(
        "/api/dictionaries/positions/",
        {"name": "Инспектор", "name_kk": "Тексеруші", "code": "INSPECTOR", "level": 40},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["name_kk"] == "Тексеруші"
    pk = created.json()["id"]

    patched = api.patch(
        f"/api/dictionaries/positions/{pk}/", {"name_kk": "Бақылаушы"}, format="json"
    )
    assert patched.status_code == 200, patched.content
    assert Position.objects.get(pk=pk).name_kk == "Бақылаушы"


def test_rank_round_trips_name_kk(api):
    created = api.post(
        "/api/dictionaries/ranks/",
        {"name": "Лейтенант", "name_kk": "Лейтенант", "code": "LT", "level": 10},
        format="json",
    )
    assert created.status_code == 201, created.content
    assert created.json()["name_kk"] == "Лейтенант"
    assert Rank.objects.get(code="LT").name_kk == "Лейтенант"
```

- [ ] **Step 2: Убедиться, что проба должностей красная**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q -k round_trips 2>&1 | tail -4
```

Expected: `test_position_round_trips_name_kk` failed (`KeyError: 'name_kk'`), `test_rank_round_trips_name_kk` passed (сериализатор `__all__`).

- [ ] **Step 3: Сериализатор должностей**

В `serializers.py` заменить `fields = ["id", "name", "code", "level"]` на:

```python
        fields = ["id", "name", "name_kk", "code", "level"]
```

- [ ] **Step 4: Проверить**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q 2>&1 | tail -3
```

Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/dictionaries/api/serializers.py backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py
git commit -m "feat(dictionaries): expose name_kk on positions and ranks API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Админка и языковые настройки

**Files:**
- Modify: `backend/organization_management/apps/operations/admin_dictionaries.py:61-63`
- Modify: `backend/organization_management/config/settings/base.py:123`
- Test: `backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py` (дополнить)

- [ ] **Step 1: Дописать красную пробу настроек в конец файла**

```python
def test_supported_languages_are_ru_and_kk(settings):
    assert settings.LANGUAGE_CODE == "ru"
    assert [code for code, _ in settings.LANGUAGES] == ["ru", "kk"]
```

- [ ] **Step 2: Убедиться, что проба красная**

```bash
$PY -m pytest organization_management/apps/ops/tests/test_dictionary_values_bilingual.py -q -k languages 2>&1 | tail -3
```

Expected: `1 failed` (`'en-us' == 'ru'`).

- [ ] **Step 3: Настройки**

В `base.py` заменить строку `LANGUAGE_CODE = 'en-us'` на:

```python
# Русский по умолчанию, казахский — второй язык значений справочников
# (UC-REF-001). Выбор языка по заголовку не подключён: язык значения
# выбирает клиент по полям `label`/`labelKk`, а не сервер.
LANGUAGE_CODE = 'ru'
LANGUAGES = [('ru', 'Русский'), ('kk', 'Қазақша')]
```

- [ ] **Step 4: Админка**

В `admin_dictionaries.py` заменить:

```python
    list_display = ("dictionary_code", "code", "label", "label_kk", "group_code", "is_active")
    list_filter = ("dictionary_code", "is_active")
    search_fields = ("code", "label", "label_kk", "description", "group_code")
```

- [ ] **Step 5: Проверить пробы, check и весь бэкенд**

```bash
$PY manage.py check 2>&1 | tail -2
$PY -m pytest -q 2>&1 | tail -6
```

Expected: `System check identified no issues`; вся сборка зелёная, кроме проб, отмеченных в Task 1 Step 4 как сломанные экспортом (если такие были). Любую новую красную пробу считай регрессией смены `LANGUAGE_CODE`: сообщения валидации стали русскими; тогда сравни ожидания пробы и почини ожидание, а не настройку.

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add backend/organization_management/apps/operations/admin_dictionaries.py backend/organization_management/config/settings/base.py backend/organization_management/apps/ops/tests/test_dictionary_values_bilingual.py
git commit -m "feat(i18n): ru/kk LANGUAGES, Kazakh label in dictionary admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Типы, хуки и моки фронта

**Files:**
- Modify: `frontend/entities/dictionary/index.ts:31-46` (`DictionaryEntry`), `:117-131` (запросы)
- Modify: `frontend/entities/staff-dictionary/index.ts:10-15` (`StaffDictionaryRow`)
- Modify: `frontend/mocks/ops/dictionaries-handlers.ts:85-102` (`entry()`), `:311-323` (create handler)
- Modify: `frontend/hooks/use-staff-dictionaries.ts:3` (комментарий)

**Interfaces:**
- Produces: `DictionaryEntry.labelKk: string`; `CreateDictionaryEntryRequest.labelKk?: string`; `UpdateDictionaryEntryRequest.labelKk?: string`; `StaffDictionaryRow.name_kk: string`.

- [ ] **Step 1: Типы значений ОМ**

В `frontend/entities/dictionary/index.ts` в `interface DictionaryEntry` после `label: string;` добавить:

```ts
  /** Казахское наименование (UC-REF-001); пустая строка — перевода нет. */
  labelKk: string;
```

В `CreateDictionaryEntryRequest` после `label: string;` и в `UpdateDictionaryEntryRequest` после `label: string;` добавить:

```ts
  labelKk?: string;
```

- [ ] **Step 2: Типы кадровых**

В `frontend/entities/staff-dictionary/index.ts` в `interface StaffDictionaryRow` после `name: string;` добавить:

```ts
  /** Казахское наименование (UC-REF-001); пустая строка — перевода нет. */
  name_kk: string;
```

В `frontend/hooks/use-staff-dictionaries.ts` строку `// Кадровые справочники: чтение и правка под правом \`dictionary.manage\`.` заменить на `// Кадровые справочники: чтение по \`dictionary.view\`, правка под \`dictionary_value.manage\`.`

- [ ] **Step 3: Проверить типы и найти всех, кто собирает DictionaryEntry**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/frontend
./node_modules/.bin/tsc --noEmit 2>&1 | head -20
```

Expected: ошибки `Property 'labelKk' is missing` в `mocks/ops/dictionaries-handlers.ts` (функция `entry`, объект `created`) и, возможно, в других моках; ошибок `name_kk` в страницах пока нет, они появятся в Task 11 при правке форм. Список файлов из вывода — объём правок ниже.

- [ ] **Step 4: Моки**

В `frontend/mocks/ops/dictionaries-handlers.ts` в функции `entry()` в возвращаемом объекте после `label,` добавить `labelKk: "",`. В обработчике `http.post` создания в объекте `created` после `label: body.label.trim(),` добавить:

```ts
      labelKk: (body.labelKk ?? "").trim(),
```

Если `tsc` показал другие места, собирающие `DictionaryEntry` (например, фикстуры ролей расстановки), добавить туда `labelKk: ""`.

- [ ] **Step 5: Проверить типы**

```bash
./node_modules/.bin/tsc --noEmit 2>&1 | tail -3
```

Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add frontend/entities/dictionary/index.ts frontend/entities/staff-dictionary/index.ts frontend/mocks frontend/hooks/use-staff-dictionaries.ts
git commit -m "feat(front): labelKk/name_kk in dictionary entities and mocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Экран значений ОМ: гейт и поле kk

**Files:**
- Modify: `frontend/app/security-ops/dictionaries/[code]/page.tsx:70` (гейт), `~:50-60` (state формы), `:152-238` (форма добавления), `:245-380` (`EntryCard` редактор), `:381-425` (карточка)

**Interfaces:**
- Consumes: `DictionaryEntry.labelKk`, `labelKk?` в запросах из Task 9.

- [ ] **Step 1: Гейт**

Строку `const canManage = hasPermission("dictionary.manage");` заменить на:

```tsx
  // Значения — отдельное право (UC-REF-001): `dictionary.manage` кнопок не даёт.
  const canManage = hasPermission("dictionary_value.manage");
```

- [ ] **Step 2: Форма добавления**

Рядом с объявлением `const [newLabel, setNewLabel] = useState("");` добавить:

```tsx
  const [newLabelKk, setNewLabelKk] = useState("");
```

После блока `<div className="min-w-56 flex-1 space-y-1">` с `id="entry-label"` вставить:

```tsx
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="entry-label-kk">Название (kk)</Label>
                <Input
                  id="entry-label-kk"
                  value={newLabelKk}
                  onChange={(e) => setNewLabelKk(e.target.value)}
                />
              </div>
```

В вызове `create.mutate({...})` после `label: newLabel,` добавить `labelKk: newLabelKk,`; после `setNewLabel("");` добавить `setNewLabelKk("");`.

- [ ] **Step 3: Редактор в `EntryCard`**

Тип пропа `onSave` в объявлении `EntryCard` (строки ~264-269) расширить полем kk:

```tsx
  onSave: (values: {
    label: string;
    labelKk?: string;
    description: string;
    groupCode?: string | null;
    ownerDivisionId?: string | null;
  }) => Promise<void>;
```

Рядом с `const [label, setLabel] = useState(entry.label);` добавить:

```tsx
  const [labelKk, setLabelKk] = useState(entry.labelKk);
```

После блока `<div className="space-y-1">` с `id={\`label-${entry.id}\`}` вставить:

```tsx
            <div className="space-y-1">
              <Label htmlFor={`label-kk-${entry.id}`}>Название (kk)</Label>
              <Input
                id={`label-kk-${entry.id}`}
                value={labelKk}
                onChange={(e) => setLabelKk(e.target.value)}
              />
            </div>
```

В обработчике кнопки «Отмена» после `setLabel(entry.label);` добавить `setLabelKk(entry.labelKk);`. В объекте `onSave({...})` после `label,` добавить `labelKk,`.

- [ ] **Step 4: Карточка**

После `<span className="font-semibold">{entry.label}</span>` вставить:

```tsx
          {entry.labelKk !== "" && (
            <span className="text-sm text-muted-foreground">{entry.labelKk}</span>
          )}
```

- [ ] **Step 5: Проверить типы**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/frontend
./node_modules/.bin/tsc --noEmit 2>&1 | tail -3
```

Expected: без ошибок. Если тип пропа `onSave` в `EntryCard` объявлен уже, чем `UpdateDictionaryEntryRequest`, расширь его до `UpdateDictionaryEntryRequest`.

- [ ] **Step 6: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add "frontend/app/security-ops/dictionaries/[code]/page.tsx"
git commit -m "feat(front): OM dictionary values gated by dictionary_value.manage, Kazakh label field

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Экран кадровых справочников: гейт и поле kk

**Files:**
- Modify: `frontend/app/security-ops/dictionaries/personnel/[kind]/page.tsx:50-55` (state, гейт), `~:140-205` (форма добавления), `:215-335` (`RowCard`)

**Interfaces:**
- Consumes: `StaffDictionaryRow.name_kk` из Task 9; хуки `useCreateStaffDictionaryRow` (тело `Omit<StaffDictionaryRow, "id">`) и `useUpdateStaffDictionaryRow` (тело `StaffDictionaryRow`) теперь требуют `name_kk`.

- [ ] **Step 1: Гейт и state**

Строку `const canManage = hasPermission("dictionary.manage");` заменить на:

```tsx
  // Значения — отдельное право (UC-REF-001): `dictionary.manage` кнопок не даёт.
  const canManage = hasPermission("dictionary_value.manage");
```

После `const [name, setName] = useState("");` добавить `const [nameKk, setNameKk] = useState("");`.

- [ ] **Step 2: Форма добавления**

В форме добавления (карточка «Добавить значение», строки ~142-186) сетку `<div className="grid gap-3 md:grid-cols-3">` заменить на `md:grid-cols-4`, и после блока `<div className="space-y-1">`, содержащего `<Input id="new-name" ...>` и его `<p id="new-name-error">`, вставить:

```tsx
                <div className="space-y-1">
                  <Label htmlFor="new-name-kk">Название (kk)</Label>
                  <Input
                    id="new-name-kk"
                    value={nameKk}
                    onChange={(e) => setNameKk(e.target.value)}
                  />
                </div>
```

В `create.mutateAsync({...})` после `name,` добавить `name_kk: nameKk,`; после `setName("");` добавить `setNameKk("");`.

- [ ] **Step 3: `RowCard`**

Тип пропа `onSave` заменить на:

```tsx
  onSave: (values: { name: string; name_kk: string; code: string; level: number }) => Promise<void>;
```

После `const [name, setName] = useState(row.name);` добавить `const [nameKk, setNameKk] = useState(row.name_kk);`.

После блока `<div className="space-y-1">` с `id={\`name-${row.id}\`}` вставить:

```tsx
            <div className="space-y-1">
              <Label htmlFor={`name-kk-${row.id}`}>Название (kk)</Label>
              <Input
                id={`name-kk-${row.id}`}
                value={nameKk}
                onChange={(e) => setNameKk(e.target.value)}
              />
            </div>
```

В «Отмена» после `setName(row.name);` добавить `setNameKk(row.name_kk);`. В `onSave({...})` после `name,` добавить `name_kk: nameKk,`.

В строке просмотра после `<span className="font-semibold">{row.name}</span>` вставить:

```tsx
        {row.name_kk !== "" && (
          <span className="text-sm text-muted-foreground">{row.name_kk}</span>
        )}
```

- [ ] **Step 4: Проверить типы**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/frontend
./node_modules/.bin/tsc --noEmit 2>&1 | tail -3
```

Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git add "frontend/app/security-ops/dictionaries/personnel/[kind]/page.tsx"
git commit -m "feat(front): staff dictionaries gated by dictionary_value.manage, Kazakh name field

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Сквозная проверка

**Files:**
- Нет правок кода, кроме починки того, что найдёт проверка.

- [ ] **Step 1: Весь бэкенд**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/backend
export PR_DB_HOST=127.0.0.1 PR_DB_PORT=5300 PR_DB_NAME=smart_josparlau PR_DB_USER=smart_josparlau
export PR_DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' ../../.env)"
PY=.venv/Scripts/python.exe
$PY -m pytest -q 2>&1 | tail -6
```

Expected: все зелёные (кроме отмеченных в Task 1 как сломанные экспортом).

- [ ] **Step 2: Сборка фронта**

```bash
cd ../frontend
./node_modules/.bin/tsc --noEmit 2>&1 | tail -2
NEXTAUTH_SECRET=build-only-placeholder ./node_modules/.bin/next build 2>&1 | tail -15
```

Expected: `tsc` без ошибок; `next build` завершается со списком маршрутов, без `Failed to compile`.

- [ ] **Step 3: Живой стенд с новым бэкендом**

Docker-контейнеры несут старый код; локальный бэкенд поднимается рядом на порту 8001 против той же базы, миграции применяются к ней (новые колонки пустые, старые контейнеры их не читают):

```bash
cd ../backend
$PY manage.py migrate --settings=organization_management.config.settings.local_postgres 2>&1 | tail -4
$PY manage.py runserver 127.0.0.1:8001 --settings=organization_management.config.settings.local_postgres
```

Во втором терминале фронт против него:

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source/frontend
BACKEND_URL=http://127.0.0.1:8001 NEXTAUTH_URL=http://localhost:3000 NEXTAUTH_SECRET=dev-only-secret ./node_modules/.bin/next dev
```

В браузере (Playwright MCP): `http://localhost:3000/`, вход `admin` / `admin12345`, открыть `/security-ops/dictionaries/RETURN_REASONS`, добавить значение с кодом `WEATHER`, названием «Погода» и kk «Ауа райы», убедиться, что карточка показывает оба, затем открыть `/security-ops/dictionaries/personnel/positions`, добавить должность с kk, и `/settings/permissions`, где в каталоге есть «Изменение справочных значений». Снять скриншоты в scratchpad.

Expected: значения с kk видны; каталог прав содержит новый код. Если стенд не поднимается по причинам окружения (NextAuth, CORS), зафиксируй причину в отчёте и оставь шаги 1-2 как подтверждение.

- [ ] **Step 4: Остановить локальные серверы и убрать следы**

Остановить `runserver` и `next dev`; `git status --short` должен быть пуст (папки `.next`, `.venv`, `node_modules` игнорируются).

- [ ] **Step 5: Финальный коммит, если проверка что-то починила**

```bash
cd /c/проекты/smart-josparlau-offline-2026-09-19-1144/lan-1144-2026-09-19-final/source
git status --short
git log --oneline -12
```

Expected: 11 коммитов поверх базового и спеки, дерево чистое.
