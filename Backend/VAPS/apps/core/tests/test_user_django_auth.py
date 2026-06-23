"""Story 2.8 — Django-auth compatibility of core.User (foundation for Admin).

`create_superuser` becomes admin-capable (is_staff/is_superuser + usable
password); `create_user` keeps its unusable-password contract; new rows get the
safe is_staff=False default (same default the migration backfills onto existing
rows). PermissionsMixin is present so the admin's permission machinery works
(a superuser short-circuits all checks). The in-house X-User-Id auth and
PermissionService are untouched — verified by the existing RBAC/permission
suites run as regression (AC-3).
"""

import pytest
from django.contrib.auth import get_user_model

User = get_user_model()

pytestmark = pytest.mark.django_db


def test_create_superuser_is_admin_capable():
    user = User.objects.create_superuser("admin", "s3cret")
    assert user.is_staff is True
    assert user.is_superuser is True
    assert user.is_active is True  # precondition for the has_perm short-circuit
    assert user.has_usable_password() is True
    assert user.check_password("s3cret") is True


def test_create_superuser_rejects_empty_username():
    # Parity with create_user: a blank username must raise, not silently create
    # a blank-login superuser.
    with pytest.raises(ValueError):
        User.objects.create_superuser("", "pw")


def test_create_user_keeps_unusable_password_and_no_staff():
    # Existing contract preserved: no password -> unusable; safe auth defaults.
    user = User.objects.create_user("oper")
    assert user.has_usable_password() is False
    assert user.is_staff is False
    assert user.is_superuser is False


def test_create_user_with_password_is_not_staff():
    user = User.objects.create_user("withpw", "pw")
    assert user.check_password("pw") is True
    assert user.is_staff is False
    assert user.is_superuser is False


def test_superuser_short_circuits_permission_checks():
    # Admin relies on PermissionsMixin; an active superuser passes any check
    # without per-model Django permissions being assigned.
    user = User.objects.create_superuser("root", "pw")
    assert user.has_perm("core.add_position") is True
    assert user.has_module_perms("core") is True


def test_plain_user_has_no_django_permissions():
    # Non-superuser has no admin permissions until explicitly granted (they
    # won't be — admin operators are superusers; business RBAC stays in-house).
    user = User.objects.create_user("plain", "pw")
    assert user.has_perm("core.add_position") is False
    assert user.has_module_perms("core") is False
