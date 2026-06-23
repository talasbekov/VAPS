"""Story 2.13 — core API permission seam + gate (pilot).

The operations authz seam (``EffectivePermissionsResolver``) attaches
``request.effective_permissions`` after identity; the core gate
(``apps/core/api/permissions.py::require_permission``) authorizes off that
attribute without importing operations (ARCH#L585 «core ↛ all»).
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

pytestmark = pytest.mark.django_db


def _resolved_request(**extra):
    """Run a request through the auth chain in DEFAULT_AUTHENTICATION_CLASSES
    order (identity sets actor_id, then the resolver attaches perms)."""
    request = Request(APIRequestFactory().get("/", **extra))
    XUserIdAuthentication().authenticate(request)
    EffectivePermissionsResolver().authenticate(request)
    return request


# -- seam --------------------------------------------------------------------


def test_seam_resolves_effective_permissions_for_actor():
    call_command("seed_operations")
    UserRole.objects.create(user_id="viewer-1", role_code_id="VIEWER")
    request = _resolved_request(HTTP_X_USER_ID="viewer-1")
    assert "personnel.view" in request.effective_permissions


def test_seam_empty_set_for_anonymous():
    request = _resolved_request()  # no identity header
    assert request.effective_permissions == set()


# -- core gate ---------------------------------------------------------------


def test_gate_denies_without_actor():
    request = _resolved_request()  # anonymous
    with pytest.raises(PermissionDenied):
        require_permission(request, "personnel.view")


def test_gate_denies_actor_without_permission():
    call_command("seed_operations")
    UserRole.objects.create(user_id="int-1", role_code_id="INTEGRATION_USER")
    request = _resolved_request(HTTP_X_USER_ID="int-1")
    # INTEGRATION_USER holds no personnel.view (provisional map).
    with pytest.raises(PermissionDenied):
        require_permission(request, "personnel.view")


def test_gate_allows_holder():
    call_command("seed_operations")
    UserRole.objects.create(user_id="viewer-1", role_code_id="VIEWER")
    request = _resolved_request(HTTP_X_USER_ID="viewer-1")
    require_permission(request, "personnel.view")  # must not raise


def test_gate_wildcard_admin_allows_any_code():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    request = _resolved_request(HTTP_X_USER_ID="admin-1")
    require_permission(request, "personnel.view")  # ADMIN holds * → allowed


def test_gate_fails_closed_when_seam_did_not_run():
    # Defensive: an actor with no effective_permissions attribute (seam skipped)
    # must be denied, never silently allowed.
    request = Request(APIRequestFactory().get("/"))
    request.actor_id = "ghost"
    with pytest.raises(PermissionDenied):
        require_permission(request, "personnel.view")


def test_auth_class_order_is_identity_then_resolver():
    # Load-bearing order: XUserIdAuthentication must run BEFORE the resolver so
    # request.actor_id is set when the resolver reads it. A reversed order would
    # silently resolve every caller to set() → deny all valid users. Pin it so a
    # settings reorder fails loudly here, not as a prod authz regression.
    from django.conf import settings

    classes = settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]
    identity = "apps.core.auth.authentication.XUserIdAuthentication"
    resolver = "apps.operations.api.authz.EffectivePermissionsResolver"
    assert identity in classes and resolver in classes
    assert classes.index(identity) < classes.index(resolver)


def test_gated_viewsets_map_every_served_action():
    # Defense-in-depth (story 2.14 review): every action the router actually
    # serves on a gated ViewSet must be in its permission_map — else the mixin
    # fail-closes it to a misleading 403. Complements the rbac-matrix's
    # transitive coverage with a direct map↔served assertion.
    from django.urls import get_resolver
    from django.urls.resolvers import URLPattern, URLResolver

    from apps.core.api.permissions import RequirePermissionMixin

    def _walk(resolver):
        for pattern in resolver.url_patterns:
            if isinstance(pattern, URLResolver):
                yield from _walk(pattern)
            elif isinstance(pattern, URLPattern):
                cls = getattr(pattern.callback, "cls", None)
                actions = getattr(pattern.callback, "actions", None)
                if cls is not None and actions:
                    yield cls, actions

    # The router action_map carries update/destroy for every ModelViewSet; only
    # methods in http_method_names are actually served (the rest → 405, which
    # the mixin skips). Mirror that filter so we assert against SERVED actions.
    served = {}
    for cls, actions in _walk(get_resolver()):
        if issubclass(cls, RequirePermissionMixin):
            allowed = {m.lower() for m in cls.http_method_names}
            names = {a for m, a in actions.items() if m.lower() in allowed}
            served.setdefault(cls, set()).update(names)

    assert served, "no RequirePermissionMixin ViewSets discovered (resolver?)"
    for cls, action_names in served.items():
        missing = action_names - set(cls.permission_map)
        assert not missing, (
            f"{cls.__name__}: served actions not in permission_map: {missing}"
        )
