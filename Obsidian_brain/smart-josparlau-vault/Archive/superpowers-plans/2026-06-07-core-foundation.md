# Core Context Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete `core` bounded context of VAPS (organizations, divisions, rich employee profiles, history, staffing, vacancies, account↔employee bindings, sensitive-field masking) as a fresh Django project at `Backend/VAPS/`, faithfully implementing `VAPS_7.8.2.md` §4.1, §17.1, §45 read through `RECONCILIATION.md`.

**Architecture:** New greenfield Django + DRF project under `Backend/VAPS/` following the target structure of spec §2.1 (`apps/core/{models,selectors,services,api,tests}`). The existing `Personnel-Records` monolith is a *donor of logic*, not the base (RECONCILIATION G1). Cross-context references are flat UUID/VARCHAR fields — no `ForeignKey` leaves the `core` context (ARCH-002/003). Reads for other contexts go through selectors (ARCH-004). An AST test enforces isolation (ARCH-006).

**Tech Stack:** Python 3.12, Django 5.x, Django REST Framework, pytest + pytest-django. PostgreSQL in production; the test suite runs on SQLite, so UUID primary keys use Django `UUIDField(default=uuid.uuid4)` (not DB `gen_random_uuid()`) and all `CHECK`-style rules (IIN format, gender, height range, employment_status enum, date ordering) are enforced with **app-level validators / model constraints** rather than raw-SQL `CHECK` constraints.

---

## Conventions (read once before Task 1)

These hold for every task. Do not repeat them as steps.

- **App label:** `core`. All models live in `Backend/VAPS/apps/core/models.py` unless a task says otherwise.
- **Table names:** exactly as the spec's `CREATE TABLE` (e.g. `core_employees`) via `class Meta: db_table = "..."`.
- **Base model:** every UUID-PK table subclasses `UUIDTimeStampedModel` (Task 2) which provides `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)`, `created_at`, `updated_at`. Reference tables whose PK is a `VARCHAR` code (`core_division_types`, `core_positions`, `core_ranks`) do **not** use the base; they declare `code = CharField(primary_key=True, max_length=50)`.
- **Cross-context columns** (`user_id`, `created_by`, `uploaded_by`, `permission_code`, …) are `CharField`/`UUIDField`, never `ForeignKey` (ARCH-002/003, BR-ACCOUNT-001).
- **Tests** live in `Backend/VAPS/apps/core/tests/` as `test_<topic>.py`. Run from `Backend/VAPS/`.
- **Timezone:** `Asia/Qyzylorda`, `USE_TZ = True` (TIME-001).
- **Commit** after each task with the message shown in its final step.

---

## File Structure

```
Backend/VAPS/
  manage.py
  pyproject.toml                      # deps + pytest config
  config/
    __init__.py
    settings.py                       # single settings module (SQLite tests / Postgres prod via env)
    urls.py
  apps/
    __init__.py
    core/
      __init__.py
      apps.py
      models.py                       # all core_* models
      validators.py                   # iin_validator, etc.
      selectors.py                    # CoreEmployeeSelector, CoreEmployeeLockSelector,
                                       #   HistoricalEmployeeSelector, CoreDivisionTreeSelector
      services.py                     # full_name sync, history integrity, vacancy calc, masking
      migrations/
        __init__.py
      api/
        __init__.py
        serializers.py
        views.py
        urls.py
      management/commands/
        seed_core.py                  # seed division_types, positions, ranks, sensitive policies
      tests/
        __init__.py
        test_isolation.py             # ARCH-006 AST test
        test_*.py
```

**Responsibility split:** `models.py` = persistence only. `validators.py` = field-level rules reusable by models and serializers. `selectors.py` = read access (the only sanctioned cross-context entry points). `services.py` = write-side invariants and computations that span rows (history overlap, vacancy calc, masking). `api/` = HTTP surface. Keep `models.py` free of business logic beyond `save()`-time `full_name` derivation.

---

## Task 1: Project scaffold

**Files:**
- Create: `Backend/VAPS/pyproject.toml`
- Create: `Backend/VAPS/manage.py`
- Create: `Backend/VAPS/config/__init__.py` (empty)
- Create: `Backend/VAPS/config/settings.py`
- Create: `Backend/VAPS/config/urls.py`
- Create: `Backend/VAPS/apps/__init__.py` (empty)
- Test: `Backend/VAPS/apps/core/tests/test_settings.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "vaps"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "Django>=5.0,<5.2",
    "djangorestframework>=3.15",
    "psycopg[binary]>=3.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-django>=4.8"]

[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "config.settings"
python_files = ["test_*.py"]
testpaths = ["apps"]
```

- [ ] **Step 2: Create `config/settings.py`**

```python
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("VAPS_SECRET_KEY", "dev-insecure-key")
DEBUG = os.environ.get("VAPS_DEBUG", "1") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "apps.core",
]

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = []
WSGI_APPLICATION = None

# Postgres in prod via env; SQLite by default so the suite runs anywhere.
if os.environ.get("VAPS_DB") == "postgres":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["VAPS_DB_NAME"],
            "USER": os.environ["VAPS_DB_USER"],
            "PASSWORD": os.environ.get("VAPS_DB_PASSWORD", ""),
            "HOST": os.environ.get("VAPS_DB_HOST", "localhost"),
            "PORT": os.environ.get("VAPS_DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# TIME-001
TIME_ZONE = "Asia/Qyzylorda"
USE_TZ = True
VAPS_LOCAL_TIMEZONE = "Asia/Qyzylorda"

# BR-EMP-005 default
AUTO_GENERATE_PERSONNEL_NUMBER = os.environ.get("AUTO_GENERATE_PERSONNEL_NUMBER", "false") == "true"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
}
```

- [ ] **Step 3: Create `config/urls.py`**

```python
from django.urls import include, path

urlpatterns = [
    path("api/core/", include("apps.core.api.urls")),
]
```

- [ ] **Step 4: Create `manage.py`**

```python
#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
```

- [ ] **Step 5: Create empty `Backend/VAPS/config/__init__.py` and `Backend/VAPS/apps/__init__.py`**

Both files are empty.

- [ ] **Step 6: Create the core app package skeleton**

Create empty `Backend/VAPS/apps/core/__init__.py`, `Backend/VAPS/apps/core/migrations/__init__.py`, `Backend/VAPS/apps/core/tests/__init__.py`, `Backend/VAPS/apps/core/api/__init__.py`, and:

`Backend/VAPS/apps/core/apps.py`:
```python
from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"
```

`Backend/VAPS/apps/core/models.py` — start with just the base:
```python
import uuid

from django.db import models


class UUIDTimeStampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
```

Create placeholder `Backend/VAPS/apps/core/api/urls.py`:
```python
from django.urls import path

urlpatterns: list[path] = []
```

- [ ] **Step 7: Write the failing settings smoke test**

`Backend/VAPS/apps/core/tests/test_settings.py`:
```python
from django.conf import settings


def test_timezone_is_qyzylorda():
    assert settings.TIME_ZONE == "Asia/Qyzylorda"
    assert settings.USE_TZ is True


def test_core_app_installed():
    assert "apps.core" in settings.INSTALLED_APPS
```

- [ ] **Step 8: Install deps and run the test**

Run (from `Backend/VAPS/`):
```bash
pip install -e ".[dev]"
python -m pytest apps/core/tests/test_settings.py -v
```
Expected: 2 passed.

- [ ] **Step 9: Commit**

```bash
cd Backend/VAPS && git add -A && git commit -m "feat(core): scaffold VAPS target project with config and core app"
```

---

## Task 2: Isolation AST test (ARCH-006)

**Files:**
- Create: `Backend/VAPS/apps/core/tests/test_isolation.py`

