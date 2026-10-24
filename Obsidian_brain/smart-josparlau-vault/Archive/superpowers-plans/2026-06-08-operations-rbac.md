# Operations Context — RBAC Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the RBAC slice of the `operations` bounded context (roles, permissions, role→permission mapping, division-scoped user-role assignments, time-bounded temporary duty permissions, a single `PermissionService.has_permission`, and an admin REST API) as a new Django app `apps/operations/` in the existing `Backend/VAPS/` project.

**Architecture:** New app `apps/operations` alongside `apps/core`, mounted at `/api/operations/`. Authorization is resolved at request time by a stateless `PermissionService` that reads `ops_*` tables, honors the `*` wildcard (ADMIN), division scope, and active temporary-duty windows. Division-scope resolution is the only cross-context read and goes through `core.selectors.CoreDivisionTreeSelector` (ARCH-004); operations never imports `core.models`. Everything is keyed on the external `user_id` string, never `core_employees.id` (ARCH-007, BR-ACCOUNT-002).

**Tech Stack:** Python 3.12, Django 5.x, Django REST Framework, pytest + pytest-django. Tests run on SQLite; production on PostgreSQL. The three surrogate-PK tables use integer `BigAutoField` PKs; all cross-context reference columns (`scope_division_id`, `employee_id`, `event_id`) are `UUIDField`. `CHECK`-style rules are enforced with app-level validators / `clean()`.

**Spec basis:** `docs/PersonnelStatus/VAPS_7.8.2.md` §4.2 (DB-OPS-001), §17.20 (DB-OPS-038), §6 (§1248–1257), STORY-003 (§8087); `docs/RECONCILIATION.md` R3. Design: `docs/superpowers/specs/2026-06-08-operations-rbac-design.md`.

---

## Conventions (read once before Task 1)

These hold for every task. Do not repeat them as steps.

- **App label:** `operations`. Models live in `Backend/VAPS/apps/operations/models.py` unless a task says otherwise.
- **Table names:** exactly as the spec's `CREATE TABLE` (e.g. `ops_roles`) via `class Meta: db_table = "..."`.
- **Base model:** the three surrogate-PK tables (`RolePermission`, `UserRole`, `TemporaryDutyPermission`) subclass `TimeStampedModel` (Task 2), which provides only `created_at` / `updated_at` and leaves Django's default integer `BigAutoField` PK in place. `Role` and `Permission` declare `code = CharField(primary_key=True, ...)` and use no base.
- **Cross-context columns** (`user_id`, `created_by`, `scope_division_id`, `employee_id`, `event_id`) are `CharField`/`UUIDField`, never `ForeignKey` across the context boundary (ARCH-002/003, BR-ACCOUNT-001).
- **Cross-context reads** go only through `apps.core.selectors`. Never import `apps.core.models` from `apps.operations`.
- **Tests** live in `Backend/VAPS/apps/operations/tests/` as `test_<topic>.py`. Run from `Backend/VAPS/` using the project venv: `./.venv/bin/python -m pytest ...`.
- **`makemigrations`** uses `./.venv/bin/python manage.py makemigrations operations`.
- **Timezone:** `Asia/Qyzylorda`, `USE_TZ = True` (already configured project-wide).
- **Commit** after each task with the message shown in its final step.

---

## File Structure

```
Backend/VAPS/apps/operations/
  __init__.py
  apps.py                         # OperationsConfig (label="operations")
  models.py                       # TimeStampedModel + ops_* models
  validators.py                   # duty_role_code choices validator
  selectors.py                    # OpsUserRoleSelector (read access to assignments)
  services.py                     # PermissionService + write wrappers
  migrations/__init__.py
  api/
    __init__.py
    identity.py                   # X-User-Id header helper
    permissions.py                # HasOpsPermission DRF permission class
    serializers.py
    views.py
    urls.py
  management/__init__.py
  management/commands/__init__.py
  management/commands/seed_operations.py
  tests/
    __init__.py
    test_isolation.py
    test_*.py
```

**Responsibility split:** `models.py` = persistence + `clean()` validation only. `validators.py` = reusable field rules. `selectors.py` = sanctioned read access. `services.py` = `PermissionService` (resolution) and thin write wrappers. `api/` = HTTP surface, with identity and the permission class split into their own focused modules.

---

## Task 1: Operations app scaffold

**Files:**
- Create: `Backend/VAPS/apps/operations/__init__.py` (empty)
- Create: `Backend/VAPS/apps/operations/apps.py`
- Create: `Backend/VAPS/apps/operations/migrations/__init__.py` (empty)
- Create: `Backend/VAPS/apps/operations/tests/__init__.py` (empty)
- Create: `Backend/VAPS/apps/operations/api/__init__.py` (empty)
- Create: `Backend/VAPS/apps/operations/api/urls.py`
- Modify: `Backend/VAPS/config/settings.py`
- Modify: `Backend/VAPS/config/urls.py`
- Test: `Backend/VAPS/apps/operations/tests/test_app.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_app.py`:
```python
from django.conf import settings


def test_operations_app_installed():
    assert "apps.operations" in settings.INSTALLED_APPS


def test_operations_urls_mounted():
    from django.urls import reverse, NoReverseMatch
    # The router has no routes yet; mounting is verified in later API tasks.
    # Here we only assert the include resolves without import error.
    import apps.operations.api.urls as ops_urls
    assert hasattr(ops_urls, "urlpatterns")
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.operations'`.

- [ ] **Step 3: Create the app package and config**

`Backend/VAPS/apps/operations/apps.py`:
```python
from django.apps import AppConfig


class OperationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.operations"
    label = "operations"
```

`Backend/VAPS/apps/operations/api/urls.py`:
```python
from rest_framework.routers import DefaultRouter

router = DefaultRouter()

urlpatterns = router.urls
```

Create empty `__init__.py` files at `apps/operations/`, `apps/operations/migrations/`, `apps/operations/tests/`, and `apps/operations/api/`.

- [ ] **Step 4: Register the app and mount its URLs**

In `Backend/VAPS/config/settings.py`, add `"apps.operations",` to `INSTALLED_APPS` immediately after `"apps.core",`:
```python
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "apps.core",
    "apps.operations",
]
```

In `Backend/VAPS/config/urls.py`, add the operations include:
```python
from django.urls import include, path

urlpatterns = [
    path("api/core/", include("apps.core.api.urls")),
    path("api/operations/", include("apps.operations.api.urls")),
]
```

