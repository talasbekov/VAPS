"""Duty kinds are editable administrative labels, with preserved references."""
import pytest
import re
from datetime import datetime, timedelta, timezone
from django.apps import apps
from django.db import IntegrityError, transaction
from django.core.management import call_command

from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db


def test_administrative_records_are_visible_but_read_only_in_admin():
    from django.contrib import admin
    from django.contrib.auth import get_user_model
    from django.test import RequestFactory
    from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
    request = RequestFactory().get("/admin/")
    request.user = get_user_model()(username="inspection-only", is_active=True, is_staff=True, is_superuser=True)
    for model in (OpsDutyLogEntry, OpsDutyRecordSupplement):
        editor = admin.site._registry[model]
        assert not editor.has_add_permission(request)
        assert not editor.has_change_permission(request)
        assert not editor.has_delete_permission(request)
        assert editor.actions is None
        assert set(editor.get_readonly_fields(request)) == {field.name for field in model._meta.fields}
CATALOG = "/api/ops/dictionaries/"
KINDS = CATALOG + "SERVICE_DUTY_KINDS/entries/"


@pytest.mark.parametrize("code", [None, ""])
def test_own_duty_kind_needs_only_a_label_and_retains_its_generated_code(code):
    api, _ = client_for("auto-kind-writer", "AUTO_KIND_WRITER", perms=("dictionary.view", "dictionary_value.manage"))
    body = {"label": "Дежурный по внутреннему архиву", "description": "Административный учёт"}
    if code is not None:
        body["code"] = code
    response = api.post(KINDS, body, format="json")
    assert response.status_code == 201, response.data
    generated = response.data["code"]
    assert re.fullmatch(r"DUTY_[A-F0-9]{32}", generated)
    changed = api.patch(CATALOG + f'entries/{response.data["id"]}/', {"label": "Дежурный по архивным документам", "description": "Исправлено название"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["code"] == generated
    second = api.post(KINDS, {"label": "Ответственный за техническую документацию"}, format="json")
    assert second.status_code == 201, second.data
    assert second.data["code"] != generated


def test_repeated_label_only_creation_offers_the_existing_kind():
    api, _ = client_for("auto-kind-retry", "AUTO_KIND_RETRY", perms=("dictionary.view", "dictionary_value.manage"))
    body = {"label": "Дежурный по внутреннему архиву"}
    assert api.post(KINDS, body, format="json").status_code == 201
    retry = api.post(KINDS, body, format="json")
    assert retry.status_code == 409
    assert retry.data["error_code"] == "DICTIONARY_SIMILAR_ENTRIES"
    assert len([row for row in api.get(KINDS).data["results"] if row["label"] == body["label"]]) == 1


def test_other_dictionaries_still_require_an_explicit_code():
    api, _ = client_for("other-kind-writer", "OTHER_KIND_WRITER", perms=("dictionary.view", "dictionary_value.manage"))
    response = api.post(CATALOG + "RETURN_REASONS/entries/", {"label": "Контрольная новая причина номер 9876"}, format="json")
    assert response.status_code == 400
    assert "code" in response.data["details"]


def test_service_duty_catalog_is_listed_and_contains_requested_names():
    viewer, _ = client_for("duty-kind-viewer", "DUTY_KIND_VIEWER", perms=("dictionary.view",))
    response = viewer.get(CATALOG)
    assert response.status_code == 200
    definitions = {row["code"]: row for row in response.data["results"]}
    assert "SERVICE_DUTY_KINDS" in definitions
    assert definitions["SERVICE_DUTY_KINDS"]["readOnly"] is False
    response = viewer.get(KINDS)
    assert response.status_code == 200
    assert {"ГБР", "Смена Сакшы", "Смена Кумбез"} <= {row["label"] for row in response.data["results"]}


def test_custom_kind_uses_existing_dictionary_lifecycle_and_permissions():
    manager, _ = client_for("duty-kind-manager", "DUTY_KIND_MANAGER", perms=("dictionary.view", "dictionary_value.manage"))
    viewer, _ = client_for("duty-kind-reader", "DUTY_KIND_READER", perms=("dictionary.view",))
    payload = {"code": "CUSTOM_ARCHIVE", "label": "Дежурный по архиву", "description": "Внутренний учёт"}
    assert viewer.post(KINDS, payload, format="json").status_code == 403
    result = manager.post(KINDS, payload, format="json")
    assert result.status_code == 201, result.data
    row = result.data
    assert row["usage"]["status"] == "TRACKED"
    assert row["usage"]["totalCount"] == 0
    changed = manager.post(CATALOG + f'entries/{row["id"]}/set-active/', {"isActive": False, "reason": "Не применяется"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["isActive"] is False
    assert changed.data["inactiveSince"]


def test_used_kind_is_tracked_even_after_record_cancellation():
    model = apps.get_model("operations", "OpsDutyLogEntry")
    start = datetime(2026, 10, 13, 3, tzinfo=timezone.utc)
    model.objects.create(employee_id=123, employee_name="Архивный сотрудник", division_id=456,
        division_name="Архивное подразделение", service_duty_code="GBR", service_duty_label="ГБР",
        planned_start=start, planned_end=start + timedelta(hours=12), created_by="test",
        cancelled_at=start, cancelled_by="test", cancelled_reason="Отмена")
    api, _ = client_for("kind-usage", "KIND_USAGE", perms=("dictionary.view", "dictionary_value.manage"))
    data = api.get(KINDS).data
    entry = next(row for row in data["results"] if row["code"] == "GBR")
    assert entry["usage"]["totalCount"] == 1
    assert entry["usage"]["references"][0]["sourceLabel"] == "Журнал дежурств"
    result = api.delete(CATALOG + f'entries/{entry["id"]}/')
    assert result.status_code in (200, 409)
    assert any(row["code"] == "GBR" for row in api.get(KINDS).data["results"])
    assert model.objects.get(employee_id=123).service_duty_label == "ГБР"


def test_supplement_does_not_duplicate_a_source_record():
    model = apps.get_model("operations", "OpsDutyRecordSupplement")
    model.objects.create(source_type="DISPATCH", source_id=13, service_duty_code="GBR", service_duty_label="ГБР")
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(source_type="DISPATCH", source_id=13, service_duty_code="SAKSHY", service_duty_label="Смена Сакшы")


@pytest.mark.parametrize("extra", [
    {"acknowledged_at": datetime(2026, 10, 13, tzinfo=timezone.utc)},
    {"acknowledged_by": "test"},
    {"actual_start": datetime(2026, 10, 13, tzinfo=timezone.utc)},
    {"started_by": "test"}, {"completed_by": "test"},
])
def test_plan_supplement_cannot_own_source_execution(extra):
    model = apps.get_model("operations", "OpsDutyRecordSupplement")
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(source_type="PLAN", source_id=14, service_duty_code="GBR", service_duty_label="ГБР", **extra)


def test_plan_supplement_accepts_classification_without_execution():
    model = apps.get_model("operations", "OpsDutyRecordSupplement")
    row = model.objects.create(source_type="PLAN", source_id=15, service_duty_code="GBR", service_duty_label="ГБР")
    assert row.source_id == 15 and row.service_duty_label == "ГБР"
    assert row.acknowledged_at is row.actual_start is row.actual_end is None


def test_completed_log_requires_a_valid_actual_interval():
    model = apps.get_model("operations", "OpsDutyLogEntry")
    start = datetime(2026, 10, 13, 3, tzinfo=timezone.utc)
    values = dict(employee_id=124, employee_name="Сотрудник", division_id=456, division_name="Подразделение",
        service_duty_code="GBR", service_duty_label="ГБР", planned_start=start,
        planned_end=start + timedelta(hours=12), created_by="test")
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(**values, actual_end=start)
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(**values, actual_start=start, actual_end=start - timedelta(minutes=1))


def test_runtime_seed_restores_missing_defaults_and_preserves_customized_kinds():
    entry = apps.get_model("operations", "OpsDictionaryEntry")
    entry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="DUTY_DRIVER").delete()
    entry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="GBR").update(label="Название подразделения", is_active=False)
    call_command("seed_operations", verbosity=0)
    assert entry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="DUTY_DRIVER").exists()
    row = entry.objects.get(dictionary_code="SERVICE_DUTY_KINDS", code="GBR")
    assert row.label == "Название подразделения"
    assert row.is_active is False