This test exists from the start so later contexts (`operations`, etc.) cannot import `core.models` directly. While only `core` exists it still guards `core` against importing a (future) sibling context's models.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_isolation.py`:
```python
import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[3] / "apps"
FORBIDDEN_CROSS_CONTEXT = {"operations", "analytics", "documents", "notifications"}


def _module_files(context: str):
    ctx_dir = APPS_DIR / context
    return [p for p in ctx_dir.rglob("*.py") if "tests" not in p.parts]


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_core_does_not_import_other_context_models():
    offenders = []
    for path in _module_files("core"):
        for mod in _imports(path):
            for ctx in FORBIDDEN_CROSS_CONTEXT:
                if mod.startswith(f"apps.{ctx}.models") or mod.startswith(f"apps.{ctx}"):
                    offenders.append((str(path), mod))
    assert offenders == [], f"core imports forbidden cross-context modules: {offenders}"
```

- [ ] **Step 2: Run it**

Run: `python -m pytest apps/core/tests/test_isolation.py -v`
Expected: PASS (core has no such imports yet — the test documents and locks the rule).

- [ ] **Step 3: Commit**

```bash
git add apps/core/tests/test_isolation.py && git commit -m "test(core): add ARCH-006 cross-context import isolation test"
```

---

## Task 3: `core_organizations` (DB-CORE-001)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_organizations.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_organizations.py`:
```python
import pytest

from apps.core.models import Organization

pytestmark = pytest.mark.django_db


def test_create_organization_with_self_parent():
    parent = Organization.objects.create(name="Главк", code="HQ")
    child = Organization.objects.create(name="Филиал", code="BR1", parent=parent)
    assert child.parent_id == parent.id
    assert child.is_active is True


def test_organization_code_unique():
    Organization.objects.create(name="A", code="DUP")
    with pytest.raises(Exception):
        Organization.objects.create(name="B", code="DUP")
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_organizations.py -v`
Expected: FAIL — `ImportError: cannot import name 'Organization'`.

- [ ] **Step 3: Add the model**

Append to `Backend/VAPS/apps/core/models.py`:
```python
class Organization(UUIDTimeStampedModel):
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_organizations"

    def __str__(self):
        return self.name
```

- [ ] **Step 4: Make and run migration, then test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_organizations.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_organizations model (DB-CORE-001)"
```

---

## Task 4: `core_division_types` + seed (DB-CORE-002)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Create: `Backend/VAPS/apps/core/management/__init__.py`, `Backend/VAPS/apps/core/management/commands/__init__.py`, `Backend/VAPS/apps/core/management/commands/seed_core.py`
- Test: `Backend/VAPS/apps/core/tests/test_division_types.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_division_types.py`:
```python
import pytest
from django.core.management import call_command

from apps.core.models import DivisionType

pytestmark = pytest.mark.django_db


def test_division_type_code_is_primary_key():
    dt = DivisionType.objects.create(code="department", name="Департамент", sort_order=1)
    assert dt.pk == "department"


def test_seed_creates_canonical_division_types():
    call_command("seed_core")
    codes = set(DivisionType.objects.values_list("code", flat=True))
    assert {"department", "management", "division", "office", "group"} <= codes
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_division_types.py -v`
Expected: FAIL — cannot import `DivisionType`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class DivisionType(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_division_types"

    def __str__(self):
        return self.code
```

- [ ] **Step 4: Create the seed command**

Create empty `management/__init__.py` and `management/commands/__init__.py`, then `management/commands/seed_core.py`:
```python
from django.core.management.base import BaseCommand

from apps.core.models import DivisionType

DIVISION_TYPES = [
    ("department", "Департамент", 1),
    ("management", "Управление", 2),
    ("division", "Отдел", 3),
    ("office", "Офис", 4),
    ("group", "Группа", 5),
]


class Command(BaseCommand):
    help = "Seed core reference tables (idempotent)."

    def handle(self, *args, **options):
        for code, name, sort_order in DIVISION_TYPES:
            DivisionType.objects.update_or_create(
                code=code, defaults={"name": name, "sort_order": sort_order}
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_division_types"))
```

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_division_types.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add core_division_types model and seed command (DB-CORE-002)"
```

---

## Task 5: `core_positions` + seed extension (DB-CORE-008)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Modify: `Backend/VAPS/apps/core/management/commands/seed_core.py`
- Test: `Backend/VAPS/apps/core/tests/test_positions.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_positions.py`:
```python
import pytest
from django.core.management import call_command

from apps.core.models import Position

pytestmark = pytest.mark.django_db


def test_position_code_primary_key_and_level():
    p = Position.objects.create(code="NACH_OTD", name="Начальник отдела", level=3, sort_order=10)
    assert p.pk == "NACH_OTD"
    assert p.level == 3


def test_seed_creates_positions():
    call_command("seed_core")
    assert Position.objects.filter(code="OPER").exists()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_positions.py -v`
Expected: FAIL — cannot import `Position`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class Position(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    level = models.IntegerField(default=0)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_positions"

    def __str__(self):
        return self.code
```

- [ ] **Step 4: Extend the seed command**

In `seed_core.py`, add the import `from apps.core.models import DivisionType, Position` (replace the existing import line) and add this block, plus call it in `handle`:
```python
POSITIONS = [
    ("NACH_DEP", "Начальник департамента", 1, 10),
    ("NACH_UPR", "Начальник управления", 2, 20),
    ("NACH_OTD", "Начальник отдела", 3, 30),
    ("OPER", "Оперуполномоченный", 4, 40),
]
```
Add to `handle` after the division-type loop:
```python
        for code, name, level, sort_order in POSITIONS:
            Position.objects.update_or_create(
                code=code, defaults={"name": name, "level": level, "sort_order": sort_order}
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_positions"))
```

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_positions.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add core_positions model and seed (DB-CORE-008)"
```

---

## Task 6: `core_ranks` + seed extension (DB-CORE-009)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Modify: `Backend/VAPS/apps/core/management/commands/seed_core.py`
- Test: `Backend/VAPS/apps/core/tests/test_ranks.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_ranks.py`:
```python
import pytest
from django.core.management import call_command

from apps.core.models import Rank

pytestmark = pytest.mark.django_db


def test_rank_code_primary_key_and_index():
    r = Rank.objects.create(code="MAJOR", name="Майор", category="officer", rank_index=5)
    assert r.pk == "MAJOR"
    assert r.rank_index == 5


def test_seed_creates_ranks_with_indices():
    call_command("seed_core")
    lt = Rank.objects.get(code="LT")
    col = Rank.objects.get(code="COL")
    assert lt.rank_index < col.rank_index
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_ranks.py -v`
Expected: FAIL — cannot import `Rank`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class Rank(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, null=True, blank=True)
    rank_index = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_ranks"

    def __str__(self):
        return self.code
```

- [ ] **Step 4: Extend the seed command**

Update the model import in `seed_core.py` to `from apps.core.models import DivisionType, Position, Rank` and add:
```python
RANKS = [
    ("LT", "Лейтенант", "officer", 10),
    ("CPT", "Капитан", "officer", 20),
    ("MAJOR", "Майор", "officer", 30),
    ("COL", "Полковник", "officer", 40),
]
```
Append to `handle`:
```python
        for code, name, category, rank_index in RANKS:
            Rank.objects.update_or_create(
                code=code,
                defaults={"name": name, "category": category, "rank_index": rank_index},
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_ranks"))
```

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_ranks.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add core_ranks model and seed (DB-CORE-009)"
```

---

## Task 7: `core_divisions` (DB-CORE-003)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_divisions.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_divisions.py`:
```python
import pytest
from django.db import IntegrityError

from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def org():
    return Organization.objects.create(name="Главк", code="HQ")


@pytest.fixture
def dtype():
    return DivisionType.objects.create(code="management", name="Управление")


def test_create_division_tree(org, dtype):
    root = Division.objects.create(organization=org, type_code=dtype, name="УВД", code="UVD")
    child = Division.objects.create(
        organization=org, type_code=dtype, name="Отдел 1", code="OT1", parent=root
    )
    assert child.parent_id == root.id


def test_code_unique_per_organization(org, dtype):
    Division.objects.create(organization=org, type_code=dtype, name="A", code="SAME")
    with pytest.raises(IntegrityError):
        Division.objects.create(organization=org, type_code=dtype, name="B", code="SAME")
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_divisions.py -v`
Expected: FAIL — cannot import `Division`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class Division(UUIDTimeStampedModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="divisions"
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    type_code = models.ForeignKey(
        DivisionType, on_delete=models.PROTECT, db_column="type_code", related_name="divisions"
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_divisions"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="unique_org_division_code"
            )
        ]
        indexes = [
            models.Index(fields=["parent"], name="idx_core_divisions_parent"),
            models.Index(
                fields=["organization", "type_code"], name="idx_core_div_org_type"
            ),
        ]

    def __str__(self):
        return self.name
