"""Domain error protocol (Story 3.1, AR-7).

``DomainError`` is the single way the codebase signals an HTTP-meaningful
business/state error. The DRF exception handler (``apps.core.api.exception_handler``)
renders it into the canonical §36 envelope ``{error_code, message, details,
request_id, timestamp}``.

Kept pure — no Django / DRF / ORM imports — so any context (core, operations,
services) can raise it without an import cycle, mirroring ``core.sorting``. The
DRF wiring lives in ``apps.core.api.exception_handler``, never here.
"""


class DomainError(Exception):
    """A business/state error with an explicit HTTP status and registry code.

    Args:
        code: ``error_code`` from ``docs/registries/error-codes.yaml`` — closed
            world: a code not in the registry must not be used (STOP and ask).
        http_status: the HTTP status the handler returns (400 form / 422
            business rule / 409 conflict / 403 / 404 / 500).
        detail: structured payload rendered as the §36 ``details`` field. The
            kwarg is singular ``detail``; the wire field is plural ``details``.
            ``None`` normalizes to ``{}`` (the envelope's ``details`` is always
            an object).
        overridable: ``True`` only for soft 409 conflicts (registry
            ``overridable: true``); the client may then retry with an
            override reason. Default ``False``.
        message: optional human-readable message; falls back to ``code``.
    """

    def __init__(self, code, http_status, detail=None, overridable=False, message=None):
        self.code = code
        self.http_status = http_status
        self.detail = detail if detail is not None else {}
        self.overridable = overridable
        self.message = message or code
        super().__init__(f"{code} ({http_status})")
