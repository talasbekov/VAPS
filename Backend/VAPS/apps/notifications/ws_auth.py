"""Story 11.1 — WS handshake identity extraction.

Channels consumers do NOT see the DRF authentication chain
(``apps/core/auth/authentication.py`` holds ``BaseAuthentication`` classes
invoked by the DRF view dispatcher over HTTP requests only, per ARCH-SEC-030 —
that module is the SOLE reader of the dev identity header stand-in, a
boundary enforced by ``apps/core/tests/test_isolation.py``) — the ASGI/WS
path needs its own, separate identity-extraction step at connect time, and
deliberately does NOT read that HTTP header at all.

**Mechanism chosen: query-string ``?token=<actor_id>``.** The browser
``WebSocket`` constructor cannot set arbitrary headers (no ``Authorization``)
on the handshake request — only the URL (query-string) or the WS sub-protocol
list are available to a browser client, so a header-based stand-in (as used
on the HTTP path) is not an option here regardless of the isolation
boundary. ``token`` is literally the actor id string
(``recipient``/``username``, ARCH-007), NOT (yet) a verified JWT — full JWT
verification over the query-string is explicitly deferred to prod-hardening
(Epic 12 / Story 12.1), consistent with the story's Task 4 note ("минимальный
dev-эквивалент допустим с явной пометкой TODO/defer на прод-hardening"). This
choice is the WS-client contract for Story 11.3 — the client must open
``ws://.../ws/notifications/?token=<actor_id>``.

Sets ``scope["actor_id"]`` (mirroring ``request.actor_id`` from the HTTP
path) for the consumer to read. No actor_id / blank actor_id → the
consumer's ``connect()`` denies the connection (AC 1 implies acceptance
requires "клиент подключается ... с идентификацией"); this middleware itself
never accepts/denies — it only populates (or leaves absent)
``scope["actor_id"]``, deferring the accept/reject decision to the consumer.

TODO (Epic 12 / Story 12.1 prod-hardening): replace/extend the bare
query-string actor id with real JWT verification (reusing
``apps/core/auth/authentication.py``'s verification logic) once the WS path
needs to run outside a trusted dev/test perimeter.
"""

from urllib.parse import parse_qs


class AuthenticatedWSMiddleware:
    """ASGI middleware: extracts ``?token=`` from the WS handshake query-string
    into ``scope["actor_id"]`` before handing off to the inner application
    (URLRouter → consumer)."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        token = (params.get("token") or [""])[0].strip()
        scope = dict(scope)
        scope["actor_id"] = token or None
        return await self.inner(scope, receive, send)