```

> Note: `on_delete=PROTECT` models the spec's `ON DELETE RESTRICT` for `type_code`.

- [ ] **Step 4: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_divisions.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_divisions model with org-scoped unique code (DB-CORE-003)"
```

---

## Task 8: `CoreDivisionTreeSelector` (ARCH-004, API §1532 leaf-descendants)

**Files:**
- Modify: `Backend/VAPS/apps/core/selectors.py` (create)
- Test: `Backend/VAPS/apps/core/tests/test_division_selector.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_division_selector.py`:
```python
import pytest

from apps.core.models import Division, DivisionType, Organization
from apps.core.selectors import CoreDivisionTreeSelector

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    org = Organization.objects.create(name="Главк", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(organization=org, type_code=dt, name="root", code="R")
    a = Division.objects.create(organization=org, type_code=dt, name="a", code="A", parent=root)
    b = Division.objects.create(organization=org, type_code=dt, name="b", code="B", parent=root)
    a1 = Division.objects.create(organization=org, type_code=dt, name="a1", code="A1", parent=a)
    return {"root": root, "a": a, "b": b, "a1": a1}


def test_leaf_descendants_returns_only_leaves(tree):
    leaves = CoreDivisionTreeSelector.leaf_descendants(tree["root"].id)
    leaf_ids = {d.id for d in leaves}
    assert leaf_ids == {tree["a1"].id, tree["b"].id}


def test_subtree_ids_includes_self_and_all_descendants(tree):
    ids = CoreDivisionTreeSelector.subtree_ids(tree["root"].id)
    assert ids == {tree["root"].id, tree["a"].id, tree["b"].id, tree["a1"].id}
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_division_selector.py -v`
Expected: FAIL — cannot import `selectors`.

- [ ] **Step 3: Implement the selector**

Create `Backend/VAPS/apps/core/selectors.py`:
```python
from apps.core.models import Division


class CoreDivisionTreeSelector:
    """Read-only division tree access. Sanctioned cross-context entry point (ARCH-004)."""

    @staticmethod
    def _children_map():
        children: dict = {}
        for did, parent_id in Division.objects.values_list("id", "parent_id"):
            children.setdefault(parent_id, []).append(did)
        return children

    @classmethod
    def subtree_ids(cls, division_id) -> set:
        children = cls._children_map()
        result, stack = set(), [division_id]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(children.get(current, []))
        return result

    @classmethod
    def leaf_descendants(cls, division_id) -> list:
        children = cls._children_map()
        ids = cls.subtree_ids(division_id)
        leaf_ids = [d for d in ids if not children.get(d)]
        return list(Division.objects.filter(id__in=leaf_ids))
```

- [ ] **Step 4: Run test**

Run: `python -m pytest apps/core/tests/test_division_selector.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add CoreDivisionTreeSelector with leaf_descendants (ARCH-004)"
```

---

## Task 9: `core_employees` rich model + IIN validator + full_name sync (DB-CORE-004, §45.2, BR-EMP-001)

**Files:**
- Create: `Backend/VAPS/apps/core/validators.py`
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_employees.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_employees.py`:
```python
import pytest
from django.core.exceptions import ValidationError

from apps.core.models import Division, DivisionType, Employee, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="Главк", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dt, name="УВД", code="UVD")


def test_full_name_generated_from_parts(division):
    emp = Employee.objects.create(
        iin="900101300123", last_name="Иванов", first_name="Иван", middle_name="Иванович",
        rank_code="MAJOR", position_code="OPER", division=division,
    )
    assert emp.full_name == "Иванов Иван Иванович"


def test_full_name_kept_when_no_parts(division):
    emp = Employee.objects.create(
        iin="900101300124", full_name="Только ФИО",
        rank_code="MAJOR", position_code="OPER", division=division,
    )
    assert emp.full_name == "Только ФИО"


def test_invalid_iin_rejected(division):
    emp = Employee(
        iin="12ab", full_name="X", rank_code="MAJOR", position_code="OPER", division=division,
    )
    with pytest.raises(ValidationError):
        emp.full_clean()