- [ ] **Step 5: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_app.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): scaffold operations app mounted at /api/operations/"
```

---

## Task 2: Isolation AST test + `TimeStampedModel` base (ARCH-004/006)

**Files:**
- Create: `Backend/VAPS/apps/operations/tests/test_isolation.py`
- Modify: `Backend/VAPS/apps/operations/models.py` (create)

This test exists from the start so the operations context cannot import `core.models` directly. It explicitly **allows** `apps.core.selectors` (the sanctioned cross-context entry point, ARCH-004) and forbids `apps.core.models`.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_isolation.py`:
```python
import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[2]


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


def test_operations_does_not_import_core_models():
    offenders = []
    for path in _module_files("operations"):
        for mod in _imports(path):
            if mod == "apps.core.models" or mod.startswith("apps.core.models."):
                offenders.append((str(path), mod))
    assert offenders == [], f"operations imports core.models directly: {offenders}"


def test_operations_may_import_core_selectors():
    # Sanity guard for the rule's intent: core.selectors is the sanctioned read path.
    assert "apps.core.selectors".startswith("apps.core.")
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_isolation.py -v`
Expected: FAIL — `models.py` does not exist yet, so `_module_files("operations")` parsing a missing import path or the test collection errors. (If it errors on no `models.py`, that is the failing state; Step 3 fixes it.)

- [ ] **Step 3: Create `models.py` with the base**

`Backend/VAPS/apps/operations/models.py`:
```python
from django.db import models


class TimeStampedModel(models.Model):
    """Integer-PK base with timestamps. Operations surrogate-PK tables use this.

    Deliberately does NOT subclass core's UUIDTimeStampedModel: operations
    surrogate PKs are integer BigAutoField (project decision), while
    cross-context reference columns remain UUIDField.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
```

- [ ] **Step 4: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_isolation.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(operations): add core.models isolation test and TimeStampedModel base (ARCH-004/006)"
```

---

## Task 3: `Role` and `Permission` reference tables (DB-OPS-001)

**Files:**
- Modify: `Backend/VAPS/apps/operations/models.py`
- Test: `Backend/VAPS/apps/operations/tests/test_roles_permissions.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_roles_permissions.py`:
```python
import pytest

from apps.operations.models import Permission, Role

pytestmark = pytest.mark.django_db


def test_role_code_is_primary_key():
    role = Role.objects.create(code="ADMIN", name="Администратор")
    assert role.pk == "ADMIN"
    assert role.is_active is True


def test_permission_code_is_primary_key():
    perm = Permission.objects.create(code="admin.roles", name="Управление ролями")
    assert perm.pk == "admin.roles"


