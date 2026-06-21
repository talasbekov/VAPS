import pytest

from apps.operations.rbac.models import Role, UserRole
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
