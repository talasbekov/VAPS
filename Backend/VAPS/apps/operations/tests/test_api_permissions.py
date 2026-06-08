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