def test_wildcard_permission_row_allowed():
    perm = Permission.objects.create(code="*", name="Все права")
    assert perm.pk == "*"
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_roles_permissions.py -v`
Expected: FAIL — cannot import `Role` / `Permission`.

- [ ] **Step 3: Add the models**

Append to `Backend/VAPS/apps/operations/models.py`:
```python
class Role(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_roles"

    def __str__(self):
        return self.code


class Permission(models.Model):
    code = models.CharField(primary_key=True, max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_permissions"

    def __str__(self):
        return self.code
```

- [ ] **Step 4: Migrate and run test**

Run:
```bash
./.venv/bin/python manage.py makemigrations operations
./.venv/bin/python -m pytest apps/operations/tests/test_roles_permissions.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add ops_roles and ops_permissions models (DB-OPS-001)"
```

---

## Task 4: `RolePermission` mapping (DB-OPS-001)

**Files:**
- Modify: `Backend/VAPS/apps/operations/models.py`
- Test: `Backend/VAPS/apps/operations/tests/test_role_permissions.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_role_permissions.py`:
```python
import pytest
from django.db import IntegrityError

from apps.operations.models import Permission, Role, RolePermission

pytestmark = pytest.mark.django_db


@pytest.fixture
def role_and_perm():
    role = Role.objects.create(code="OMD", name="ОМД")
    perm = Permission.objects.create(code="assignment.create", name="Создание назначения")
    return role, perm


def test_create_mapping_has_integer_pk(role_and_perm):
    role, perm = role_and_perm
    rp = RolePermission.objects.create(role_code=role, permission_code=perm)
    assert isinstance(rp.pk, int)


def test_role_permission_unique(role_and_perm):
    role, perm = role_and_perm
    RolePermission.objects.create(role_code=role, permission_code=perm)
    with pytest.raises(IntegrityError):
        RolePermission.objects.create(role_code=role, permission_code=perm)
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_role_permissions.py -v`
Expected: FAIL — cannot import `RolePermission`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class RolePermission(TimeStampedModel):
    role_code = models.ForeignKey(
        Role, on_delete=models.CASCADE, db_column="role_code",
        to_field="code", related_name="role_permissions",
    )
    permission_code = models.ForeignKey(
        Permission, on_delete=models.CASCADE, db_column="permission_code",
        to_field="code", related_name="permission_roles",
    )

    class Meta:
        db_table = "ops_role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["role_code", "permission_code"], name="unique_role_permission"
            )
        ]

    def __str__(self):
        return f"{self.role_code_id}:{self.permission_code_id}"
```

- [ ] **Step 4: Migrate and run test**

Run:
```bash
./.venv/bin/python manage.py makemigrations operations
./.venv/bin/python -m pytest apps/operations/tests/test_role_permissions.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add ops_role_permissions mapping (DB-OPS-001)"
```

---

## Task 5: `UserRole` assignment (DB-OPS-001, ARCH-007)

**Files:**
- Modify: `Backend/VAPS/apps/operations/models.py`
- Test: `Backend/VAPS/apps/operations/tests/test_user_roles.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_user_roles.py`:
```python
import uuid

import pytest
from django.db import IntegrityError

from apps.operations.models import Role, UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def role():
    return Role.objects.create(code="DIVISION_OPERATOR", name="Оператор подразделения")


def test_user_id_is_string_not_uuid(role):
    ur = UserRole.objects.create(user_id="auth-user-7", role_code=role)
    assert isinstance(ur.user_id, str)
    assert ur.scope_division_id is None
    assert isinstance(ur.pk, int)


def test_scope_division_id_is_uuid(role):
    div = uuid.uuid4()
    ur = UserRole.objects.create(user_id="u1", role_code=role, scope_division_id=div)
    ur.refresh_from_db()
    assert ur.scope_division_id == div


def test_unique_user_role_scope(role):
    UserRole.objects.create(user_id="u1", role_code=role, scope_division_id=None)
    with pytest.raises(IntegrityError):
        UserRole.objects.create(user_id="u1", role_code=role, scope_division_id=None)
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_user_roles.py -v`
Expected: FAIL — cannot import `UserRole`.

- [ ] **Step 3: Add the model**

Append to `models.py`:
```python
class UserRole(TimeStampedModel):
    # BR-ACCOUNT-001/002, ARCH-007: external auth account id, never core_employees.id.
    user_id = models.CharField(max_length=100)
    role_code = models.ForeignKey(
        Role, on_delete=models.PROTECT, db_column="role_code",
        to_field="code", related_name="user_roles",
    )
    scope_division_id = models.UUIDField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_user_roles"
        constraints = [
            models.UniqueConstraint(
                fields=["user_id", "role_code", "scope_division_id"],
                name="unique_user_role_scope",
            )
        ]
        indexes = [
            models.Index(fields=["user_id", "is_active"], name="idx_ops_user_roles_user"),
        ]

    def __str__(self):
        return f"{self.user_id}->{self.role_code_id}"
```

> Note: `on_delete=PROTECT` models the spec's `ON DELETE RESTRICT`. SQLite enforces the `UniqueConstraint` treating multiple NULL `scope_division_id` as distinct only if NULLs are considered distinct; Django emits the constraint and the test above uses `None` twice for the same pair to confirm rejection. If SQLite treats NULLs as distinct in your environment and the test does not raise, change the duplicate row in the test to use an explicit shared UUID; keep the model unchanged.

- [ ] **Step 4: Migrate and run test**

Run:
```bash
./.venv/bin/python manage.py makemigrations operations
./.venv/bin/python -m pytest apps/operations/tests/test_user_roles.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add ops_user_roles with division scope (DB-OPS-001)"
```

---

## Task 6: `TemporaryDutyPermission` + duty-role validator (DB-OPS-038, BR-TEMP-PERM)

**Files:**
- Create: `Backend/VAPS/apps/operations/validators.py`
- Modify: `Backend/VAPS/apps/operations/models.py`
- Test: `Backend/VAPS/apps/operations/tests/test_temporary_duty.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_temporary_duty.py`:
```python
import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.operations.models import TemporaryDutyPermission

pytestmark = pytest.mark.django_db


def test_create_active_grant_has_integer_pk():
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=12), created_by="admin-1",
    )
    assert isinstance(grant.pk, int)
    assert grant.is_active is True


def test_invalid_duty_role_code_rejected():
    now = timezone.now()
    grant = TemporaryDutyPermission(
        user_id="u1", duty_role_code="WIZARD",
        starts_at=now, ends_at=now + dt.timedelta(hours=1), created_by="admin-1",
    )
    with pytest.raises(ValidationError):
        grant.full_clean()


def test_starts_after_ends_rejected():
    now = timezone.now()
    grant = TemporaryDutyPermission(
        user_id="u1", duty_role_code="ORGD",
        starts_at=now, ends_at=now - dt.timedelta(hours=1), created_by="admin-1",
    )
    with pytest.raises(ValidationError):
        grant.full_clean()
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_temporary_duty.py -v`
Expected: FAIL — cannot import `TemporaryDutyPermission`.

- [ ] **Step 3: Create the validator**

`Backend/VAPS/apps/operations/validators.py`:
```python
DUTY_ROLE_CHOICES = [
    ("OMD", "ОМД"),
    ("ORGD", "ОРГД"),
    ("HQ_DUTY", "Дежурный по штабу"),
    ("OBJECT_SENIOR_DUTY", "Старший по объекту"),
]
```

- [ ] **Step 4: Add the model**

Append to `models.py` (add `from django.core.exceptions import ValidationError` and `from apps.operations.validators import DUTY_ROLE_CHOICES` at the top of the file):
```python
class TemporaryDutyPermission(TimeStampedModel):
    user_id = models.CharField(max_length=100)
    employee_id = models.UUIDField(null=True, blank=True)
    duty_role_code = models.CharField(max_length=50, choices=DUTY_ROLE_CHOICES)
    scope_division_id = models.UUIDField(null=True, blank=True)
    event_id = models.UUIDField(null=True, blank=True)  # flat; ops_events not built yet
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_temporary_duty_permissions"
        indexes = [
            models.Index(
                fields=["user_id", "is_active", "starts_at", "ends_at"],
                name="idx_ops_temp_duty_user",
            )
        ]

    def clean(self):
        super().clean()
        if not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")

    def __str__(self):
        return f"{self.user_id}:{self.duty_role_code}"
```

> The top-of-file import block of `models.py` after this task is:
> `from django.core.exceptions import ValidationError`, `from django.db import models`, `from apps.operations.validators import DUTY_ROLE_CHOICES`.

- [ ] **Step 5: Migrate and run test**

Run:
```bash
./.venv/bin/python manage.py makemigrations operations
./.venv/bin/python -m pytest apps/operations/tests/test_temporary_duty.py -v
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): add ops_temporary_duty_permissions with duty-role validator (DB-OPS-038)"
```

---

## Task 7: Seed command (DB-OPS-001 roles/permissions/matrix)

**Files:**
- Create: `Backend/VAPS/apps/operations/management/__init__.py`, `Backend/VAPS/apps/operations/management/commands/__init__.py`, `Backend/VAPS/apps/operations/management/commands/seed_operations.py`
- Test: `Backend/VAPS/apps/operations/tests/test_seed.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_seed.py`:
```python
import pytest
from django.core.management import call_command

from apps.operations.models import Permission, Role, RolePermission

pytestmark = pytest.mark.django_db


def test_seed_creates_all_roles():
    call_command("seed_operations")
    codes = set(Role.objects.values_list("code", flat=True))
    assert codes == {
        "ADMIN", "ORGD", "OMD", "SENIOR_COORDINATOR", "APPROVER",
        "DIVISION_OPERATOR", "VIEWER", "INTEGRATION_USER",
    }


def test_seed_creates_permissions_including_wildcard():
    call_command("seed_operations")
    codes = set(Permission.objects.values_list("code", flat=True))
    assert "*" in codes
    assert {"admin.roles", "assignment.create", "audit.view", "status.view"} <= codes


def test_admin_is_bound_to_wildcard():
    call_command("seed_operations")
    assert RolePermission.objects.filter(
        role_code="ADMIN", permission_code="*"
    ).exists()


def test_omd_matrix():
    call_command("seed_operations")
    omd_perms = set(
        RolePermission.objects.filter(role_code="OMD")
        .values_list("permission_code", flat=True)
    )
    assert omd_perms == {
        "assignment.create", "assignment.delete", "assignment.submit",
        "daily_report.generate", "brokerage.manage",
    }


def test_seed_is_idempotent():
    call_command("seed_operations")
    call_command("seed_operations")
    assert Role.objects.count() == 8
    assert RolePermission.objects.filter(role_code="OMD").count() == 5
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_seed.py -v`
Expected: FAIL — `Unknown command: 'seed_operations'`.

- [ ] **Step 3: Create the seed command**

Create empty `management/__init__.py` and `management/commands/__init__.py`, then `management/commands/seed_operations.py`:
```python
from django.core.management.base import BaseCommand

from apps.operations.models import Permission, Role, RolePermission

PERMISSIONS = [
    ("*", "Все права"),
    ("admin.roles", "Управление ролями"),
    ("status.manage", "Управление статусами"),
    ("status.view", "Просмотр статусов"),
    ("assignment.create", "Создание назначения"),
    ("assignment.delete", "Удаление назначения"),
    ("assignment.submit", "Отправка расстановки"),
    ("assignment.return", "Возврат расстановки"),
    ("assignment.approve", "Утверждение расстановки"),
    ("brokerage.manage", "Брокеридж"),
    ("daily_report.generate", "Генерация суточного отчёта"),
    ("daily_report.mark_update", "Отметки в суточном отчёте"),
    ("daily_report.correct", "Корректировка суточного отчёта"),
    ("object.manage", "Управление объектами"),
    ("event.manage", "Управление мероприятиями"),
    ("duty.manage", "Управление дежурствами"),
    ("audit.view", "Просмотр аудита"),
]

ROLES = [
    ("ADMIN", "Администратор"),
    ("ORGD", "ОРГД"),
    ("OMD", "ОМД"),
    ("SENIOR_COORDINATOR", "Старший координатор"),
    ("APPROVER", "Утверждающий"),
    ("DIVISION_OPERATOR", "Оператор подразделения"),
    ("VIEWER", "Наблюдатель"),
    ("INTEGRATION_USER", "Интеграционная учётная запись"),
]

ROLE_PERMISSIONS = {
    "ADMIN": ["*"],
    "OMD": [
        "assignment.create", "assignment.delete", "assignment.submit",
        "daily_report.generate", "brokerage.manage",
    ],
    "SENIOR_COORDINATOR": ["assignment.create", "assignment.delete", "assignment.submit"],
    "APPROVER": ["assignment.return", "assignment.approve"],
    "DIVISION_OPERATOR": ["daily_report.mark_update", "daily_report.correct", "status.view"],
    "ORGD": ["audit.view", "daily_report.generate"],
    "VIEWER": ["status.view"],
    "INTEGRATION_USER": ["status.manage"],
}


class Command(BaseCommand):
    help = "Seed operations RBAC reference data (idempotent)."

    def handle(self, *args, **options):
        for code, name in PERMISSIONS:
            Permission.objects.update_or_create(code=code, defaults={"name": name})
        for code, name in ROLES:
            Role.objects.update_or_create(code=code, defaults={"name": name})
        for role_code, perm_codes in ROLE_PERMISSIONS.items():
            for perm_code in perm_codes:
                RolePermission.objects.update_or_create(
                    role_code_id=role_code, permission_code_id=perm_code
                )
        self.stdout.write(self.style.SUCCESS("Seeded operations RBAC"))
```

- [ ] **Step 4: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_seed.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add seed_operations command for RBAC reference data (DB-OPS-001)"
```

---

## Task 8: `OpsUserRoleSelector` (ARCH-004 read access)

**Files:**
- Create: `Backend/VAPS/apps/operations/selectors.py`
- Test: `Backend/VAPS/apps/operations/tests/test_user_role_selector.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_user_role_selector.py`:
```python
import pytest

from apps.operations.models import Role, UserRole
from apps.operations.selectors import OpsUserRoleSelector

pytestmark = pytest.mark.django_db


@pytest.fixture
def roles():
    return (
        Role.objects.create(code="OMD", name="ОМД"),
        Role.objects.create(code="VIEWER", name="Наблюдатель"),
    )


def test_active_role_codes_for_user_excludes_inactive(roles):
    omd, viewer = roles
    UserRole.objects.create(user_id="u1", role_code=omd)
    UserRole.objects.create(user_id="u1", role_code=viewer, is_active=False)
    UserRole.objects.create(user_id="other", role_code=omd)
    result = OpsUserRoleSelector.active_for_user("u1")
    role_codes = {ur.role_code_id for ur in result}
    assert role_codes == {"OMD"}


def test_active_for_user_empty_when_none(roles):
    assert OpsUserRoleSelector.active_for_user("nobody") == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_user_role_selector.py -v`
Expected: FAIL — cannot import `selectors`.

- [ ] **Step 3: Implement the selector**

`Backend/VAPS/apps/operations/selectors.py`:
```python
from apps.operations.models import UserRole


class OpsUserRoleSelector:
    """Read-only access to user-role assignments."""

    @staticmethod
    def active_for_user(user_id):
        return list(
            UserRole.objects.filter(user_id=user_id, is_active=True).select_related("role_code")
        )
```

- [ ] **Step 4: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_user_role_selector.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add OpsUserRoleSelector read access (ARCH-004)"
```

---

## Task 9: `PermissionService.has_permission` core resolution (§1254, STORY-003)

**Files:**
- Create: `Backend/VAPS/apps/operations/services.py`
- Test: `Backend/VAPS/apps/operations/tests/test_permission_service.py`

This task implements wildcard short-circuit, granted/denied, and global (unscoped) resolution. Scope and temporary duty are added in Tasks 10–11.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_permission_service.py`:
```python
import pytest
from django.core.management import call_command

from apps.operations.models import UserRole, Role
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_admin_has_any_permission_via_wildcard(seeded):
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    assert PermissionService.has_permission("admin-1", "assignment.create") is True
    assert PermissionService.has_permission("admin-1", "anything.at.all") is True


def test_granted_permission_returns_true(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD")
    assert PermissionService.has_permission("omd-1", "assignment.create") is True


def test_ungranted_permission_returns_false(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD")
    assert PermissionService.has_permission("omd-1", "audit.view") is False


def test_no_roles_returns_false(seeded):
    assert PermissionService.has_permission("ghost", "status.view") is False


def test_inactive_role_does_not_grant(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD", is_active=False)
    assert PermissionService.has_permission("omd-1", "assignment.create") is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_service.py -v`
Expected: FAIL — cannot import `PermissionService`.

- [ ] **Step 3: Implement the service**

`Backend/VAPS/apps/operations/services.py`:
```python
from apps.operations.models import RolePermission
from apps.operations.selectors import OpsUserRoleSelector

WILDCARD = "*"


class PermissionService:
    """Stateless authorization resolution (spec §1254). All checks go through here."""

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        user_roles = OpsUserRoleSelector.active_for_user(user_id)
        if not user_roles:
            return set()
        role_codes = [ur.role_code_id for ur in user_roles]
        perms = set(
            RolePermission.objects.filter(role_code_id__in=role_codes).values_list(
                "permission_code_id", flat=True
            )
        )
        return perms

    @classmethod
    def has_permission(cls, user_id, permission_code, division_id=None) -> bool:
        perms = cls.effective_permissions(user_id, division_id=division_id)
        if WILDCARD in perms:
            return True
        return permission_code in perms
```

- [ ] **Step 4: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_service.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add PermissionService with wildcard resolution (§1254, STORY-003)"
```

---

## Task 10: Division-scope resolution via core selector (ARCH-004)

**Files:**
- Modify: `Backend/VAPS/apps/operations/services.py`
- Test: `Backend/VAPS/apps/operations/tests/test_permission_scope.py`

Scope rule: a role with `scope_division_id IS NULL` is global. A scoped role matches a `division_id` only when `division_id` is within the scope subtree, resolved via `core.selectors.CoreDivisionTreeSelector.subtree_ids`. When the caller passes no `division_id`, scoped roles still contribute (scope only narrows division-specific checks).

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_permission_scope.py`:
```python
import pytest
from django.core.management import call_command

from apps.core.models import Division, DivisionType, Organization
from apps.operations.models import UserRole
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(organization=org, type_code=dt, name="root", code="R")
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C", parent=root
    )
    other = Division.objects.create(organization=org, type_code=dt, name="other", code="O")
    return root, child, other


def test_scoped_role_matches_division_in_subtree(tree):
    root, child, _ = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=child.id) is True


def test_scoped_role_denies_division_outside_subtree(tree):
    root, _, other = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=other.id) is False


def test_scoped_role_still_grants_when_no_division_given(tree):
    root, _, _ = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    assert PermissionService.has_permission("op-1", "status.view") is True


def test_global_role_matches_any_division(tree):
    root, child, other = tree
    UserRole.objects.create(
        user_id="op-1", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    assert PermissionService.has_permission("op-1", "status.view", division_id=other.id) is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_scope.py -v`
Expected: FAIL — current `effective_permissions` ignores `scope_division_id`, so `test_scoped_role_denies_division_outside_subtree` fails (returns True).

- [ ] **Step 3: Update the service to honor scope**

Replace the body of `effective_permissions` in `services.py` with scope filtering (add `from apps.core.selectors import CoreDivisionTreeSelector` at the top — this is the sanctioned cross-context import, NOT `apps.core.models`):
```python
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.models import RolePermission
from apps.operations.selectors import OpsUserRoleSelector

WILDCARD = "*"


class PermissionService:
    """Stateless authorization resolution (spec §1254). All checks go through here."""

    @staticmethod
    def _scope_matches(scope_division_id, division_id) -> bool:
        if scope_division_id is None:
            return True
        if division_id is None:
            # Scope only narrows division-specific checks; global checks still pass.
            return True
        return division_id in CoreDivisionTreeSelector.subtree_ids(scope_division_id)

    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        user_roles = OpsUserRoleSelector.active_for_user(user_id)
        matching_role_codes = [
            ur.role_code_id
            for ur in user_roles
            if cls._scope_matches(ur.scope_division_id, division_id)
        ]
        if not matching_role_codes:
            return set()
        return set(
            RolePermission.objects.filter(
                role_code_id__in=matching_role_codes
            ).values_list("permission_code_id", flat=True)
        )

    @classmethod
    def has_permission(cls, user_id, permission_code, division_id=None) -> bool:
        perms = cls.effective_permissions(user_id, division_id=division_id)
        if WILDCARD in perms:
            return True
        return permission_code in perms
```

> `CoreDivisionTreeSelector.subtree_ids` returns a `set` of division UUIDs including the root itself, so a `scope_division_id` equal to `division_id` matches.

- [ ] **Step 4: Run both service test files**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_service.py apps/operations/tests/test_permission_scope.py -v`
Expected: 9 passed (5 from Task 9 still green + 4 new).

- [ ] **Step 5: Verify isolation still holds**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_isolation.py -v`
Expected: 2 passed (we imported `core.selectors`, not `core.models`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): add division-scope resolution via core selector (ARCH-004)"
```

---

## Task 11: Temporary-duty permissions in resolution (DB-OPS-038, BR-TEMP-PERM-002)

**Files:**
- Modify: `Backend/VAPS/apps/operations/services.py`
- Test: `Backend/VAPS/apps/operations/tests/test_permission_temp_duty.py`

Active temporary duty contributes the permissions of the `Role` whose `code == duty_role_code`, but only while `is_active=True` and `starts_at <= now <= ends_at`. The same scope rule applies.

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_permission_temp_duty.py`:
```python
import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.operations.models import Role, RolePermission, TemporaryDutyPermission
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def omd_duty_role():
    call_command("seed_operations")
    # Ensure an OMD role with a known permission exists (seeded), and a duty maps to it.
    return Role.objects.get(code="OMD")


def test_active_temp_duty_grants_role_permissions(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is True


def test_expired_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now - dt.timedelta(hours=3), ends_at=now - dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False


def test_future_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now + dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=3),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False


def test_inactive_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD", is_active=False,
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_temp_duty.py -v`
Expected: FAIL — temp duty not yet considered; `test_active_temp_duty_grants_role_permissions` returns False.

- [ ] **Step 3: Fold temp duty into `effective_permissions`**

In `services.py`, add the imports `from django.utils import timezone` and `from apps.operations.models import RolePermission, TemporaryDutyPermission` (replace the existing `RolePermission` import line), then extend `effective_permissions` to collect duty role codes. Replace the `effective_permissions` method with:
```python
    @classmethod
    def effective_permissions(cls, user_id, division_id=None) -> set:
        user_roles = OpsUserRoleSelector.active_for_user(user_id)
        matching_role_codes = [
            ur.role_code_id
            for ur in user_roles
            if cls._scope_matches(ur.scope_division_id, division_id)
        ]

        now = timezone.now()
        active_duties = TemporaryDutyPermission.objects.filter(
            user_id=user_id, is_active=True, starts_at__lte=now, ends_at__gte=now
        )
        for duty in active_duties:
            if cls._scope_matches(duty.scope_division_id, division_id):
                matching_role_codes.append(duty.duty_role_code)

        if not matching_role_codes:
            return set()
        return set(
            RolePermission.objects.filter(
                role_code_id__in=matching_role_codes
            ).values_list("permission_code_id", flat=True)
        )
```

> `duty_role_code` values (`OMD`, `ORGD`, …) are looked up against `ops_role_permissions.role_code`. `OMD` and `ORGD` are seeded roles, so their duties resolve to real permissions. `HQ_DUTY` / `OBJECT_SENIOR_DUTY` have no seeded role yet and contribute nothing until a future plan seeds them — acceptable for MVP.

- [ ] **Step 4: Run the full service suite**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_permission_service.py apps/operations/tests/test_permission_scope.py apps/operations/tests/test_permission_temp_duty.py -v`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): fold active temporary duty into permission resolution (DB-OPS-038, BR-TEMP-PERM-002)"
```

---

## Task 12: Write wrappers — assign/revoke role, grant/expire temp duty (service layer)

**Files:**
- Modify: `Backend/VAPS/apps/operations/services.py`
- Test: `Backend/VAPS/apps/operations/tests/test_rbac_write_services.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_rbac_write_services.py`:
```python
import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.operations.models import TemporaryDutyPermission, UserRole
from apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_assign_role_creates_active_assignment(seeded):
    ur = RoleAdminService.assign_role("u1", "OMD", scope_division_id=None)
    assert ur.is_active is True
    assert UserRole.objects.filter(user_id="u1", role_code_id="OMD").count() == 1


def test_assign_role_is_idempotent_reactivates(seeded):
    RoleAdminService.assign_role("u1", "OMD")
    RoleAdminService.revoke_role("u1", "OMD")
    ur = RoleAdminService.assign_role("u1", "OMD")
    assert ur.is_active is True
    assert UserRole.objects.filter(user_id="u1", role_code_id="OMD").count() == 1


def test_revoke_role_deactivates(seeded):
    RoleAdminService.assign_role("u1", "OMD")
    RoleAdminService.revoke_role("u1", "OMD")
    assert UserRole.objects.get(user_id="u1", role_code_id="OMD").is_active is False


def test_grant_temporary_duty_creates_active_window(seeded):
    now = timezone.now()
    grant = RoleAdminService.grant_temporary_duty(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin",
    )
    assert grant.is_active is True


def test_expire_temporary_duty_deactivates(seeded):
    now = timezone.now()
    grant = RoleAdminService.grant_temporary_duty(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin",
    )
    RoleAdminService.expire_temporary_duty(grant.id)
    grant.refresh_from_db()
    assert grant.is_active is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_rbac_write_services.py -v`
Expected: FAIL — cannot import `RoleAdminService`.

- [ ] **Step 3: Add the write service**

Append to `services.py` (add `from django.db import transaction` at the top):
```python
class RoleAdminService:
    """Write-side wrappers for RBAC administration."""

    @staticmethod
    @transaction.atomic
    def assign_role(user_id, role_code, scope_division_id=None):
        user_role, _ = UserRole.objects.update_or_create(
            user_id=user_id, role_code_id=role_code, scope_division_id=scope_division_id,
            defaults={"is_active": True},
        )
        return user_role

    @staticmethod
    @transaction.atomic
    def revoke_role(user_id, role_code, scope_division_id=None):
        UserRole.objects.filter(
            user_id=user_id, role_code_id=role_code, scope_division_id=scope_division_id
        ).update(is_active=False)

    @staticmethod
    @transaction.atomic
    def grant_temporary_duty(*, user_id, duty_role_code, starts_at, ends_at, created_by,
                             employee_id=None, scope_division_id=None, event_id=None):
        grant = TemporaryDutyPermission(
            user_id=user_id, duty_role_code=duty_role_code, starts_at=starts_at,
            ends_at=ends_at, created_by=created_by, employee_id=employee_id,
            scope_division_id=scope_division_id, event_id=event_id,
        )
        grant.full_clean()
        grant.save()
        return grant

    @staticmethod
    @transaction.atomic
    def expire_temporary_duty(grant_id):
        TemporaryDutyPermission.objects.filter(id=grant_id).update(is_active=False)
```
Also add `UserRole` to the model import line in `services.py` so it reads:
`from apps.operations.models import RolePermission, TemporaryDutyPermission, UserRole`.

- [ ] **Step 4: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_rbac_write_services.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(operations): add RoleAdminService write wrappers for assignments and temp duty"
```

---

## Task 13: API identity helper + `HasOpsPermission` permission class (§1255, §7007 stub)

**Files:**
- Create: `Backend/VAPS/apps/operations/api/identity.py`
- Create: `Backend/VAPS/apps/operations/api/permissions.py`
- Test: `Backend/VAPS/apps/operations/tests/test_api_permissions.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_api_permissions.py`:
```python
import pytest
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIRequestFactory

from apps.operations.api.identity import get_user_id
from apps.operations.api.permissions import require_permission

pytestmark = pytest.mark.django_db


def test_get_user_id_reads_header():
    request = APIRequestFactory().get("/", HTTP_X_USER_ID="auth-9")
    assert get_user_id(request) == "auth-9"


def test_get_user_id_none_when_absent():
    request = APIRequestFactory().get("/")
    assert get_user_id(request) is None


def test_require_permission_denies_without_user_id():
    request = APIRequestFactory().get("/")
    with pytest.raises(PermissionDenied):
        require_permission(request, "admin.roles")


def test_require_permission_denies_without_permission():
    from django.core.management import call_command
    call_command("seed_operations")
    request = APIRequestFactory().get("/", HTTP_X_USER_ID="nobody")
    with pytest.raises(PermissionDenied):
        require_permission(request, "admin.roles")


def test_require_permission_allows_admin():
    from django.core.management import call_command
    from apps.operations.models import UserRole
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    request = APIRequestFactory().get("/", HTTP_X_USER_ID="admin-1")
    # Should not raise.
    require_permission(request, "admin.roles")
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_api_permissions.py -v`
Expected: FAIL — cannot import `identity` / `permissions`.

- [ ] **Step 3: Create the identity helper**

`Backend/VAPS/apps/operations/api/identity.py`:
```python
def get_user_id(request):
    """MVP stand-in for the JWT `sub` claim (spec §7007).

    Reads the external auth account id from the X-User-Id header. Replace with
    real authentication later; everything downstream already keys on this string.
    """
    user_id = request.headers.get("X-User-Id")
    return user_id or None
```

- [ ] **Step 4: Create the permission helper**

`Backend/VAPS/apps/operations/api/permissions.py`:
```python
from rest_framework.exceptions import PermissionDenied

from apps.operations.api.identity import get_user_id
from apps.operations.services import PermissionService


def require_permission(request, permission_code, division_id=None):
    """Raise 403 PERMISSION_DENIED unless the caller holds permission_code."""
    user_id = get_user_id(request)
    if not user_id:
        raise PermissionDenied("PERMISSION_DENIED")
    if not PermissionService.has_permission(user_id, permission_code, division_id=division_id):
        raise PermissionDenied("PERMISSION_DENIED")
    return user_id
```

- [ ] **Step 5: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_api_permissions.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): add X-User-Id identity stub and require_permission helper (§1255, §7007)"
```

---

## Task 14: Roles & permissions read API (§6)

**Files:**
- Create: `Backend/VAPS/apps/operations/api/serializers.py`
- Create: `Backend/VAPS/apps/operations/api/views.py`
- Modify: `Backend/VAPS/apps/operations/api/urls.py`
- Test: `Backend/VAPS/apps/operations/tests/test_roles_api.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_roles_api.py`:
```python
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.models import UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    return client


def test_list_roles_requires_admin():
    call_command("seed_operations")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="nobody")
    resp = client.get("/api/operations/roles/")
    assert resp.status_code == 403


