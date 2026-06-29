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
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core.auth.authentication import JWTAuthentication, XUserIdAuthentication
from config.settings import build_auth_classes, jwt_config_from_env

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
@pytest.mark.parametrize(
    "bad_sub", ["", "   ", "x" * 101, "line\nbreak", "op 1", "a\tb"]
)
def test_invalid_sub_rejected(bad_sub):
    # empty / whitespace-only / over-long / non-printable / inner-whitespace
    request = _request(f"Bearer {_token(sub=bad_sub)}")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(request)


@override_settings(VAPS_JWT=_JWT_CFG)
def test_padded_sub_is_stripped():
    # leading/trailing whitespace is normalised away (not an inner-space reject)
    request = _request(f"Bearer {_token(sub='  op-1  ')}")
    JWTAuthentication().authenticate(request)
    assert request.actor_id == "op-1"


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


def test_authenticate_header_is_bearer():
    # makes DRF answer a failed token with 401 (+ WWW-Authenticate), not 403 (review P2)
    assert JWTAuthentication().authenticate_header(_request()) == "Bearer"


@override_settings(VAPS_JWT=_JWT_CFG)
@pytest.mark.parametrize("hdr", ["Bearer", "Bearer a b"])
def test_malformed_bearer_rejected_not_downgraded(hdr):
    # our scheme but structurally broken → 401, NOT a silent fall-through (review P6)
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(_request(hdr))


# --- RS256 (the production default — review P7: was untested) -----------------
_RSA_CACHE = {}


def _rsa_keys():
    if "priv" not in _RSA_CACHE:
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _RSA_CACHE["priv"] = priv.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        _RSA_CACHE["pub"] = priv.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    return _RSA_CACHE["priv"], _RSA_CACHE["pub"]


def _rs_token(priv, sub="op-rs", exp_delta=3600, alg="RS256", **claims):
    payload = {
        "sub": sub,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_delta),
        **claims,
    }
    return jwt.encode(payload, priv, algorithm=alg)


def _rs_cfg(pub, **over):
    return {
        "key": pub,
        "algorithms": ["RS256"],
        "audience": None,
        "issuer": None,
        "leeway": 0,
        **over,
    }


def test_valid_rs256_token_sets_actor_id():
    priv, pub = _rsa_keys()
    with override_settings(VAPS_JWT=_rs_cfg(pub)):
        request = _request(f"Bearer {_rs_token(priv, sub='op-rs')}")
        JWTAuthentication().authenticate(request)
    assert request.actor_id == "op-rs"


def test_rs_hs_confusion_rejected():
    # the RS/HS-confusion vector: a token claiming alg=HS256 is rejected by an
    # RS256-only allowlist — the verifier never tries the RSA public key as an HMAC
    # secret. (The config layer separately forbids mixing HS*+RS* in one allowlist;
    # and PyJWT itself refuses to even sign HS256 with a PEM key.)
    priv, pub = _rsa_keys()
    forged = jwt.encode(
        {"sub": "attacker", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "attacker-controlled-hmac-secret-" + "0" * 32,
        algorithm="HS256",
    )
    with override_settings(VAPS_JWT=_rs_cfg(pub)):
        with pytest.raises(AuthenticationFailed):
            JWTAuthentication().authenticate(_request(f"Bearer {forged}"))


def test_bad_key_raises_401_not_500():
    # a non-PEM key with RS256 → PyJWT InvalidKeyError (NOT InvalidTokenError); must be
    # caught (PyJWTError) → AuthenticationFailed, never an unhandled 500 (review P1).
    priv, pub = _rsa_keys()
    with override_settings(VAPS_JWT=_rs_cfg("not-a-valid-pem")):
        with pytest.raises(AuthenticationFailed):
            JWTAuthentication().authenticate(_request(f"Bearer {_rs_token(priv)}"))


# --- audience / issuer (review D2: was unverified by default) -----------------


@override_settings(VAPS_JWT={**_JWT_CFG, "audience": "vaps"})
def test_wrong_audience_rejected():
    tok = _token(sub="op", aud="other-service")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(_request(f"Bearer {tok}"))


@override_settings(VAPS_JWT={**_JWT_CFG, "audience": "vaps"})
def test_matching_audience_accepted():
    request = _request(f"Bearer {_token(sub='op', aud='vaps')}")
    JWTAuthentication().authenticate(request)
    assert request.actor_id == "op"


@override_settings(VAPS_JWT={**_JWT_CFG, "issuer": "good-iss"})
def test_wrong_issuer_rejected():
    tok = _token(sub="op", iss="bad-iss")
    with pytest.raises(AuthenticationFailed):
        JWTAuthentication().authenticate(_request(f"Bearer {tok}"))


# --- config validation + chain composition (review D1/P3/P4) -----------------


def test_build_auth_classes_excludes_xuserid_when_jwt_configured():
    classes = build_auth_classes({"key": "k", "algorithms": ["RS256"]})
    assert classes[0].endswith("JWTAuthentication")
    assert not any("XUserIdAuthentication" in c for c in classes)


def test_build_auth_classes_includes_xuserid_in_dev():
    assert any("XUserIdAuthentication" in c for c in build_auth_classes(None))


def test_jwt_config_dev_no_key_is_none():
    assert jwt_config_from_env({}, debug=True) is None


def test_jwt_config_prod_no_key_fails_closed():
    with pytest.raises(ImproperlyConfigured):
        jwt_config_from_env({}, debug=False)


def test_jwt_config_prod_requires_audience():
    with pytest.raises(ImproperlyConfigured):
        jwt_config_from_env({"VAPS_JWT_KEY": "k"}, debug=False)


def test_jwt_config_empty_algorithms_rejected():
    with pytest.raises(ImproperlyConfigured):
        jwt_config_from_env(
            {"VAPS_JWT_KEY": "k", "VAPS_JWT_ALGORITHMS": " "}, debug=True
        )


def test_jwt_config_rs_hs_mixing_rejected():
    with pytest.raises(ImproperlyConfigured):
        jwt_config_from_env(
            {"VAPS_JWT_KEY": "k", "VAPS_JWT_ALGORITHMS": "RS256,HS256"}, debug=True
        )


@pytest.mark.parametrize("leeway", ["abc", "-1", "999"])
def test_jwt_config_bad_leeway_rejected(leeway):
    with pytest.raises(ImproperlyConfigured):
        jwt_config_from_env(
            {"VAPS_JWT_KEY": "k", "VAPS_JWT_LEEWAY": leeway}, debug=True
        )


def test_jwt_config_valid_prod():
    cfg = jwt_config_from_env(
        {
            "VAPS_JWT_KEY": "pub",
            "VAPS_JWT_AUDIENCE": "vaps",
            "VAPS_JWT_ALGORITHMS": "RS256",
        },
        debug=False,
    )
    assert cfg["audience"] == "vaps"
    assert cfg["algorithms"] == ["RS256"]
