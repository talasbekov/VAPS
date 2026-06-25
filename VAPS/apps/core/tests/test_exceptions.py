"""Story 3.1 — DomainError (pure class, no DB).

DomainError is the single domain-error signal; the DRF exception_handler
renders it into the §36 envelope. These tests pin the class contract only.
"""

from apps.core.exceptions import DomainError


def test_stores_code_status_detail_overridable():
    exc = DomainError(
        "OVERLAPPING_HARD_STATUS", 422, detail={"k": "v"}, overridable=False
    )
    assert exc.code == "OVERLAPPING_HARD_STATUS"
    assert exc.http_status == 422
    assert exc.detail == {"k": "v"}
    assert exc.overridable is False


def test_detail_defaults_to_empty_dict():
    # §36 `details` is always an object; None must normalize to {} so the
    # handler never emits a null details payload.
    assert DomainError("INTERNAL_ERROR", 500).detail == {}


def test_overridable_defaults_false():
    # Only soft 409 conflicts are overridable; the safe default is False.
    assert DomainError("VALIDATION_ERROR", 400).overridable is False


def test_message_defaults_to_code():
    # Handler falls back to this when no human message is supplied.
    assert DomainError("VALIDATION_ERROR", 400).message == "VALIDATION_ERROR"
    custom = DomainError("VALIDATION_ERROR", 400, message="Bad form")
    assert custom.message == "Bad form"


def test_is_an_exception():
    # Must be raisable; str() carries code+status for logs.
    exc = DomainError("PERMISSION_DENIED", 403)
    assert isinstance(exc, Exception)
    assert "PERMISSION_DENIED" in str(exc)