def test_list_roles_returns_seeded(admin_client):
    resp = admin_client.get("/api/operations/roles/")
    assert resp.status_code == 200
    codes = {r["code"] for r in resp.json()["results"]}
    assert "ADMIN" in codes and "OMD" in codes


def test_list_permissions_returns_seeded(admin_client):
    resp = admin_client.get("/api/operations/permissions/")
    assert resp.status_code == 200
    codes = {p["code"] for p in resp.json()["results"]}
    assert "assignment.create" in codes
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_roles_api.py -v`
Expected: FAIL — 404 (routes not registered).

- [ ] **Step 3: Create serializers**

`Backend/VAPS/apps/operations/api/serializers.py`:
```python
from rest_framework import serializers

from apps.operations.models import (
    Permission, Role, TemporaryDutyPermission, UserRole,
)


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["code", "name", "description", "is_active"]


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "name", "description", "is_active"]


class UserRoleSerializer(serializers.ModelSerializer):
    role_code = serializers.SlugRelatedField(slug_field="code", read_only=True)

    class Meta:
        model = UserRole
        fields = ["id", "user_id", "role_code", "scope_division_id", "is_active"]


class TemporaryDutySerializer(serializers.ModelSerializer):
    class Meta:
        model = TemporaryDutyPermission
        fields = [
            "id", "user_id", "employee_id", "duty_role_code", "scope_division_id",
            "event_id", "starts_at", "ends_at", "is_active", "created_by",
        ]
