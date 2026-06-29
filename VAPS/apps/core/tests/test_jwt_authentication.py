"""Story 5.1 — JWTAuthentication: a verified external-Auth JWT's ``sub`` claim
becomes ``request.actor_id``, running BEFORE XUserIdAuthentication.

Verification is hard (this IS auth): an explicit ``algorithms`` allowlist (never
``alg:none``), signature + ``exp`` checked; a presented-but-invalid Bearer is
rejected with 401 (no silent downgrade to the X-User-Id dev path); an absent Bearer
falls through to X-User-Id. No password flow; the issuer's signature is the only
trust anchor (ARCH-SEC-030). Tests use HS256 (shared secret) to exercise the verify
logic; the production algorithm/key are config-driven.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.conf import settings
from django.test import override_settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core.auth.authentication import JWTAuthentication, XUserIdAuthentication

# ≥64 bytes so HS256/HS512 stay above PyJWT's RFC-7518 minimum (no warnings)
_SECRET = "test-secret-story-5-1-jwt-auth-" + "0" * 40
_JWT_CFG = {
    "key": _SECRET,
    "algorithms": ["HS256"],
    "audience": None,
    "issuer": None,
    "leeway": 0,
}


def _token(secret=_SECRET, alg="HS256", sub="op-1", exp_delta=3600, **claims):
    payload = {"sub": sub, **claims}
    if exp_delta is not None:
        payload["exp"] = datetime.now(timezone.utc) + timedelta(seconds=exp_delta)
    return jwt.encode(payload, secret, algorithm=alg)


def _request(authorization=None, **extra):
    if authorization is not None:
        extra["HTTP_AUTHORIZATION"] = authorization
    return Request(APIRequestFactory().get("/", **extra))


@override_settings(VAPS_JWT=_JWT_CFG)
def test_valid_jwt_sets_actor_id_from_sub():
    request = _request(f"Bearer {_token(sub='op-1')}")
    result = JWTAuthentication().authenticate(request)
    assert result is None  # returns None → DRF chain continues to the resolver
    assert request.actor_id == "op-1"


@override_settings(VAPS_JWT=_JWT_CFG)
def test_bad_signature_rejected():
    request = _request(f"Bearer {_token(secret='wrong-secret-' + 'x' * 52)}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
def test_expired_token_rejected():
    request = _request(f"Bearer {_token(exp_delta=-10)}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
def test_alg_none_rejected():
    # an unsigned (alg=none) token must NEVER be accepted by the allowlist
    unsigned = jwt.encode(
        {"sub": "op-1", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        key=None,
        algorithm="none",
    )
    request = _request(f"Bearer {unsigned}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
def test_alg_not_in_allowlist_rejected():
    # signed with HS512, but the allowlist is HS256 only → algorithm-confusion blocked
    request = _request(f"Bearer {_token(alg='HS512')}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
@pytest.mark.parametrize("bad_sub", ["", "x" * 101, "line\nbreak"])
def test_invalid_sub_rejected(bad_sub):
    request = _request(f"Bearer {_token(sub=bad_sub)}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
def test_no_bearer_falls_through_to_x_user_id():
    # No Authorization header → JWT no-ops (returns None); the X-User-Id path
    # (next in the chain) sets actor_id as before — the dev/test contract.
    request = _request(HTTP_X_USER_ID="auth-9")
    assert JWTAuthentication().authenticate(request) is None
    assert getattr(request, "actor_id", None) is None  # JWT set nothing
    XUserIdAuthentication().authenticate(request)
    assert request.actor_id == "auth-9"


@override_settings(VAPS_JWT=_JWT_CFG)
def test_non_bearer_authorization_ignored():
    # a non-Bearer Authorization (e.g. Basic) is not ours → return None, fall through
    request = _request("Basic dXNlcjpwYXNz", HTTP_X_USER_ID="auth-9")
    assert JWTAuthentication().authenticate(request) is None
    XUserIdAuthentication().authenticate(request)
    assert request.actor_id == "auth-9"


def test_jwt_disabled_when_unconfigured():
    # Default settings carry no VAPS_JWT (dev/tests) → a Bearer is ignored, so the
    # existing X-User-Id suite keeps working unchanged.
    request = _request(f"Bearer {_token()}")
    assert JWTAuthentication().authenticate(request) is None
    assert getattr(request, "actor_id", None) is None


def test_auth_class_order_jwt_then_xuserid_then_resolver():
    # Load-bearing order: JWT sets actor_id from sub, else X-User-Id (dev) does, then
    # the resolver reads actor_id. Mirrors test_api_gate.py order assertion.
    classes = settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]
    jwt_i = classes.index("apps.core.auth.authentication.JWTAuthentication")
    xuid_i = classes.index("apps.core.auth.authentication.XUserIdAuthentication")
    resolver_i = classes.index("apps.operations.api.authz.EffectivePermissionsResolver")
    assert jwt_i < xuid_i < resolver_i
