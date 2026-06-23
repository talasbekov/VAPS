import pytest
from django.core.management import call_command

from apps.operations.rbac.models import UserRole


@pytest.fixture
def grant():
    """Authorize an APIClient on the in-house RBAC gate (story 2.13/2.14).

    Seeds operations RBAC, binds ``user_id`` to ``role``, and sets X-User-Id on
    the client. ADMIN (holds ``*``) by default — passes any core-API gate, so
    endpoint-behaviour tests get past authorization (per-role ALLOW/DENY policy
    is proven by the rbac-matrix, not here).
    """

    def _grant(client, role="ADMIN", user_id=None):
        call_command("seed_operations")
        uid = user_id or f"{role.lower()}-api-user"
        UserRole.objects.get_or_create(user_id=uid, role_code_id=role)
        client.credentials(HTTP_X_USER_ID=uid)
        return uid

    return _grant