```

- [ ] **Step 4: Create the views**

`Backend/VAPS/apps/operations/api/views.py`:
```python
from rest_framework import viewsets
from rest_framework.pagination import LimitOffsetPagination

from apps.operations.api.permissions import require_permission
from apps.operations.api.serializers import PermissionSerializer, RoleSerializer
from apps.operations.models import Permission, Role


class DefaultPagination(LimitOffsetPagination):
    default_limit = 50


class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RoleSerializer
    pagination_class = DefaultPagination
    queryset = Role.objects.all().order_by("code")

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().retrieve(request, *args, **kwargs)


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PermissionSerializer
    pagination_class = DefaultPagination
    queryset = Permission.objects.all().order_by("code")

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().retrieve(request, *args, **kwargs)
```

- [ ] **Step 5: Register routes**

Replace `Backend/VAPS/apps/operations/api/urls.py`:
```python
from rest_framework.routers import DefaultRouter

from apps.operations.api.views import PermissionViewSet, RoleViewSet

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="ops-role")
router.register("permissions", PermissionViewSet, basename="ops-permission")

urlpatterns = router.urls
```

- [ ] **Step 6: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_roles_api.py -v`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(operations): add roles/permissions read API guarded by admin.roles (§6)"
```

---

## Task 15: User-role assignment API (§6)

**Files:**
- Modify: `Backend/VAPS/apps/operations/api/views.py`
- Modify: `Backend/VAPS/apps/operations/api/urls.py`
- Test: `Backend/VAPS/apps/operations/tests/test_user_roles_api.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_user_roles_api.py`:
```python
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.models import UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    return client


