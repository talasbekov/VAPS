"""Story 4.3 — request-scoped context (request_id, client IP, user agent).

The single home of the request_id contextvar. architecture.md §Service
Patterns: "request_id: middleware → contextvar; аудит-сервис читает сам" — the
audit write service (``apps.audit.services.record``) reads this context ITSELF
rather than having request_id / IP / user_agent threaded as parameters through
every domain service signature.

Mirrors ``apps/core/clock.py``: a module-level ``ContextVar`` set with a token
and ``reset`` in a ``finally`` so nothing leaks across requests (thread / worker
reuse). The middleware is registered FIRST (outermost) in ``MIDDLEWARE`` so the
request_id wraps the whole request/response, and it stamps ``request.request_id``
for the §36 error envelope (``apps/core/api/exception_handler._request_id``).
"""

import uuid
from contextvars import ContextVar
from dataclasses import dataclass

# audit_logs.request_id is CharField(max_length=100) — keep the id within it.
_REQUEST_ID_MAX = 100


@dataclass(frozen=True)
class RequestContext:
    request_id: str = ""
    ip_address: str = ""
    user_agent: str = ""


_EMPTY_CONTEXT = RequestContext()

_request_ctx: ContextVar[RequestContext | None] = ContextVar(
    "request_ctx", default=None
)


def get_request_context() -> RequestContext:
    """The active request context, or an empty one outside any request."""
    return _request_ctx.get() or _EMPTY_CONTEXT


def get_request_id() -> str:
    """The current request's id, or "" outside a request (system/Celery path)."""
    return get_request_context().request_id


class RequestContextMiddleware:
    """Populate the request-context contextvar for each request's lifetime."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Accept a client-supplied id only when it is safe to store and reflect
        # back in a response header; otherwise mint one. Guards blank/whitespace
        # ids and header-injection 500s (CRLF / control chars → BadHeaderError,
        # non-latin-1 → UnicodeEncodeError when set on the response header).
        incoming = (request.headers.get("X-Request-Id") or "").strip()
        if not incoming.isascii() or not incoming.isprintable():
            incoming = ""
        request_id = (incoming or uuid.uuid4().hex)[:_REQUEST_ID_MAX]
        ctx = RequestContext(
            request_id=request_id,
            ip_address=request.META.get("REMOTE_ADDR") or "",
            user_agent=request.headers.get("User-Agent", ""),
        )
        token = _request_ctx.set(ctx)
        request.request_id = request_id
        try:
            response = self.get_response(request)
        finally:
            _request_ctx.reset(token)
        response["X-Request-Id"] = request_id
        return response
