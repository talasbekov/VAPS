"""Story 13.1a — AC-4's unit serializer round-trip: validate → build the
model instance → serialize → confirm every field survives, without going
through HTTP (that's test_bugreport_api.py's job).
"""

import pytest

from apps.operations.bugreports.api.serializers import (
    BugReportCreateSerializer,
    BugReportSerializer,
)
from apps.operations.bugreports.models import BugReport

pytestmark = pytest.mark.django_db


def test_create_serializer_round_trip_through_the_model():
    form = BugReportCreateSerializer(
        data={
            "screen_path": "/daily-update",
            "app_version": "1.0.0",
            "build_sha": "deadbeef",
            "last_request_ids": ["req-a", "req-b"],
            "description": "тест сериализации",
        }
    )
    assert form.is_valid(), form.errors
    report = BugReport.objects.create(
        user_id="unit-test-user", created_by="unit-test-user", **form.validated_data
    )

    out = BugReportSerializer(report).data
    assert out["user_id"] == "unit-test-user"
    assert out["screen_path"] == "/daily-update"
    assert out["app_version"] == "1.0.0"
    assert out["build_sha"] == "deadbeef"
    assert out["last_request_ids"] == ["req-a", "req-b"]
    assert out["description"] == "тест сериализации"


def test_create_serializer_defaults_last_request_ids_to_empty_list():
    form = BugReportCreateSerializer(
        data={"screen_path": "/x", "description": "без request_ids"}
    )
    assert form.is_valid(), form.errors
    assert form.validated_data["last_request_ids"] == []


def test_create_serializer_rejects_too_many_request_ids():
    form = BugReportCreateSerializer(
        data={
            "screen_path": "/x",
            "description": "y",
            "last_request_ids": [f"req-{i}" for i in range(21)],
        }
    )
    assert not form.is_valid()
    assert "last_request_ids" in form.errors