def test_assign_role(admin_client):
    resp = admin_client.post(
        "/api/operations/user-roles/",
        {"user_id": "u9", "role_code": "OMD"}, format="json",
    )
    assert resp.status_code == 201
    assert UserRole.objects.filter(user_id="u9", role_code_id="OMD", is_active=True).exists()


def test_list_user_roles_filtered_by_user(admin_client):
    admin_client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    resp = admin_client.get("/api/operations/user-roles/?user_id=u9")
    assert resp.status_code == 200
    rows = resp.json()["results"]
    assert all(r["user_id"] == "u9" for r in rows)
    assert len(rows) == 1


def test_revoke_role(admin_client):
    admin_client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    ur = UserRole.objects.get(user_id="u9", role_code_id="OMD")
    resp = admin_client.delete(f"/api/operations/user-roles/{ur.id}/")
    assert resp.status_code == 204
    ur.refresh_from_db()
    assert ur.is_active is False


def test_assign_requires_admin():
    call_command("seed_operations")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="nobody")
    resp = client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_user_roles_api.py -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the viewset**

Append to `Backend/VAPS/apps/operations/api/views.py` (add imports: `from rest_framework import status`, `from rest_framework.response import Response`, `from apps.operations.api.serializers import UserRoleSerializer`, `from apps.operations.models import UserRole`, `from apps.operations.services import RoleAdminService`):
```python
class UserRoleViewSet(viewsets.ViewSet):
    pagination_class = DefaultPagination

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        qs = UserRole.objects.all().order_by("user_id")
        if user_id := request.query_params.get("user_id"):
            qs = qs.filter(user_id=user_id)
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(UserRoleSerializer(page, many=True).data)

    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        user_role = RoleAdminService.assign_role(
            user_id=request.data["user_id"],
            role_code=request.data["role_code"],
            scope_division_id=request.data.get("scope_division_id"),
        )
        return Response(
            UserRoleSerializer(user_role).data, status=status.HTTP_201_CREATED
        )

    def destroy(self, request, pk=None, *args, **kwargs):
        require_permission(request, "admin.roles")
        user_role = UserRole.objects.filter(id=pk).first()
        if user_role is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        RoleAdminService.revoke_role(
            user_role.user_id, user_role.role_code_id, user_role.scope_division_id
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 4: Register the route**

In `Backend/VAPS/apps/operations/api/urls.py`, update the views import and register:
```python
from apps.operations.api.views import (
    PermissionViewSet, RoleViewSet, UserRoleViewSet,
)
```
Add after the existing registrations:
```python
router.register("user-roles", UserRoleViewSet, basename="ops-user-role")
```

- [ ] **Step 5: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_user_roles_api.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): add user-role assignment API (§6)"
```