def test_iin_unique(division):
    Employee.objects.create(
        iin="900101300125", full_name="A", rank_code="MAJOR", position_code="OPER", division=division,
    )
    with pytest.raises(Exception):
        Employee.objects.create(
            iin="900101300125", full_name="B", rank_code="MAJOR", position_code="OPER", division=division,
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_employees.py -v`
Expected: FAIL — cannot import `Employee`.

- [ ] **Step 3: Create validators**

`Backend/VAPS/apps/core/validators.py`:
```python
from django.core.validators import RegexValidator

iin_validator = RegexValidator(
    regex=r"^[0-9]{12}$", message="ИИН должен состоять из 12 цифр."
)
```

- [ ] **Step 4: Add the model**

Append to `models.py` (add `from django.core.validators import MinValueValidator, MaxValueValidator` and `from apps.core.validators import iin_validator` at the top of the file):
```python
class Employee(UUIDTimeStampedModel):
    class Gender(models.TextChoices):
        MALE = "M", "Мужской"
        FEMALE = "F", "Женский"

    class EmploymentStatus(models.TextChoices):
        WORKING = "WORKING", "Работает"
        FIRED = "FIRED", "Уволен"
        ARCHIVED = "ARCHIVED", "В архиве"

    external_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    iin = models.CharField(max_length=12, unique=True, validators=[iin_validator])
    full_name = models.CharField(max_length=255)
    rank_code = models.CharField(max_length=50)
    rank_index = models.IntegerField(default=0)
    position_code = models.CharField(max_length=50)
    division = models.ForeignKey(
        Division, on_delete=models.PROTECT, related_name="employees"
    )
    phone = models.CharField(max_length=50, null=True, blank=True)
    gender = models.CharField(max_length=1, choices=Gender.choices, null=True, blank=True)
    height_cm = models.IntegerField(
        null=True, blank=True, validators=[MinValueValidator(120), MaxValueValidator(230)]
    )
    is_active = models.BooleanField(default=True)
    is_attached_force = models.BooleanField(default=False)
    data_source = models.CharField(max_length=50, default="STUB")
    separated_at = models.DateTimeField(null=True, blank=True)

    # §45.2 rich profile
    personnel_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    last_name = models.CharField(max_length=150, null=True, blank=True)
    first_name = models.CharField(max_length=150, null=True, blank=True)
    middle_name = models.CharField(max_length=150, null=True, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    photo_file_path = models.TextField(null=True, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    dismissal_date = models.DateField(null=True, blank=True)
    work_phone = models.CharField(max_length=50, null=True, blank=True)
    work_email = models.CharField(max_length=255, null=True, blank=True)
    personal_phone = models.CharField(max_length=50, null=True, blank=True)
    personal_email = models.CharField(max_length=255, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    employment_status = models.CharField(
        max_length=50, choices=EmploymentStatus.choices, default=EmploymentStatus.WORKING
    )

    class Meta:
        db_table = "core_employees"
        indexes = [
            models.Index(fields=["division", "is_active"], name="idx_emp_div_active"),
            models.Index(fields=["full_name"], name="idx_emp_full_name"),
        ]

    def save(self, *args, **kwargs):
        # BR-EMP-001: derive full_name from parts when present.
        if self.last_name and self.first_name:
            parts = [self.last_name, self.first_name, self.middle_name or ""]
            self.full_name = " ".join(p for p in parts if p).strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_name
```

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_employees.py -v
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add rich core_employees model with IIN validator and full_name sync (DB-CORE-004, §45.2)"
```

---

## Task 10: `core_employee_division_history` + integrity service (DB-CORE-005, BR-CORE-HISTORY-001/002)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Create: `Backend/VAPS/apps/core/services.py`
- Test: `Backend/VAPS/apps/core/tests/test_division_history.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_division_history.py`:
```python
import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import Division, DivisionType, Employee, EmployeeDivisionHistory, Organization
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dt_type = DivisionType.objects.create(code="management", name="Управление")
    d1 = Division.objects.create(organization=org, type_code=dt_type, name="D1", code="D1")
    d2 = Division.objects.create(organization=org, type_code=dt_type, name="D2", code="D2")
    emp = Employee.objects.create(
        iin="900101300200", full_name="Тест", rank_code="MAJOR", position_code="OPER", division=d1
    )
    return emp, d1, d2


def test_assign_closes_previous_open_interval(setup):
    emp, d1, d2 = setup
    t0 = timezone.now() - dt.timedelta(days=10)
    assign_employee_division(emp, d1, starts_at=t0)
    t1 = timezone.now()
    assign_employee_division(emp, d2, starts_at=t1)

    first = EmployeeDivisionHistory.objects.get(employee=emp, division=d1)
    second = EmployeeDivisionHistory.objects.get(employee=emp, division=d2)
    assert first.ends_at == t1            # BR-CORE-HISTORY-001: no overlap
    assert second.ends_at is None
    emp.refresh_from_db()
    assert emp.division_id == d2.id       # BR-CORE-HISTORY-002


def test_starts_after_ends_rejected(setup):
    emp, d1, _ = setup
    now = timezone.now()
    with pytest.raises(ValidationError):
        EmployeeDivisionHistory(
            employee=emp, division=d1, starts_at=now, ends_at=now - dt.timedelta(days=1)
        ).full_clean()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_division_history.py -v`
Expected: FAIL — cannot import `EmployeeDivisionHistory` / `services`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class EmployeeDivisionHistory(UUIDTimeStampedModel):
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="division_history"
    )
    division = models.ForeignKey(Division, on_delete=models.PROTECT, related_name="+")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=50, default="MANUAL")

    class Meta:
        db_table = "core_employee_division_history"
        indexes = [
            models.Index(
                fields=["employee", "starts_at", "ends_at"], name="idx_emp_div_hist_lookup"
            )
        ]

    def clean(self):
        super().clean()
        if self.ends_at is not None and not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")

    def __str__(self):
        return f"{self.employee_id}@{self.division_id}"
```
Add `from django.core.exceptions import ValidationError` to the top of `models.py` if not already present.

- [ ] **Step 4: Create the service**

`Backend/VAPS/apps/core/services.py`:
```python
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.core.models import EmployeeDivisionHistory


@transaction.atomic
def assign_employee_division(employee, division, *, starts_at, source="MANUAL"):
    """Move an employee to a division, maintaining a non-overlapping history.

    BR-CORE-HISTORY-001 (no overlapping intervals), BR-CORE-HISTORY-002
    (current employee.division mirrors the open interval).
    """
    overlap = EmployeeDivisionHistory.objects.filter(
        employee=employee
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=starts_at), starts_at__lt=starts_at)
    # Close the currently-open interval at starts_at.
    open_interval = (
        EmployeeDivisionHistory.objects.select_for_update()
        .filter(employee=employee, ends_at__isnull=True)
        .order_by("-starts_at")
        .first()
    )
    if open_interval:
        if open_interval.starts_at >= starts_at:
            raise ValidationError("New interval starts before the current open interval.")
        open_interval.ends_at = starts_at
        open_interval.full_clean()
        open_interval.save(update_fields=["ends_at"])

    record = EmployeeDivisionHistory(
        employee=employee, division=division, starts_at=starts_at, source=source
    )
    record.full_clean()
    record.save()

    employee.division = division
    employee.save(update_fields=["division", "updated_at"])
    return record
```

> The `overlap` queryset is intentionally unused in MVP logic beyond documentation of intent; the open-interval close guarantees non-overlap. (If a later task needs hard overlap detection on closed intervals, extend here.)

Remove the unused `overlap` block if your linter rejects it; keep only the open-interval close. Replace the `overlap = ...` lines with a comment if so.

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_division_history.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add division history model and assign service (DB-CORE-005)"
```

---

## Task 11: `core_user_employee_bindings` (DB-CORE-006, BR-ACCOUNT)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_bindings.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_bindings.py`:
```python
import pytest

from apps.core.models import (
    Division, DivisionType, Employee, Organization, UserEmployeeBinding,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def employee():
    org = Organization.objects.create(name="HQ", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dt, name="D", code="D")
    return Employee.objects.create(
        iin="900101300300", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )


def test_binding_uses_string_user_id(employee):
    b = UserEmployeeBinding.objects.create(user_id="auth-user-42", employee=employee)
    assert isinstance(b.user_id, str)


def test_user_id_unique(employee):
    UserEmployeeBinding.objects.create(user_id="u1", employee=employee)
    with pytest.raises(Exception):
        UserEmployeeBinding.objects.create(user_id="u1", employee=employee)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_bindings.py -v`
Expected: FAIL — cannot import `UserEmployeeBinding`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class UserEmployeeBinding(UUIDTimeStampedModel):
    # BR-ACCOUNT-001: external auth account id as string, NOT employee UUID.
    user_id = models.CharField(max_length=100, unique=True)
    employee = models.OneToOneField(
        Employee, on_delete=models.CASCADE, related_name="account_binding"
    )

    class Meta:
        db_table = "core_user_employee_bindings"

    def __str__(self):
        return f"{self.user_id}->{self.employee_id}"
```

> `updated_at` is unused by this table per spec, but inheriting it is harmless and keeps the base consistent.

- [ ] **Step 4: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_bindings.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_user_employee_bindings (DB-CORE-006)"
```

---

## Task 12: `core_division_historical_slots` (DB-CORE-007)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_historical_slots.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_historical_slots.py`:
```python
import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, DivisionHistoricalSlot, Organization,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dtp, name="D", code="D")


def test_create_slot_open_interval(division):
    s = DivisionHistoricalSlot.objects.create(
        division=division, allocated_slots=10, valid_from=timezone.now()
    )
    assert s.valid_to is None


def test_negative_allocated_rejected(division):
    s = DivisionHistoricalSlot(
        division=division, allocated_slots=-1, valid_from=timezone.now()
    )
    with pytest.raises(ValidationError):
        s.full_clean()


def test_valid_to_before_from_rejected(division):
    now = timezone.now()
    s = DivisionHistoricalSlot(
        division=division, allocated_slots=1, valid_from=now, valid_to=now - dt.timedelta(days=1)
    )
    with pytest.raises(ValidationError):
        s.full_clean()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_historical_slots.py -v`
Expected: FAIL — cannot import `DivisionHistoricalSlot`.

- [ ] **Step 3: Add the model**

Append to `models.py` (add `from django.core.validators import MinValueValidator` if not already imported):
```python
class DivisionHistoricalSlot(UUIDTimeStampedModel):
    division = models.ForeignKey(
        Division, on_delete=models.CASCADE, related_name="historical_slots"
    )
    allocated_slots = models.IntegerField(validators=[MinValueValidator(0)])
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_division_historical_slots"
        indexes = [
            models.Index(
                fields=["division", "valid_from", "valid_to"], name="idx_core_slots_timeline"
            )
        ]

    def clean(self):
        super().clean()
        if self.valid_to is not None and not (self.valid_from < self.valid_to):
            raise ValidationError("valid_from must be earlier than valid_to")
```

> `updated_at` from the base is unused per spec but harmless.

- [ ] **Step 4: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_historical_slots.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_division_historical_slots (DB-CORE-007)"
```

---

## Task 13: Employee selectors — `CoreEmployeeSelector`, `CoreEmployeeLockSelector`, `HistoricalEmployeeSelector` (ARCH-004, BR-CORE-HISTORY-003, §1059)

**Files:**
- Modify: `Backend/VAPS/apps/core/selectors.py`
- Test: `Backend/VAPS/apps/core/tests/test_employee_selectors.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_employee_selectors.py`:
```python
import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.core.selectors import CoreEmployeeSelector, HistoricalEmployeeSelector
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    d1 = Division.objects.create(organization=org, type_code=dtp, name="D1", code="D1")
    d2 = Division.objects.create(organization=org, type_code=dtp, name="D2", code="D2")
    emp = Employee.objects.create(
        iin="900101300400", full_name="Тест", rank_code="MAJOR", position_code="OPER", division=d1
    )
    return emp, d1, d2


def test_active_employees_in_division_excludes_inactive(setup):
    emp, d1, _ = setup
    Employee.objects.create(
        iin="900101300401", full_name="Inactive", rank_code="MAJOR", position_code="OPER",
        division=d1, is_active=False,
    )
    active = CoreEmployeeSelector.active_in_division(d1.id)
    assert [e.id for e in active] == [emp.id]


def test_historical_division_at_uses_history(setup):
    emp, d1, d2 = setup
    t0 = timezone.now() - dt.timedelta(days=10)
    t1 = timezone.now() - dt.timedelta(days=2)
    assign_employee_division(emp, d1, starts_at=t0)
    assign_employee_division(emp, d2, starts_at=t1)
    # At a point inside the first interval, the historical division is d1.
    at = timezone.now() - dt.timedelta(days=5)
    assert HistoricalEmployeeSelector.division_at(emp.id, at) == d1.id


def test_historical_division_falls_back_to_current_when_no_history(setup, caplog):
    emp, d1, _ = setup
    # No history rows written; fallback to current division (BR-CORE-HISTORY-003).
    result = HistoricalEmployeeSelector.division_at(emp.id, timezone.now())
    assert result == d1.id
    assert any("history" in r.message.lower() for r in caplog.records)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_employee_selectors.py -v`
Expected: FAIL — cannot import the new selectors.

- [ ] **Step 3: Implement the selectors**

Append to `Backend/VAPS/apps/core/selectors.py` (add imports at top: `import logging`, `from django.db.models import Q`, `from apps.core.models import Employee, EmployeeDivisionHistory`):
```python
logger = logging.getLogger("apps.core")


class CoreEmployeeSelector:
    @staticmethod
    def get(employee_id):
        return Employee.objects.get(id=employee_id)

    @staticmethod
    def active_in_division(division_id):
        return list(
            Employee.objects.filter(division_id=division_id, is_active=True).order_by("full_name")
        )


class CoreEmployeeLockSelector:
    @staticmethod
    def lock_employee(employee_id):
        """Row-lock an employee for status/assignment flows (§1059). Use inside a transaction."""
        return Employee.objects.select_for_update().get(id=employee_id)


class HistoricalEmployeeSelector:
    @staticmethod
    def division_at(employee_id, at):
        """Division the employee belonged to at instant `at`.

        BR-CORE-HISTORY-003: if no history exists, return the current
        division_id and log a warning.
        """
        record = (
            EmployeeDivisionHistory.objects.filter(
                employee_id=employee_id, starts_at__lte=at
            )
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=at))
            .order_by("-starts_at")
            .first()
        )
        if record is not None:
            return record.division_id
        logger.warning(
            "No division history for employee %s at %s; falling back to current division.",
            employee_id, at,
        )
        return Employee.objects.values_list("division_id", flat=True).get(id=employee_id)
