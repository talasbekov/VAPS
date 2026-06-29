import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class XUserIdAuthentication(BaseAuthentication):
    """Single identity-extraction point (ARCH-SEC-030).

    MVP stand-in for the JWT `sub` claim (spec §7007): the external auth
    account id arrives in the X-User-Id header. On the move to JWT ONLY this
    class changes; everything downstream keys on `request.actor_id`.

    No AuthenticationFailed on a missing header: a 401 here would mask the
    403 PERMISSION_DENIED contract enforced by the permission layer. No User
    DB lookup per request: downstream keys on the actor_id string (ARCH-007).
    """

    def authenticate(self, request):
        user_id = request.headers.get("X-User-Id")
        if user_id:
            request.actor_id = user_id
        return None


def _jwt_config():
    """JWT verification params from settings (env-driven, story 5.1). Returns None
    when JWT is not configured (dev/tests without an external Auth) — the class then
    no-ops and the X-User-Id path handles identity."""
    cfg = getattr(settings, "VAPS_JWT", None)
    if not cfg or not cfg.get("key") or not cfg.get("algorithms"):
        return None
    return cfg


class JWTAuthentication(BaseAuthentication):
    """External-Auth JWT identity (ARCH-SEC-030). First in the chain; the X-User-Id
    stand-in is present ONLY when JWT is not configured (dev) — review D1 in settings.

    - Bearer present + valid → ``request.actor_id = sub``, return None (continue).
    - Bearer present (our scheme) but malformed / invalid (bad signature / expired /
      disallowed alg / bad aud-iss / no valid sub) → ``AuthenticationFailed`` → **401**
      (``authenticate_header`` makes DRF return 401, not 403): a presented-but-broken
      token must NOT silently downgrade to the X-User-Id dev path.
    - No Bearer / a non-Bearer scheme → return None (chain continues).
    - JWT not configured (dev/tests) → return None (a Bearer is ignored).

    Verification is explicit (this IS auth): the ``algorithms`` allowlist comes from
    config and never includes ``none`` (config also rejects mixing HS*+RS*); signature
    + ``exp``/``nbf``/``iat`` (leeway) checked, plus ``aud``/``iss`` (required when
    configured; audience is mandatory in prod — review D2). No User DB lookup —
    ``actor_id`` is a string (ARCH-007); no passwords — the issuer's signature is the
    only trust anchor. ``sub`` is stripped and must be non-empty, ≤100, printable, no
    inner whitespace (the value keys permission lookups + audit attribution).
    """

    keyword = "Bearer"

    def authenticate_header(self, request):
        # Make DRF answer a failed token with 401 + ``WWW-Authenticate: Bearer``
        # (RFC 6750) instead of the default 403.
        return self.keyword

    def authenticate(self, request):
        header = request.headers.get("Authorization")
        if not header:
            return None
        parts = header.split()
        if not parts or parts[0].lower() != self.keyword.lower():
            return None  # not a Bearer scheme → not ours; the chain continues
        cfg = _jwt_config()
        if cfg is None:
            return None  # JWT disabled (dev/tests) → X-User-Id path handles identity
        if len(parts) != 2:
            # our scheme but malformed ("Bearer", "Bearer a b") → 401, NOT a downgrade
            raise AuthenticationFailed("INVALID_TOKEN")
        require = ["exp", "sub"]
        if cfg.get("audience"):
            require.append("aud")
        if cfg.get("issuer"):
            require.append("iss")
        try:
            payload = jwt.decode(
                parts[1],
                cfg["key"],
                algorithms=cfg["algorithms"],
                audience=cfg.get("audience"),
                issuer=cfg.get("issuer"),
                leeway=cfg.get("leeway", 0),
                options={
                    "require": require,
                    "verify_aud": cfg.get("audience") is not None,
                },
            )
        except jwt.PyJWTError as exc:
            # PyJWTError (not only InvalidTokenError) also catches a misconfigured-key
            # InvalidKeyError → hard 401, no downgrade to X-User-Id, no unhandled 500.
            raise AuthenticationFailed("INVALID_TOKEN") from exc
        sub = payload.get("sub")
        if not isinstance(sub, str):
            raise AuthenticationFailed("INVALID_TOKEN")
        sub = sub.strip()
        if (
            not sub
            or len(sub) > 100
            or not sub.isprintable()
            or any(c.isspace() for c in sub)
        ):
            # exact actor id only — no padded / whitespace-bearing / non-printable sub
            raise AuthenticationFailed("INVALID_TOKEN")
        request.actor_id = sub
        return None