---

## Task 16: Temporary-duty API + my-permissions endpoint (§6, DB-OPS-038)

**Files:**
- Modify: `Backend/VAPS/apps/operations/api/views.py`
- Modify: `Backend/VAPS/apps/operations/api/urls.py`
- Test: `Backend/VAPS/apps/operations/tests/test_temp_duty_api.py`

- [ ] **Step 1: Write the failing test**

`Backend/VAPS/apps/operations/tests/test_temp_duty_api.py`:
```python
import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.operations.models import TemporaryDutyPermission, UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    return client


def test_grant_temporary_duty(admin_client):
    now = timezone.now()
    resp = admin_client.post(
        "/api/operations/temporary-duty/",
        {
            "user_id": "duty-1", "duty_role_code": "OMD",
            "starts_at": now.isoformat(),
            "ends_at": (now + dt.timedelta(hours=8)).isoformat(),
            "created_by": "admin-1",
        },
        format="json",
    )
    assert resp.status_code == 201
    assert TemporaryDutyPermission.objects.filter(user_id="duty-1", is_active=True).exists()


def test_expire_temporary_duty(admin_client):
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin-1",
    )
    resp = admin_client.post(f"/api/operations/temporary-duty/{grant.id}/expire/")
    assert resp.status_code == 200
    grant.refresh_from_db()
    assert grant.is_active is False


def test_my_permissions_reflects_role_and_duty(admin_client):
    # admin-1 holds ADMIN -> wildcard present in effective set.
    resp = admin_client.get("/api/operations/my-permissions/")
    assert resp.status_code == 200
    assert "*" in resp.json()["permissions"]


def test_my_permissions_denied_without_user_id():
    call_command("seed_operations")
    client = APIClient()
    resp = client.get("/api/operations/my-permissions/")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_temp_duty_api.py -v`
Expected: FAIL — 404 (routes not registered).

- [ ] **Step 3: Add the viewsets**

Append to `Backend/VAPS/apps/operations/api/views.py` (add imports: `from rest_framework.decorators import action`, `from apps.operations.api.identity import get_user_id`, `from apps.operations.api.serializers import TemporaryDutySerializer`, `from apps.operations.models import TemporaryDutyPermission`):
```python
class TemporaryDutyViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        qs = TemporaryDutyPermission.objects.all().order_by("-starts_at")
        if user_id := request.query_params.get("user_id"):
            qs = qs.filter(user_id=user_id)
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(TemporaryDutySerializer(page, many=True).data)

    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        grant = RoleAdminService.grant_temporary_duty(
            user_id=request.data["user_id"],
            duty_role_code=request.data["duty_role_code"],
            starts_at=request.data["starts_at"],
            ends_at=request.data["ends_at"],
            created_by=request.data["created_by"],
            employee_id=request.data.get("employee_id"),
            scope_division_id=request.data.get("scope_division_id"),
            event_id=request.data.get("event_id"),
        )
        return Response(TemporaryDutySerializer(grant).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def expire(self, request, pk=None, *args, **kwargs):
        require_permission(request, "admin.roles")
        RoleAdminService.expire_temporary_duty(pk)
        return Response({"expired": True}, status=status.HTTP_200_OK)


class MyPermissionsViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        user_id = get_user_id(request)
        if not user_id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("PERMISSION_DENIED")
        division_id = request.query_params.get("division_id")
        perms = PermissionService.effective_permissions(user_id, division_id=division_id)
        return Response({"permissions": sorted(perms)})
```
Add `from apps.operations.services import PermissionService, RoleAdminService` (replace the existing `RoleAdminService` import line) at the top of `views.py`.

