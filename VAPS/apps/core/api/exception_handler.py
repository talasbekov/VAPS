"""Single DRF exception handler — the only place errors become responses.

Every error is rendered as the canonical §36 envelope
``{error_code, message, details, request_id, timestamp}``. Wired via
``REST_FRAMEWORK["EXCEPTION_HANDLER"]``. MUST NOT be bypassed by ``try/except``
+ manual ``Response`` in views (architecture.md §Format Patterns).

Code mapping honors the closed world: every ``error_code`` emitted here exists
in ``docs/registries/error-codes.yaml`` (asserted by the AC-8 test).
"""

import logging
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, OperationalError
from rest_framework.views import exception_handler as drf_exception_handler

from apps.core.clock import Clock
from apps.core.exceptions import DomainError

logger = logging.getLogger(__name__)

# constraint_name → (error_code, http_status, overridable). Closed world: every
# code MUST be in error-codes.yaml. Grows as stories introduce constraints.
# Решение №1 (story 3.1): hard-status overlap → 422 (registry + FR-11).
CONSTRAINT_ERROR_MAP = {
    "excl_hard_status_overlap": ("OVERLAPPING_HARD_STATUS", 422, False),
    # 5.3b: submit_day pre-checks the duplicate (409 DAY_ALREADY_SUBMITTED); this
    # is the RACE backstop — two concurrent сдачи trip the partial-unique, which
    # would otherwise surface as 500. Maps it to the same 409.
    "unique_daily_submission_current": ("DAY_ALREADY_SUBMITTED", 409, False),
    # Two concurrent FIRST сдачи both INSERT (div, date, v=1, is_current=True),
    # violating BOTH unique indexes at once; which one Postgres reports depends on
    # index check order — NOT contractual (pg_dump/restore reorders OIDs). Map the
    # version index to the same 409 so the race surfaces consistently, never 500.
    "unique_daily_submission_version": ("DAY_ALREADY_SUBMITTED", 409, False),
}

# DRF-handled HTTP status → registry code (re-shaped into the §36 envelope).
# Statuses without a registry code (405, 406, 415, 429, …) keep DRF-native
# shape rather than fabricate a code outside the closed world.
_DRF_STATUS_TO_CODE = {
    400: "VALIDATION_ERROR",
    401: "AUTH_REQUIRED",
    403: "PERMISSION_DENIED",
    404: "ENTITY_NOT_FOUND",
}

_DEFAULT_MESSAGES = {
    "VALIDATION_ERROR": "Проверьте заполнение формы.",
    "OVERLAPPING_HARD_STATUS": "Статус конфликтует с hard-статусом сотрудника.",
    "INTERNAL_ERROR": "Внутренняя ошибка сервера.",
}


def emitted_codes():
    """All error codes this handler can emit — for the closed-world AC-8 test."""
    codes = {code for code, _status, _ov in CONSTRAINT_ERROR_MAP.values()}
    codes |= set(_DRF_STATUS_TO_CODE.values())
    codes.add("INTERNAL_ERROR")
    return codes


def _timestamp():
    return Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)).isoformat()


def _request_id(context):
    # request-id infra is story 4.3; the field is present but null until then.
    request = (context or {}).get("request")
    return getattr(request, "request_id", None)


def _envelope(error_code, message, details, http_status, context):
    from rest_framework.response import Response

    return Response(
        {
            "error_code": error_code,
            "message": message or error_code,
            "details": details if details is not None else {},
            "request_id": _request_id(context),
            "timestamp": _timestamp(),
        },
        status=http_status,
    )


def _internal_error(context):
    return _envelope(
        "INTERNAL_ERROR", _DEFAULT_MESSAGES["INTERNAL_ERROR"], {}, 500, context
    )


def _constraint_name(exc):
    # psycopg3 exposes the violated constraint via diagnostics — robust across
    # locales and renames, unlike substring-matching the DB message.
    diag = getattr(getattr(exc, "__cause__", None), "diag", None)
    return getattr(diag, "constraint_name", None)


# Postgres SQLSTATEs meaning "retryable conflict", NOT an infra failure:
# 40P01 deadlock_detected, 40001 serialization_failure (deferred-work.md L31).
# Every other OperationalError (connection lost, timeout, shutdown, disk full)
# is a real 5xx and MUST NOT be reported as a business-rule conflict.
_CONFLICT_SQLSTATES = frozenset({"40P01", "40001"})


def _is_conflict_sqlstate(exc):
    sqlstate = getattr(getattr(exc, "__cause__", None), "sqlstate", None)
    return sqlstate in _CONFLICT_SQLSTATES


def _reshape_drf(response, context):
    code = _DRF_STATUS_TO_CODE.get(response.status_code)
    if code is None:
        return response  # no registry code for this status → keep DRF-native
    data = response.data
    # Only the scalar top-level {"detail": "..."} message form (403/404/parse)
    # collapses to a message. A dict whose "detail" is a list — or a serializer
    # field literally named "detail" — is field errors: preserve them.
    if isinstance(data, dict) and isinstance(data.get("detail"), str):
        message, details = str(data["detail"]), {}
    elif isinstance(data, dict):
        message, details = _DEFAULT_MESSAGES.get(code, code), data
    elif isinstance(data, list):
        message, details = _DEFAULT_MESSAGES.get(code, code), {"non_field_errors": data}
    else:
        message, details = str(data), {}
    response.data = {
        "error_code": code,
        "message": message,
        "details": details,
        "request_id": _request_id(context),
        "timestamp": _timestamp(),
    }
    return response


def domain_exception_handler(exc, context):
    """Render any exception into the §36 envelope (the sole error-shaping point)."""
    # 1. Our own domain errors — explicit code / status / details.
    if isinstance(exc, DomainError):
        return _envelope(exc.code, exc.message, exc.detail, exc.http_status, context)

    # 2. DB integrity violation — map by constraint name (psycopg3 diag).
    if isinstance(exc, IntegrityError):
        mapped = CONSTRAINT_ERROR_MAP.get(_constraint_name(exc))
        if mapped is not None:
            code, http_status, _ov = mapped
            return _envelope(
                code, _DEFAULT_MESSAGES.get(code), {}, http_status, context
            )
        logger.error("Unmapped IntegrityError constraint=%r", _constraint_name(exc))
        return _internal_error(context)

    # 3. Deadlock / serialization failure ONLY — a symmetric hard-insert race
    #    resolves via DeadlockDetected with no constraint name. Narrow to the
    #    two conflict SQLSTATEs; every other OperationalError (connection lost,
    #    timeout, shutdown) falls through to a real 500 (deferred-work.md L31).
    if isinstance(exc, OperationalError) and _is_conflict_sqlstate(exc):
        logger.warning("Deadlock/serialization treated as conflict: %s", exc)
        code, http_status, _ov = CONSTRAINT_ERROR_MAP["excl_hard_status_overlap"]
        return _envelope(code, _DEFAULT_MESSAGES.get(code), {}, http_status, context)

    # 4. Anything DRF understands (DRF ValidationError → 400, PermissionDenied →
    #    403, Http404 → 404, 405, throttling). Delegate, then re-shape to §36.
    response = drf_exception_handler(exc, context)
    if response is not None:
        return _reshape_drf(response, context)

    # 5. Unknown exception (incl. the DataError generated-column path, L32) —
    #    never leak internals; the semantic 422 for date ordering is story 3.3.
    logger.exception("Unhandled exception surfaced to the API boundary")
    return _internal_error(context)
