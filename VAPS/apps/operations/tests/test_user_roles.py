import uuid

import pytest
from django.db import IntegrityError

from apps.operations.rbac.models import Role, UserRole

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
    # SQLite treats multiple NULL scope_division_id as distinct under the unique
    # constraint, so use a shared explicit UUID to exercise the constraint (plan
    # Task 5 note); the model stays unchanged.
    div = uuid.uuid4()
    UserRole.objects.create(user_id="u1", role_code=role, scope_division_id=div)
    with pytest.raises(IntegrityError):
        UserRole.objects.create(user_id="u1", role_code=role, scope_division_id=div)