- [ ] **Step 4: Register the routes**

In `Backend/VAPS/apps/operations/api/urls.py`, update the views import and register both:
```python
from apps.operations.api.views import (
    MyPermissionsViewSet, PermissionViewSet, RoleViewSet,
    TemporaryDutyViewSet, UserRoleViewSet,
)
```
Add:
```python
router.register("temporary-duty", TemporaryDutyViewSet, basename="ops-temp-duty")
router.register("my-permissions", MyPermissionsViewSet, basename="ops-my-permissions")
```

- [ ] **Step 5: Run the test**

Run: `./.venv/bin/python -m pytest apps/operations/tests/test_temp_duty_api.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(operations): add temporary-duty API and my-permissions endpoint (§6, DB-OPS-038)"
```

---

## Task 17: Full-suite green + isolation re-check + README

**Files:**
- Create: `Backend/VAPS/apps/operations/README.md`
- Test: full suite

- [ ] **Step 1: Run the entire suite (both contexts)**

Run (from `Backend/VAPS/`):
```bash
./.venv/bin/python -m pytest apps -v
```
Expected: all core tests (51) plus all operations tests pass; both `test_isolation.py` files pass.

- [ ] **Step 2: Run the migration check**

Run:
```bash
./.venv/bin/python manage.py makemigrations --check --dry-run
```
Expected: "No changes detected".

- [ ] **Step 3: Write `README.md`**

`Backend/VAPS/apps/operations/README.md`:
```markdown
# operations context — RBAC foundation

Authorization for VAPS: roles, permissions, division-scoped user-role
assignments, time-bounded temporary duty permissions, and a single
`PermissionService`. Implements spec DB-OPS-001 and DB-OPS-038.

## Setup

    ./.venv/bin/python manage.py migrate
    ./.venv/bin/python manage.py seed_operations   # roles, permissions, role->permission matrix

## Authorization

Every check goes through `PermissionService.has_permission(user_id, permission_code, division_id=None)`:
- ADMIN holds `*` and passes any check;
- a role/duty scoped to a division matches that division and its subtree
  (via `core.selectors.CoreDivisionTreeSelector`);
- temporary duty contributes its role's permissions only within `starts_at..ends_at`.

`user_id` is the external auth account id (ARCH-007), never `core_employees.id`.
At the API layer it is read from the `X-User-Id` header (MVP stub for JWT `sub`).

## API (`/api/operations/`)

- `roles/`, `permissions/` — read, guarded by `admin.roles`
- `user-roles/` — list/assign (POST)/revoke (DELETE), guarded by `admin.roles`
- `temporary-duty/` — list/grant (POST)/`{id}/expire/`, guarded by `admin.roles`
- `my-permissions/?division_id=` — caller's effective permissions

## Isolation

operations imports `apps.core.selectors` only, never `apps.core.models`
(ARCH-004). Enforced by `tests/test_isolation.py`.

## Deferred

- Audit-log writes on mutations (audit context not built).
- Real authentication (JWT `sub`); `X-User-Id` is the current stub.
- Wiring `effective_permissions` into core's masking `X-User-Permissions` stub.
- `HQ_DUTY` / `OBJECT_SENIOR_DUTY` duty roles have no seeded role yet.
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(operations): add README and verify full suite green"
```

---

## Self-Review (completed during planning)

**Spec coverage check (design §§1–8 vs tasks):**
- DB-OPS-001 `ops_roles` / `ops_permissions` → Task 3 ✓
- DB-OPS-001 `ops_role_permissions` → Task 4 ✓
- DB-OPS-001 `ops_user_roles` (scope, ARCH-007) → Task 5 ✓
- DB-OPS-038 `ops_temporary_duty_permissions` + BR-TEMP-PERM dates/enum → Task 6 ✓
- Seeds: 8 roles, 17 permissions + `*`, role→permission matrix, ADMIN=`*` → Task 7 ✓
- Read selector (ARCH-004) → Task 8 ✓
- PermissionService wildcard/granted/denied (§1254, STORY-003) → Task 9 ✓
- Division-scope subtree resolution via core selector (ARCH-004) → Task 10 ✓
- Temporary-duty window in resolution (BR-TEMP-PERM-002) → Task 11 ✓
- Write wrappers (assign/revoke/grant/expire) → Task 12 ✓
- `X-User-Id` identity stub (§7007) + `require_permission` (§1255) → Task 13 ✓
- Roles/permissions read API → Task 14 ✓; user-roles API → Task 15 ✓; temp-duty + my-permissions API → Task 16 ✓
- Isolation test forbidding `core.models`, allowing `core.selectors` (ARCH-004/006) → Task 2 ✓
- Full-suite green + migration check + README → Task 17 ✓

**Type/name consistency:** `PermissionService.has_permission(user_id, permission_code, division_id=None)`, `PermissionService.effective_permissions(user_id, division_id=None)`, `PermissionService._scope_matches(scope_division_id, division_id)`, `RoleAdminService.assign_role/revoke_role/grant_temporary_duty/expire_temporary_duty`, `OpsUserRoleSelector.active_for_user(user_id)`, `get_user_id(request)`, `require_permission(request, permission_code, division_id=None)`, and `CoreDivisionTreeSelector.subtree_ids(scope_division_id)` (returns `set` incl. root) are referenced with identical signatures everywhere they appear.

**Deferred / out of scope (documented, not silently dropped):**
- Audit-log writes on mutations (§1253) — the `audit` context is unbuilt; a future plan wires it.
- Real authentication — `X-User-Id` header is an MVP stub for JWT `sub` (§7007).
- Wiring `PermissionService.effective_permissions` into core's `X-User-Permissions` masking stub — separate cross-context plan.
- `HQ_DUTY` / `OBJECT_SENIOR_DUTY` duty roles contribute no permissions until a future plan seeds matching roles.
- Postgres `gen_random_uuid()` / SQL `CHECK` — replaced by app-level integer PKs and `clean()` validators per the SQLite-testable approach.

**Note for implementer (Task 5):** SQLite may treat multiple NULL `scope_division_id` values as distinct under the unique constraint. If `test_unique_user_role_scope` does not raise, switch the duplicate row to a shared explicit UUID; the model stays unchanged.
```