```

- [ ] **Step 4: Run test**

Run: `python -m pytest apps/core/tests/test_employee_selectors.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add employee selectors with historical fallback (ARCH-004, BR-CORE-HISTORY-003)"
```

---

## Task 14: `core_staffing_slots` (DB-CORE-010)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_staffing_slots.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_staffing_slots.py`:
```python
import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Organization, Position, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division_and_position():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер", level=4)
    return div, pos


def test_create_slot_with_parent(division_and_position):
    div, pos = division_and_position
    parent = StaffingSlot.objects.create(
        division=div, position_code=pos, slot_number="1", valid_from=timezone.now()
    )
    child = StaffingSlot.objects.create(
        division=div, position_code=pos, slot_number="2",
        parent_slot=parent, valid_from=timezone.now(),
    )
    assert child.parent_slot_id == parent.id


def test_valid_to_before_from_rejected(division_and_position):
    div, pos = division_and_position
    now = timezone.now()
    s = StaffingSlot(
        division=div, position_code=pos, valid_from=now, valid_to=now - dt.timedelta(days=1)
    )
    with pytest.raises(ValidationError):
        s.full_clean()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_staffing_slots.py -v`
Expected: FAIL — cannot import `StaffingSlot`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class StaffingSlot(UUIDTimeStampedModel):
    division = models.ForeignKey(
        Division, on_delete=models.CASCADE, related_name="staffing_slots"
    )
    position_code = models.ForeignKey(
        Position, on_delete=models.PROTECT, db_column="position_code", related_name="staffing_slots"
    )
    slot_number = models.CharField(max_length=50, null=True, blank=True)
    parent_slot = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="child_slots"
    )
    is_active = models.BooleanField(default=True)
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_staffing_slots"
        indexes = [
            models.Index(
                fields=["division", "is_active", "valid_from", "valid_to"],
                name="idx_core_staffing_div",
            )
        ]

    def clean(self):
        super().clean()
        if self.valid_to is not None and not (self.valid_from < self.valid_to):
            raise ValidationError("valid_from must be earlier than valid_to")
```

- [ ] **Step 4: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_staffing_slots.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_staffing_slots with parent chain (DB-CORE-010)"
```

---

## Task 15: `core_employee_staffing_assignments` (DB-CORE-011)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Test: `Backend/VAPS/apps/core/tests/test_staffing_assignments.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_staffing_assignments.py`:
```python
import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Employee, EmployeeStaffingAssignment,
    Organization, Position, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def slot_and_employee():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер")
    slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=timezone.now())
    emp = Employee.objects.create(
        iin="900101300500", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    return slot, emp


def test_create_assignment(slot_and_employee):
    slot, emp = slot_and_employee
    a = EmployeeStaffingAssignment.objects.create(
        employee=emp, staffing_slot=slot, starts_at=timezone.now()
    )
    assert a.ends_at is None


def test_starts_after_ends_rejected(slot_and_employee):
    slot, emp = slot_and_employee
    now = timezone.now()
    a = EmployeeStaffingAssignment(
        employee=emp, staffing_slot=slot, starts_at=now, ends_at=now - dt.timedelta(days=1)
    )
    with pytest.raises(ValidationError):
        a.full_clean()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_staffing_assignments.py -v`
Expected: FAIL — cannot import `EmployeeStaffingAssignment`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class EmployeeStaffingAssignment(UUIDTimeStampedModel):
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="staffing_assignments"
    )
    staffing_slot = models.ForeignKey(
        StaffingSlot, on_delete=models.PROTECT, related_name="assignments"
    )
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=50, default="MANUAL")

    class Meta:
        db_table = "core_employee_staffing_assignments"
        indexes = [
            models.Index(
                fields=["employee", "starts_at", "ends_at"], name="idx_core_emp_staffing"
            )
        ]

    def clean(self):
        super().clean()
        if self.ends_at is not None and not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")
```

- [ ] **Step 4: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_staffing_assignments.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add core_employee_staffing_assignments (DB-CORE-011)"
```

---

