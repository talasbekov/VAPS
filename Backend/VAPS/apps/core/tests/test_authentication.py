import pytest
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.request import Request

from apps.core.auth.authentication import XUserIdAuthentication

pytestmark = pytest.mark.django_db


def _drf_request(**extra):
    return Request(APIRequestFactory().get("/", **extra))


def test_authenticate_sets_actor_id_from_header():
    request = _drf_request(HTTP_X_USER_ID="u123")
    result = XUserIdAuthentication().authenticate(request)
    assert result is None
    assert request.actor_id == "u123"


def test_authenticate_without_header_leaves_actor_id_unset():
    request = _drf_request()
    result = XUserIdAuthentication().authenticate(request)
    assert result is None
    assert getattr(request, "actor_id", None) is None


def test_actor_id_visible_in_view_through_full_dispatch():
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="u123")
    # my-permissions reads request.actor_id; an empty permission set still
    # proves the header travelled through authentication into the view.
    response = client.get("/api/operations/my-permissions/")
    assert response.status_code == 200
    assert response.data == {"permissions": []}


def test_protected_endpoint_without_header_returns_403():
    response = APIClient().get("/api/operations/my-permissions/")
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"


def test_create_user_uuid_pk_unusable_password_active():
    import uuid

    from apps.core.models import User

    user = User.objects.create_user("u123")
    assert isinstance(user.pk, uuid.UUID)
    assert not user.has_usable_password()
    assert user.is_active
    assert user.username == "u123"
    assert User.USERNAME_FIELD == "username"


def test_create_user_rejects_empty_username():
    from apps.core.models import User

    with pytest.raises(ValueError):
        User.objects.create_user("")


def test_create_superuser_creates_admin_user():
    # Story 2.8: Django superusers now exist for the catalog Admin (FR-33
    # reversed for the admin surface only; business RBAC stays the in-house
    # PermissionService).
    from apps.core.models import User

    user = User.objects.create_superuser("root", "pw")
    assert user.is_staff
    assert user.is_superuser
    assert user.check_password("pw")
