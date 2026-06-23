"""Story 2.14: the core gate (``apps/core/api/permissions.require_permission``)
duplicates the ``*`` wildcard short-circuit of
``PermissionService.has_permission`` — core ↛ operations (ARCH#L585) forbids
sharing the function. This parity test pins the two in sync, so a future change
to PermissionService wildcard/membership semantics fails here instead of
silently diverging the core gate (deferred from code review of story 2.13).
"""

import pytest
from django.core.management import call_command
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core.api.permissions import require_permission
from apps.core.auth.authentication import XUserIdAuthentication
from apps.operations.api.authz import EffectivePermissionsResolver
from apps.operations.rbac.models import UserRole
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


def _request(user_id=None):
    extra = {"HTTP_X_USER_ID": user_id} if user_id else {}
    request = Request(APIRequestFactory().get("/", **extra))
    XUserIdAuthentication().authenticate(request)
    EffectivePermissionsResolver().authenticate(request)
    return request


@pytest.mark.parametrize(
    "role,code",
    [
        ("VIEWER", "personnel.view"),  # holder
        ("VIEWER", "personnel.edit"),  # non-holder
        ("ORGD", "personnel.edit"),  # holder
        ("ORGD", "orgstructure.manage"),  # holder
        ("ADMIN", "personnel.edit"),  # wildcard holder
        ("ADMIN", "anything.unknown"),  # wildcard covers unknown code
        ("INTEGRATION_USER", "personnel.view"),  # non-holder (no core perms)
    ],
)
def test_core_gate_matches_permission_service(role, code):
    call_command("seed_operations")
    user_id = f"{role.lower()}-parity"
    UserRole.objects.create(user_id=user_id, role_code_id=role)
    request = _request(user_id)

    service_allows = PermissionService.has_permission(user_id, code)
    gate_raised = False
    try:
        require_permission(request, code)
    except PermissionDenied:
        gate_raised = True

    assert gate_raised == (not service_allows), (
        f"{role}/{code}: gate_raised={gate_raised}, "
        f"service_allows={service_allows}"
    )


def test_core_gate_denies_anonymous():
    # No actor → gate raises on the actor_id check (service has no identity to
    # grant). Anonymous is always denied, mirroring an empty permission set.
    request = _request()  # no identity header
    with pytest.raises(PermissionDenied):
        require_permission(request, "personnel.view")