## Task 16: `core_vacancies` + vacancy calc (DB-CORE-012, BR-CORE-STAFF-002)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Modify: `Backend/VAPS/apps/core/services.py`
- Test: `Backend/VAPS/apps/core/tests/test_vacancies.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_vacancies.py`:
```python
import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Employee, EmployeeStaffingAssignment,
    Organization, Position, StaffingSlot, Vacancy,
)
from apps.core.services import compute_free_slots

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    pos = Position.objects.create(code="OPER", name="Опер")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    return div, pos


def test_vacancy_status_default_open(division):
    div, pos = division
    slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=timezone.now())
    v = Vacancy.objects.create(staffing_slot=slot, opened_at=timezone.now())
    assert v.status_code == "OPEN"


def test_compute_free_slots_excludes_occupied(division):
    div, pos = division
    past = timezone.now() - dt.timedelta(days=30)
    free_slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=past)
    busy_slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=past)
    emp = Employee.objects.create(
        iin="900101300600", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    EmployeeStaffingAssignment.objects.create(
        employee=emp, staffing_slot=busy_slot, starts_at=past
    )
    free = compute_free_slots(div.id, on_date=timezone.now())
    free_ids = {s.id for s in free}
    assert free_slot.id in free_ids
    assert busy_slot.id not in free_ids
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_vacancies.py -v`
Expected: FAIL — cannot import `Vacancy` / `compute_free_slots`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class Vacancy(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Открыта"
        CLOSED = "CLOSED", "Закрыта"
        FROZEN = "FROZEN", "Заморожена"

    staffing_slot = models.ForeignKey(
        StaffingSlot, on_delete=models.CASCADE, related_name="vacancies"
    )
    status_code = models.CharField(max_length=50, choices=Status.choices, default=Status.OPEN)
    opened_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    created_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "core_vacancies"

    def clean(self):
        super().clean()
        if self.closed_at is not None and not (self.opened_at < self.closed_at):
            raise ValidationError("opened_at must be earlier than closed_at")
```

- [ ] **Step 4: Add the vacancy calc service**

Append to `services.py` (add imports `from django.db.models import Q` already present; add `from apps.core.models import StaffingSlot, EmployeeStaffingAssignment`):
```python
def compute_free_slots(division_id, *, on_date):
    """BR-CORE-STAFF-002: a vacancy is a staffing slot with no active assignment on a date.

    Returns active slots valid on `on_date` that have no staffing assignment
    overlapping `on_date`.
    """
    slots = StaffingSlot.objects.filter(
        division_id=division_id, is_active=True, valid_from__lte=on_date
    ).filter(Q(valid_to__isnull=True) | Q(valid_to__gt=on_date))

    occupied_slot_ids = set(
        EmployeeStaffingAssignment.objects.filter(
            staffing_slot__in=slots, starts_at__lte=on_date
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=on_date))
        .values_list("staffing_slot_id", flat=True)
    )
    return [s for s in slots if s.id not in occupied_slot_ids]
```

- [ ] **Step 5: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_vacancies.py -v
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): add core_vacancies and free-slot computation (DB-CORE-012, BR-CORE-STAFF-002)"
```

---

## Task 17: `core_sensitive_field_policies` + masking service (DB-CORE-013, §45.5, BR-PRIVACY-001/002)

**Files:**
- Modify: `Backend/VAPS/apps/core/models.py`
- Modify: `Backend/VAPS/apps/core/services.py`
- Modify: `Backend/VAPS/apps/core/management/commands/seed_core.py`
- Test: `Backend/VAPS/apps/core/tests/test_masking.py`

> The policy stores `permission_code` as a flat `VARCHAR` (ARCH-003) — `core` does **not** import the `operations` RBAC tables. The masking service receives the caller's permission set as a parameter; wiring that set from real RBAC belongs to a later operations/API-integration plan.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_masking.py`:
```python
import pytest
from django.core.management import call_command

from apps.core.models import SensitiveFieldPolicy
from apps.core.services import mask_employee_data

pytestmark = pytest.mark.django_db


def test_seed_creates_iin_policy():
    call_command("seed_core")
    assert SensitiveFieldPolicy.objects.filter(field_code="iin").exists()


def test_iin_masked_without_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin", permission_code="employee.sensitive.view", mask_strategy="PARTIAL_MASK"
    )
    data = {"full_name": "Иванов", "iin": "900101300123"}
    masked = mask_employee_data(data, user_permissions=set())
    assert masked["full_name"] == "Иванов"
    assert masked["iin"] != "900101300123"
    assert masked["iin"].endswith("0123")  # partial mask keeps last 4


def test_iin_visible_with_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin", permission_code="employee.sensitive.view", mask_strategy="PARTIAL_MASK"
    )
    data = {"iin": "900101300123"}
    masked = mask_employee_data(data, user_permissions={"employee.sensitive.view"})
    assert masked["iin"] == "900101300123"


def test_full_hide_strategy():
    SensitiveFieldPolicy.objects.create(
        field_code="notes", permission_code="employee.sensitive.view", mask_strategy="FULL_HIDE"
    )
    masked = mask_employee_data({"notes": "secret"}, user_permissions=set())
    assert masked["notes"] is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_masking.py -v`
Expected: FAIL — cannot import `SensitiveFieldPolicy` / `mask_employee_data`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class SensitiveFieldPolicy(UUIDTimeStampedModel):
    class Strategy(models.TextChoices):
        FULL_HIDE = "FULL_HIDE", "Скрыть полностью"
        PARTIAL_MASK = "PARTIAL_MASK", "Частично маскировать"
        ALLOW = "ALLOW", "Разрешить"

    field_code = models.CharField(max_length=100)
    permission_code = models.CharField(max_length=100)
    mask_strategy = models.CharField(max_length=50, choices=Strategy.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_sensitive_field_policies"
        constraints = [
            models.UniqueConstraint(
                fields=["field_code", "permission_code"], name="unique_sensitive_policy"
            )
        ]
```

- [ ] **Step 4: Add the masking service**

Append to `services.py` (add `from apps.core.models import SensitiveFieldPolicy`):
```python
def _partial_mask(value: str) -> str:
    text = str(value)
    if len(text) <= 4:
        return "*" * len(text)
    return "*" * (len(text) - 4) + text[-4:]


def mask_employee_data(data: dict, *, user_permissions: set) -> dict:
    """Apply sensitive-field policies to a serialized employee dict.

    BR-PRIVACY-001/002: a field is revealed only if the caller holds the
    policy's permission_code; otherwise FULL_HIDE -> None, PARTIAL_MASK -> tail-masked.
    """
    result = dict(data)
    policies = SensitiveFieldPolicy.objects.filter(is_active=True)
    for policy in policies:
        if policy.field_code not in result or result[policy.field_code] is None:
            continue
        if policy.permission_code in user_permissions or policy.mask_strategy == "ALLOW":
            continue
        if policy.mask_strategy == "FULL_HIDE":
            result[policy.field_code] = None
        elif policy.mask_strategy == "PARTIAL_MASK":
            result[policy.field_code] = _partial_mask(result[policy.field_code])
    return result
```

- [ ] **Step 5: Extend the seed command**

In `seed_core.py` update the model import to include `SensitiveFieldPolicy` and add:
```python
SENSITIVE_FIELDS = [
    "iin", "photo_file_path", "work_phone", "personal_phone", "work_email",
    "personal_email", "birth_date", "notes",
]
```
Append to `handle`:
```python
        for field_code in SENSITIVE_FIELDS:
            strategy = "PARTIAL_MASK" if field_code == "iin" else "FULL_HIDE"
            SensitiveFieldPolicy.objects.update_or_create(
                field_code=field_code,
                permission_code="employee.sensitive.view",
                defaults={"mask_strategy": strategy},
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_sensitive_field_policies"))
```

- [ ] **Step 6: Migrate and run test**

Run:
```bash
python manage.py makemigrations core
python -m pytest apps/core/tests/test_masking.py -v
```
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core): add sensitive-field policies and masking service (DB-CORE-013, §45.5)"
```

---

## Task 18: Employee API — list/detail/patch/archive/restore/sensitive-fields (§45.6)

**Files:**
- Create: `Backend/VAPS/apps/core/api/serializers.py`
- Create: `Backend/VAPS/apps/core/api/views.py`
- Test: `Backend/VAPS/apps/core/tests/test_employee_api.py`

> Filters: `search` (full_name OR name parts OR personnel_number, BR-EMP-003), `division_id`, `status`, `rank_code`, `position_code`. Caller permissions for masking are read from a request header `X-User-Permissions` (comma-separated) as an MVP stand-in until RBAC is wired — documented as a stub.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_employee_api.py`:
```python
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dtp, name="D", code="D")


@pytest.fixture
def employee(division):
    call_command("seed_core")
    return Employee.objects.create(
        iin="900101300700", last_name="Иванов", first_name="Иван",
        rank_code="MAJOR", position_code="OPER", division=division,
    )


def test_list_masks_iin_by_default(client, employee):
    resp = client.get("/api/core/employees/")
    assert resp.status_code == 200
    row = resp.json()["results"][0]
    assert row["iin"] != "900101300700"


def test_list_filter_by_division(client, employee, division):
    resp = client.get(f"/api/core/employees/?division_id={division.id}")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 1


def test_search_by_last_name(client, employee):
    resp = client.get("/api/core/employees/?search=Иванов")
    assert len(resp.json()["results"]) == 1


def test_detail_with_permission_reveals_iin(client, employee):
    resp = client.get(
        f"/api/core/employees/{employee.id}/",
        HTTP_X_USER_PERMISSIONS="employee.sensitive.view",
    )
    assert resp.json()["iin"] == "900101300700"


def test_patch_updates_phone(client, employee):
    resp = client.patch(
        f"/api/core/employees/{employee.id}/", {"work_phone": "+7700"}, format="json"
    )
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.work_phone == "+7700"


def test_archive_sets_status_and_inactive(client, employee):
    resp = client.post(f"/api/core/employees/{employee.id}/archive/")
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.employment_status == "ARCHIVED"
    assert employee.is_active is False


def test_restore_reactivates(client, employee):
    client.post(f"/api/core/employees/{employee.id}/archive/")
    resp = client.post(f"/api/core/employees/{employee.id}/restore/")
    assert resp.status_code == 200
    employee.refresh_from_db()
    assert employee.employment_status == "WORKING"
    assert employee.is_active is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_employee_api.py -v`
Expected: FAIL — 404 / import errors (views not wired).

- [ ] **Step 3: Create the serializer**

`Backend/VAPS/apps/core/api/serializers.py`:
```python
from rest_framework import serializers

from apps.core.models import Employee


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = [
            "id", "external_id", "iin", "full_name", "last_name", "first_name", "middle_name",
            "rank_code", "rank_index", "position_code", "division", "phone", "gender",
            "height_cm", "is_active", "is_attached_force", "data_source", "personnel_number",
            "birth_date", "photo_file_path", "hire_date", "dismissal_date", "work_phone",
            "work_email", "personal_phone", "personal_email", "notes", "employment_status",
        ]
        read_only_fields = ["id", "full_name", "rank_index"]
```

- [ ] **Step 4: Create the views**

`Backend/VAPS/apps/core/api/views.py`:
```python
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.core.api.serializers import EmployeeSerializer
from apps.core.models import Employee
from apps.core.services import mask_employee_data


class DefaultPagination(PageNumberPagination):
    page_size = 50


def _permissions_from_request(request) -> set:
    raw = request.headers.get("X-User-Permissions", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


class EmployeeViewSet(viewsets.ModelViewSet):
    serializer_class = EmployeeSerializer
    pagination_class = DefaultPagination
    http_method_names = ["get", "patch", "post"]

    def get_queryset(self):
        qs = Employee.objects.all().order_by("full_name")
        params = self.request.query_params
        if division_id := params.get("division_id"):
            qs = qs.filter(division_id=division_id)
        if status_code := params.get("status"):
            qs = qs.filter(employment_status=status_code)
        if rank_code := params.get("rank_code"):
            qs = qs.filter(rank_code=rank_code)
        if position_code := params.get("position_code"):
            qs = qs.filter(position_code=position_code)
        if search := params.get("search"):
            from django.db.models import Q
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(personnel_number__icontains=search)
            )
        return qs

    def _mask(self, data):
        return mask_employee_data(data, user_permissions=_permissions_from_request(self.request))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        serialized = [self._mask(EmployeeSerializer(e).data) for e in page]
        return self.get_paginated_response(serialized)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(self._mask(EmployeeSerializer(instance).data))

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.ARCHIVED
        emp.is_active = False
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def restore(self, request, *args, **kwargs):
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.WORKING
        emp.is_active = True
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK)
```

- [ ] **Step 5: Wire the URL (employees only for now)**

Replace `Backend/VAPS/apps/core/api/urls.py`:
```python
from rest_framework.routers import DefaultRouter

