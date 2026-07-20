"""Story 11.1 — WebSocket identity: resolve ``scope["actor_id"]`` on handshake.

The ASGI mirror of the DRF auth chain (``build_auth_classes``, settings 5.1) and
it lives here — under ``apps/core/auth/`` — because the ``X-User-Id`` literal may
appear nowhere else (ARCH-SEC-030, guarded by
``apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth``).

Fail-closed, exactly like REST:

- JWT configured (prod) → the actor comes ONLY from a verified ``?token=<jwt>``,
  checked by the same ``verify_jwt_sub`` the REST path uses. The unsigned
  ``X-User-Id`` dev header is ignored outright — a configured issuer must not be
  bypassable by a header anyone can type.
- JWT not configured (dev/tests) → ``X-User-Id`` header or ``?user_id=``. Identity
  spoofing is possible here BY DESIGN — the very same property the existing REST
  stand-in ``XUserIdAuthentication`` has. The guard against it is not in this
  module but in ``jwt_config_from_env``: production (DEBUG=False) refuses to boot
  without JWT at all.

Why the token rides in the query string: a browser ``WebSocket`` cannot set an
``Authorization`` header, so the whole REST identity transport is physically
unavailable to the 11.3 client (Решение №1). The cost — the token lands in access
logs — is paid in 12.1, where nginx logs ``$uri`` without ``$args`` for ``/ws/``.

An invalid/expired token resolves to ``actor_id = None`` rather than raising: the
refusal belongs to the consumer, which closes the handshake with 4403 (AC-4).
Raising here would surface as an opaque ASGI 500 with no close code.
"""

import logging
from urllib.parse import parse_qs

from channels.middleware import BaseMiddleware
from rest_framework.exceptions import AuthenticationFailed

from apps.core.auth.authentication import _jwt_config, verify_jwt_sub

logger = logging.getLogger(__name__)


def _query_params(scope):
    """``scope["query_string"]`` is raw ``bytes`` (not a parsed QueryDict)."""
    return parse_qs(scope.get("query_string", b"").decode("utf-8", "replace"))


def _header(scope, name: str):
    """First value of *name* from ``scope["headers"]`` — a list of ``bytes`` pairs
    with lower-cased names, NOT a ``request.headers`` mapping."""
    wanted = name.lower().encode()
    for key, value in scope.get("headers", []):
        if key.lower() == wanted:
            return value.decode("utf-8", "replace")
    return None


def _first(params, key):
    values = params.get(key) or []
    return values[0] if values else None


def resolve_actor_id(scope):
    """Server-side identity for a WS handshake, or ``None``. Never trusts a
    client-supplied id when an external-Auth JWT is configured."""
    params = _query_params(scope)
    cfg = _jwt_config()
    if cfg is not None:
        token = _first(params, "token")
        if not token:
            return None
        try:
            return verify_jwt_sub(token, cfg)
        except AuthenticationFailed:
            # No actor id, no payload — nothing here is safe to log verbatim.
            logger.info("ws handshake rejected: invalid token")
            return None
    # JWT disabled (dev/tests) — mirror of XUserIdAuthentication: strip, and treat
    # a whitespace-only value as absent (a truthy-but-blank actor_id would slip
    # past truthiness gates downstream).
    raw = _header(scope, "X-User-Id") or _first(params, "user_id") or ""
    return raw.strip() or None


class ActorIdMiddleware(BaseMiddleware):
    """Put the server-resolved actor id into the scope before routing."""

    async def __call__(self, scope, receive, send):
        # Copy: the scope dict is shared with the outer server, and mutating it in
        # place is the canonical Channels footgun.
        scope = dict(scope)
        scope["actor_id"] = resolve_actor_id(scope)
        return await super().__call__(scope, receive, send)
