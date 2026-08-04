"""Обработчик исключений: конверт для ошибок раздела ОМ — и НЕТРОНУТАЯ
форма ответа для всего остального.

Второе важнее первого: обработчик глобальный, и если бы он переформатировал
чужие ошибки, старые экраны сломались бы молча.
"""
import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError
from rest_framework.test import APIClient

from organization_management.apps.operations.api.exception_handler import (
    ops_exception_handler,
)
from organization_management.apps.operations.exceptions import DomainError


class FakeDiag:
    def __init__(self, constraint_name):
        self.constraint_name = constraint_name


class FakeCause(Exception):
    def __init__(self, constraint_name):
        self.diag = FakeDiag(constraint_name)


def test_domain_error_becomes_envelope():
    exc = DomainError(
        "OVERLAPPING_HARD_STATUS",
        422,
        detail={"employee_id": "7"},
        message="Конфликт",
    )
    response = ops_exception_handler(exc, {})
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert response.data["message"] == "Конфликт"
    assert response.data["details"] == {"employee_id": "7"}
    assert set(response.data) >= {
        "error_code", "message", "details", "request_id", "timestamp"
    }


def test_overridable_is_visible_in_payload():
    # Клиент не должен угадывать обходимость по коду ошибки.
    exc = DomainError("STATUS_OVERLAP_WARNING", 409, overridable=True)
    assert ops_exception_handler(exc, {}).data["overridable"] is True

    plain = ops_exception_handler(DomainError("X", 422), {})
    assert "overridable" not in plain.data


def test_known_constraint_race_is_not_500():
    exc = IntegrityError("duplicate")
    exc.__cause__ = FakeCause("excl_hard_status_overlap")
    response = ops_exception_handler(exc, {})
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"


def test_unknown_constraint_is_not_swallowed():
    # Незнакомое ограничение — честная 500 через DRF, а не выдуманный код.
    exc = IntegrityError("duplicate")
    exc.__cause__ = FakeCause("some_other_constraint")
    assert ops_exception_handler(exc, {}) is None


@pytest.mark.django_db
def test_foreign_errors_keep_drf_shape():
    # Ответ ЧУЖОЙ вьюхи (старая система) обязан сохранить прежнюю форму:
    # detail-строка DRF, без полей конверта.
    user = User.objects.create_user(username="plain", password="x")
    api = APIClient()
    api.force_authenticate(user)
    response = api.get("/api/operations/roles/")  # прав нет → 403 от DRF
    assert response.status_code == 403
    assert "detail" in response.data
    assert "error_code" not in response.data