from apps.core.api.views import EmployeeViewSet

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")

urlpatterns = router.urls
```

- [ ] **Step 6: Run test**

Run: `python -m pytest apps/core/tests/test_employee_api.py -v`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core): add employee API with filters, masking, archive/restore (§45.6)"
```

---

## Task 19: Division API — CRUD + tree + leaf-descendants (§1532)

**Files:**
- Modify: `Backend/VAPS/apps/core/api/serializers.py`
- Modify: `Backend/VAPS/apps/core/api/views.py`
- Modify: `Backend/VAPS/apps/core/api/urls.py`
- Test: `Backend/VAPS/apps/core/tests/test_division_api.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_division_api.py`:
```python
import pytest
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def tree():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(organization=org, type_code=dtp, name="root", code="R")
    a = Division.objects.create(organization=org, type_code=dtp, name="a", code="A", parent=root)
    a1 = Division.objects.create(organization=org, type_code=dtp, name="a1", code="A1", parent=a)
    return root, a, a1


def test_list_divisions(client, tree):
    resp = client.get("/api/core/divisions/")
    assert resp.status_code == 200
    assert resp.json()["count"] == 3


def test_leaf_descendants_endpoint(client, tree):
    root, a, a1 = tree
    resp = client.get(f"/api/core/divisions/{root.id}/leaf-descendants/")
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert ids == {str(a1.id)}
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_division_api.py -v`
Expected: FAIL — 404 (divisions route not registered).

- [ ] **Step 3: Add the serializer**

Append to `Backend/VAPS/apps/core/api/serializers.py`:
```python
from apps.core.models import Division


class DivisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Division
        fields = [
            "id", "organization", "parent", "type_code", "name", "code", "is_active",
        ]
        read_only_fields = ["id"]
```

- [ ] **Step 4: Add the view**

Append to `Backend/VAPS/apps/core/api/views.py` (add imports `from apps.core.api.serializers import DivisionSerializer`, `from apps.core.models import Division`, `from apps.core.selectors import CoreDivisionTreeSelector`):
```python
class DivisionViewSet(viewsets.ModelViewSet):
    serializer_class = DivisionSerializer
    pagination_class = DefaultPagination
    queryset = Division.objects.all().order_by("name")

    @action(detail=True, methods=["get"], url_path="leaf-descendants")
    def leaf_descendants(self, request, *args, **kwargs):
        division = self.get_object()
        leaves = CoreDivisionTreeSelector.leaf_descendants(division.id)
        return Response(DivisionSerializer(leaves, many=True).data)
```

- [ ] **Step 5: Register the route**

In `Backend/VAPS/apps/core/api/urls.py`, add:
```python
from apps.core.api.views import DivisionViewSet, EmployeeViewSet
```
(replace the existing import) and add:
```python
router.register("divisions", DivisionViewSet, basename="division")
```

- [ ] **Step 6: Run test**

Run: `python -m pytest apps/core/tests/test_division_api.py -v`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core): add division API with leaf-descendants endpoint (§1532)"
```

---

## Task 20: Staffing/positions/ranks/vacancies API (§3117–3122)

**Files:**
- Modify: `Backend/VAPS/apps/core/api/serializers.py`
- Modify: `Backend/VAPS/apps/core/api/views.py`
- Modify: `Backend/VAPS/apps/core/api/urls.py`
- Test: `Backend/VAPS/apps/core/tests/test_staffing_api.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/core/tests/test_staffing_api.py`:
```python
import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Division, DivisionType, Employee, Organization, Position, Rank, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер")
    Rank.objects.create(code="MAJOR", name="Майор", rank_index=30)
    return div, pos


def test_list_positions(client, env):
    resp = client.get("/api/core/positions/")
    assert resp.status_code == 200
    assert any(p["code"] == "OPER" for p in resp.json()["results"])


def test_assign_and_release_slot(client, env):
    div, pos = env
    slot = StaffingSlot.objects.create(
        division=div, position_code=pos, valid_from=timezone.now() - dt.timedelta(days=1)
    )
    emp = Employee.objects.create(
        iin="900101300800", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    resp = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)}, format="json",
    )
    assert resp.status_code == 201
    resp2 = client.post(f"/api/core/staffing-slots/{slot.id}/release/")
    assert resp2.status_code == 200


def test_vacancies_endpoint(client, env):
    div, pos = env
    StaffingSlot.objects.create(
        division=div, position_code=pos, valid_from=timezone.now() - dt.timedelta(days=1)
    )
    today = timezone.now().date().isoformat()
    resp = client.get(f"/api/core/vacancies/?division_id={div.id}&date={today}")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest apps/core/tests/test_staffing_api.py -v`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Add serializers**

Append to `serializers.py`:
```python
from apps.core.models import EmployeeStaffingAssignment, Position, Rank, StaffingSlot


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ["code", "name", "level", "sort_order", "is_active"]


class RankSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rank
        fields = ["code", "name", "category", "rank_index", "is_active"]


class StaffingSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffingSlot
        fields = [
            "id", "division", "position_code", "slot_number", "parent_slot",
            "is_active", "valid_from", "valid_to",
        ]
        read_only_fields = ["id"]


class StaffingAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeStaffingAssignment
        fields = ["id", "employee", "staffing_slot", "starts_at", "ends_at", "source"]
        read_only_fields = ["id"]
```

- [ ] **Step 4: Add views**

Append to `views.py` (add imports: `from django.utils.dateparse import parse_date`, `from django.utils import timezone`, `import datetime as dt`, plus model/serializer/service imports `from apps.core.models import EmployeeStaffingAssignment, Position, Rank, StaffingSlot`, `from apps.core.api.serializers import (PositionSerializer, RankSerializer, StaffingSlotSerializer, StaffingAssignmentSerializer)`, `from apps.core.services import compute_free_slots`):
```python
class PositionViewSet(viewsets.ModelViewSet):
    serializer_class = PositionSerializer
    pagination_class = DefaultPagination
    queryset = Position.objects.all().order_by("sort_order")
    http_method_names = ["get", "post", "patch"]


class RankViewSet(viewsets.ModelViewSet):
    serializer_class = RankSerializer
    pagination_class = DefaultPagination
    queryset = Rank.objects.all().order_by("rank_index")
    http_method_names = ["get", "post", "patch"]


class StaffingSlotViewSet(viewsets.ModelViewSet):
    serializer_class = StaffingSlotSerializer
    pagination_class = DefaultPagination
    queryset = StaffingSlot.objects.all().order_by("valid_from")
    http_method_names = ["get", "post", "patch"]

    @action(detail=True, methods=["post"], url_path="assign-employee")
    def assign_employee(self, request, *args, **kwargs):
        slot = self.get_object()
        assignment = EmployeeStaffingAssignment.objects.create(
            employee_id=request.data["employee_id"],
            staffing_slot=slot,
            starts_at=timezone.now(),
        )
        return Response(
            StaffingAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def release(self, request, *args, **kwargs):
        slot = self.get_object()
        EmployeeStaffingAssignment.objects.filter(
            staffing_slot=slot, ends_at__isnull=True
        ).update(ends_at=timezone.now())
        return Response({"released": True}, status=status.HTTP_200_OK)


class VacancyViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        division_id = request.query_params.get("division_id")
        date_str = request.query_params.get("date")
        on_date = (
            timezone.make_aware(
                dt.datetime.combine(parse_date(date_str), dt.time.min)
            )
            if date_str
            else timezone.now()
        )
        free = compute_free_slots(division_id, on_date=on_date)
        return Response(
            {"count": len(free), "results": StaffingSlotSerializer(free, many=True).data}
        )
```

- [ ] **Step 5: Register routes**

In `urls.py`, update the views import to include the new viewsets and register:
```python
from apps.core.api.views import (
    DivisionViewSet, EmployeeViewSet, PositionViewSet, RankViewSet,
    StaffingSlotViewSet, VacancyViewSet,
)
```
Add:
```python
router.register("positions", PositionViewSet, basename="position")
router.register("ranks", RankViewSet, basename="rank")
router.register("staffing-slots", StaffingSlotViewSet, basename="staffing-slot")
router.register("vacancies", VacancyViewSet, basename="vacancy")
```

- [ ] **Step 6: Run test**

Run: `python -m pytest apps/core/tests/test_staffing_api.py -v`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core): add positions/ranks/staffing-slots/vacancies API (§3117-3122)"
```

---

## Task 21: Full-suite green + isolation re-check + README

**Files:**
- Create: `Backend/VAPS/README.md`
- Test: full suite

- [ ] **Step 1: Run the entire core test suite**

Run (from `Backend/VAPS/`):
```bash
python -m pytest apps -v
```
Expected: all tests from Tasks 1–20 pass; the ARCH-006 isolation test (`test_isolation.py`) passes.

- [ ] **Step 2: Run migrations check (no missing migrations)**

Run:
```bash
python manage.py makemigrations --check --dry-run
```
Expected: "No changes detected".

- [ ] **Step 3: Write `README.md`**

`Backend/VAPS/README.md`:
```markdown
# VAPS — target project (core context)

Greenfield Django project implementing the `core` bounded context of VAPS
per `docs/PersonnelStatus/VAPS_7.8.2.md` read through `docs/RECONCILIATION.md`.

## Setup

    pip install -e ".[dev]"
    python manage.py migrate
    python manage.py seed_core      # reference data: division types, positions, ranks, policies

## Tests

    python -m pytest apps

Tests run on SQLite. Production uses PostgreSQL (set `VAPS_DB=postgres` + `VAPS_DB_*` env vars).

## Layout

- `apps/core/models.py` — `core_*` tables (DB-CORE-001..013)
- `apps/core/selectors.py` — sanctioned cross-context reads (ARCH-004)
- `apps/core/services.py` — division history, vacancy calc, sensitive-field masking
- `apps/core/api/` — `/api/core/` REST surface
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(core): add README and verify full core suite green"
```

---

## Self-Review (completed during planning)

**Spec coverage check (§4.1, §17.1, §45 vs tasks):**
- DB-CORE-001 organizations → Task 3 ✓
- DB-CORE-002 division_types + seed → Task 4 ✓
- DB-CORE-003 divisions → Task 7 ✓
- DB-CORE-004 + §45.2 rich employees → Task 9 ✓
- DB-CORE-005 division history + BR-CORE-HISTORY-001/002 → Task 10 ✓
- DB-CORE-006 user-employee bindings + BR-ACCOUNT → Task 11 ✓
- DB-CORE-007 historical slots → Task 12 ✓
- DB-CORE-008 positions → Task 5 ✓
- DB-CORE-009 ranks → Task 6 ✓
- DB-CORE-010 staffing slots → Task 14 ✓
- DB-CORE-011 staffing assignments → Task 15 ✓
- DB-CORE-012 vacancies + BR-CORE-STAFF-002 → Task 16 ✓
- DB-CORE-013 + §45.5 masking → Task 17 ✓
- Selectors ARCH-004 (Division tree, Employee, Lock, Historical incl. BR-CORE-HISTORY-003) → Tasks 8, 13 ✓
- ARCH-006 isolation test → Task 2 ✓
- API §45.6 (employees) → Task 18 ✓; §1532 leaf-descendants → Task 19 ✓; §3117–3122 staffing → Task 20 ✓
- BR-EMP-001 full_name sync → Task 9 ✓; BR-EMP-005 AUTO_GENERATE_PERSONNEL_NUMBER setting → Task 1 (flag present; generation logic is out of MVP scope, default false) ✓

**Deferred / out of scope (documented, not silently dropped):**
- RBAC tables (`ops_*`) and real permission resolution — masking accepts a caller-supplied permission set via `X-User-Permissions` header stub; full wiring belongs to the operations-context plan.
- `external_id`-based KU sync (RECONCILIATION R5) — `data_source`/`external_id` columns exist; sync logic is future.
- Data migration from the donor monolith (RECONCILIATION G1-доп) — separate plan.
- Postgres-specific `gen_random_uuid()` / regex `CHECK` — intentionally replaced by app-level validators per the chosen SQLite-testable approach.

**Type consistency:** `compute_free_slots`, `assign_employee_division`, `mask_employee_data`, `CoreDivisionTreeSelector.leaf_descendants/subtree_ids`, `HistoricalEmployeeSelector.division_at`, `CoreEmployeeLockSelector.lock_employee` are referenced with identical signatures everywhere they appear.

**Note for implementer (Task 10):** the `overlap` queryset in `assign_employee_division` is illustrative; the open-interval close is what guarantees non-overlap. Delete the unused `overlap = ...` lines if your linter flags them — behavior is unchanged.
