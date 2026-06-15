import pytest
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core.auth.authentication import XUserIdAuthentication
from apps.operations.api.permissions import require_permission

pytestmark = pytest.mark.django_db


def _authenticated_request(**extra):
    """Build a DRF request and run it through the authentication class.

    APIRequestFactory skips DRF dispatch, so authentication (and actor_id)
    must be applied explicitly here.
    """
    request = Request(APIRequestFactory().get("/", **extra))
    XUserIdAuthentication().authenticate(request)
    return request


def test_authentication_sets_actor_id_from_header():
    request = _authenticated_request(HTTP_X_USER_ID="auth-9")
    assert request.actor_id == "auth-9"


def test_authentication_leaves_actor_id_unset_when_absent():
    request = _authenticated_request()
    assert getattr(request, "actor_id", None) is None


def test_require_permission_denies_without_actor_id():
    request = _authenticated_request()
    with pytest.raises(PermissionDenied):
        require_permission(request, "admin.roles")


def test_require_permission_denies_without_permission():
    from django.core.management import call_command
    call_command("seed_operations")
    request = _authenticated_request(HTTP_X_USER_ID="nobody")
    with pytest.raises(PermissionDenied):
        require_permission(request, "admin.roles")


def test_require_permission_allows_admin():
    from django.core.management import call_command
    from apps.operations.models import UserRole
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    request = _authenticated_request(HTTP_X_USER_ID="admin-1")
    # Should not raise.
    require_permission(request, "admin.roles")
