"""Retired secondment types cannot be introduced through another write API."""
from datetime import timedelta

import pytest
from django.contrib import admin
from django.forms.models import model_to_dict
from django.test import RequestFactory
from django.utils import timezone

from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus, OpsStatusParticipation, Secondment
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
RETIRED = ("ATTACHED", "DETACHED", "seconded_from", "seconded_to")


@pytest.fixture
def scene():
    api, user = client_for("retired-status-manager", "RETIRED_STATUS_MANAGER", ["*"])
    user.is_superuser = True
    user.save(update_fields=["is_superuser"])
    division = Division.objects.create(name="Retirement department")
    employee = make_employee(division)
    unit = StaffUnit.objects.get(employee=employee)
    for code in (*RETIRED, "VACATION", "UNCLARIFIED"):
        StatusType.objects.get_or_create(code=code, defaults={
            "name": f"Historical {code}", "priority": 30,
            "report_column_code": "ABSENT", "is_placeholder": code == "UNCLARIFIED",
        })
    start = timezone.localdate() + timedelta(days=10)
    planned = EmployeeStatus.objects.create(
        employee=employee, status_type="VACATION", start_date=start + timedelta(days=5),
        end_date=start + timedelta(days=7), state=EmployeeStatus.StatusState.PLANNED,
        created_by=user,
    )
    return api, user, employee, unit, planned, start


@pytest.mark.parametrize("code", RETIRED)
@pytest.mark.parametrize("route", ["personnel-create", "personnel-patch", "personnel-bulk",
                                   "operations-create", "operations-bulk", "operations-resolve",
                                   "staff-bulk", "directorate-bulk"])
def test_retired_type_is_refused_without_any_business_write(scene, code, route):
    api, _, employee, unit, planned, start = scene
    end = start + timedelta(days=2)
    personnel = {"status_type": code, "start_date": str(start), "end_date": str(end)}
    operational = {"employee_id": employee.pk, "status_type_code": code,
                   "date_start": str(start), "date_end": str(end)}
    before_personnel = list(EmployeeStatus.objects.order_by("pk").values())
    before_operational = list(OpsEmployeeStatus.objects.order_by("pk").values())
    if route == "personnel-create":
        response = api.post("/api/statuses/statuses/", {"employee": employee.pk, **personnel}, format="json")
    elif route == "personnel-patch":
        response = api.patch(f"/api/statuses/statuses/{planned.pk}/", {"status_type": code}, format="json")
    elif route == "personnel-bulk":
        response = api.post("/api/statuses/statuses/bulk_plan/", {"employee_ids": [employee.pk], **personnel}, format="json")
    elif route == "operations-create":
        response = api.post("/api/operations/statuses/", operational, format="json")
    elif route == "operations-bulk":
        # A preceding valid row must not be committed when any row is retired.
        other = make_employee(unit.division)
        valid = {**operational, "employee_id": other.pk, "status_type_code": "VACATION"}
        response = api.post("/api/operations/statuses/bulk/", {"business_date": str(start), "rows": [valid, operational]}, format="json")
    elif route == "operations-resolve":
        placeholder = OpsEmployeeStatus.objects.create(
            employee_id=employee.pk, status_type_code="UNCLARIFIED", date_start=start,
            date_end=end, created_by="test", source="USER",
        )
        before_operational = list(OpsEmployeeStatus.objects.order_by("pk").values())
        response = api.post(f"/api/operations/statuses/{placeholder.pk}/resolve/", {
            "resolved_type_code": code, "date_start": str(start), "date_end": str(end), "reason": "Resolve",
        }, format="json")
    elif route == "staff-bulk":
        response = api.patch(f"/api/staff_unit/staff-units/{unit.pk}/", {
            "index": 91, "employee_statuses": [{"employee_id": employee.pk, **personnel}],
        }, format="json")
    else:
        response = api.patch("/api/staff_unit/staff-units/directorate/", {
            "employees": [{"id": employee.pk, "first_name": "Must roll back"}],
            "employee_statuses": [{"employee": employee.pk, **personnel}],
        }, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"
    assert list(EmployeeStatus.objects.order_by("pk").values()) == before_personnel
    assert list(OpsEmployeeStatus.objects.order_by("pk").values()) == before_operational
    employee.refresh_from_db()
    unit.refresh_from_db()
    assert employee.first_name == "Иван"
    assert unit.index != 91


def test_selectable_catalog_hides_canonical_codes_without_losing_historical_labels(scene):
    api, _, _, _, _, _ = scene
    selectable = api.get("/api/statuses/types/", {"selectable": "1"})
    all_types = api.get("/api/statuses/types/")
    assert selectable.status_code == all_types.status_code == 200
    assert not set(RETIRED) & {row["code"] for row in selectable.data}
    assert {row["code"]: row["label"] for row in all_types.data}.items() >= {
        code: f"Historical {code}" for code in RETIRED
    }.items()


@pytest.mark.parametrize("legacy_code", ["seconded_from", "SECONDED_FROM", "attached", " seconded_to "])
def test_a_dictionary_alias_cannot_reopen_a_retired_workflow(scene, legacy_code):
    api, _, employee, _, _, start = scene
    StatusType.objects.filter(code="seconded_from").delete()
    StatusType.objects.create(code="OLD_ATTACHED", legacy_code=legacy_code,
                              name="Historical attachment", priority=30, report_column_code="ABSENT")
    before = list(OpsEmployeeStatus.objects.order_by("pk").values())
    response = api.post("/api/operations/statuses/", {
        "employee_id": employee.pk, "status_type_code": "OLD_ATTACHED",
        "date_start": str(start), "date_end": str(start + timedelta(days=2)),
    }, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"
    assert list(OpsEmployeeStatus.objects.order_by("pk").values()) == before


def test_permission_denial_precedes_retired_type_validation(scene):
    _, _, employee, _, _, start = scene
    reader, _ = client_for("retired-status-reader", "RETIRED_STATUS_READER", ["status.view"])
    response = reader.post("/api/statuses/statuses/", {
        "employee": employee.pk, "status_type": "ATTACHED", "start_date": str(start),
    }, format="json")
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("code", RETIRED)
def test_operations_patch_cannot_switch_to_a_retired_type(scene, code):
    api, _, employee, _, _, start = scene
    row = OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code="VACATION",
                                           date_start=start, date_end=start + timedelta(days=2), created_by="test")
    response = api.patch(f"/api/operations/statuses/{row.pk}/", {"status_type_code": code}, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"
    row.refresh_from_db()
    assert row.status_type_code == "VACATION"


@pytest.mark.parametrize("model,field", [(EmployeeStatus, "status_type"), (OpsEmployeeStatus, "status_type_code")])
@pytest.mark.parametrize("code", RETIRED)
def test_admin_status_form_cannot_create_or_switch_to_a_retired_type(scene, model, field, code):
    _, user, employee, _, planned, start = scene
    row = planned if model is EmployeeStatus else OpsEmployeeStatus.objects.create(
        employee_id=employee.pk, status_type_code="VACATION", date_start=start,
        date_end=start + timedelta(days=2), created_by="test",
    )
    request = RequestFactory().get("/admin/")
    request.user = user
    model_admin = admin.site._registry[model]
    for current in (None, row):
        form_class = model_admin.get_form(request, obj=current)
        data = {**model_to_dict(row), field: code}
        form = form_class(data=data, instance=current)
        assert not form.is_valid()
        assert any(error.code == "feature_retired" for error in form.errors.as_data().get(field, [])), form.errors


def test_admin_cannot_add_change_or_delete_historical_secondment_pairs(scene):
    _, user, _, _, _, _ = scene
    request = RequestFactory().post("/admin/")
    request.user = user
    model_admin = admin.site._registry[Secondment]
    assert model_admin.has_view_permission(request)
    assert not model_admin.has_add_permission(request)
    assert not model_admin.has_change_permission(request)
    assert not model_admin.has_delete_permission(request)


@pytest.mark.parametrize("code", RETIRED)
@pytest.mark.parametrize("state", ["planned", "active", "completed", "cancelled"])
def test_historical_personnel_status_can_still_be_read_and_annotated(scene, code, state):
    api, _, _, _, planned, _ = scene
    planned.status_type = code
    planned.state = state
    if state != "planned":
        planned.start_date = timezone.localdate() - timedelta(days=10)
        planned.end_date = timezone.localdate() + timedelta(days=2 if state == "active" else -2)
    planned.save()
    response = api.get(f"/api/statuses/statuses/{planned.pk}/")
    assert response.status_code == 200
    assert response.data["status_type_display"] == f"Historical {code}"
    updated = api.patch(f"/api/statuses/statuses/{planned.pk}/", {
        "status_type": code, "comment": "Historical note",
    }, format="json")
    assert updated.status_code == 200, updated.data
    planned.refresh_from_db()
    assert planned.status_type == code
    assert planned.comment == "Historical note"


@pytest.mark.parametrize("route", ["personnel", "operations", "directorate"])
@pytest.mark.parametrize("change", ["start", "extend", "open-end", "employee", "destination"])
def test_existing_retired_status_cannot_be_reused_for_a_new_period_or_employee(scene, route, change):
    api, _, employee, unit, planned, start = scene
    planned.status_type = "seconded_to"
    planned.save()
    operational = OpsEmployeeStatus.objects.create(
        employee_id=employee.pk, status_type_code="ATTACHED", date_start=start,
        date_end=start + timedelta(days=2), created_by="test",
    )
    new_employee = make_employee(unit.division)
    destination = Division.objects.create(name="New receiving department")
    if route == "operations":
        changes = {
            "start": {"date_start": str(start + timedelta(days=1))},
            "extend": {"date_end": str(start + timedelta(days=3))},
            "open-end": {"date_end": None},
            "employee": {"employee_id": new_employee.pk},
            "destination": {"participations": [{"event_id": 999}]},
        }[change]
        response = api.patch(f"/api/operations/statuses/{operational.pk}/", changes, format="json")
    else:
        changes = {
            "start": {"start_date": str(planned.start_date + timedelta(days=1))},
            "extend": {"end_date": str(planned.end_date + timedelta(days=1))},
            "open-end": {"end_date": None},
            "employee": {"employee": new_employee.pk},
            "destination": {"related_division": destination.pk},
        }[change]
        if route == "directorate":
            # The existing-code field is deliberately absent.
            response = api.patch("/api/staff_unit/staff-units/directorate/", {
                "employee_statuses": [{"id": planned.pk, "employee": employee.pk, **changes}],
            }, format="json")
        else:
            response = api.patch(f"/api/statuses/statuses/{planned.pk}/", changes, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"
    planned.refresh_from_db()
    operational.refresh_from_db()
    assert planned.employee_id == operational.employee_id == employee.pk
    assert planned.start_date == start + timedelta(days=5)
    assert planned.end_date == start + timedelta(days=7)
    assert planned.related_division_id is None
    assert operational.date_start == start
    assert operational.date_end == start + timedelta(days=2)


@pytest.mark.parametrize("route", ["personnel", "operations"])
def test_dedicated_extend_cannot_resume_an_existing_retired_period(scene, route):
    api, _, employee, _, planned, start = scene
    if route == "personnel":
        planned.status_type = "seconded_from"
        planned.save()
        response = api.post(f"/api/statuses/statuses/{planned.pk}/extend/", {
            "new_end_date": str(planned.end_date + timedelta(days=2)),
        }, format="json")
    else:
        # A completed operational period must not be reopened into the future.
        old = timezone.localdate() - timedelta(days=10)
        row = OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code="ATTACHED",
                                               date_start=old, date_end=old + timedelta(days=2), created_by="test")
        response = api.post(f"/api/operations/statuses/{row.pk}/extend/", {
            "new_date_end": str(start + timedelta(days=2)),
        }, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"


@pytest.mark.parametrize("model,field,end_field", [
    (EmployeeStatus, "status_type", "end_date"), (OpsEmployeeStatus, "status_type_code", "date_end"),
])
def test_admin_cannot_extend_an_existing_retired_period(scene, model, field, end_field):
    _, user, employee, _, planned, start = scene
    row = planned if model is EmployeeStatus else OpsEmployeeStatus.objects.create(
        employee_id=employee.pk, status_type_code="ATTACHED", date_start=start,
        date_end=start + timedelta(days=2), created_by="test",
    )
    setattr(row, field, "seconded_to" if model is EmployeeStatus else "ATTACHED")
    row.save()
    request = RequestFactory().get("/admin/")
    request.user = user
    form_class = admin.site._registry[model].get_form(request, obj=row)
    data = {**model_to_dict(row), end_field: getattr(row, end_field) + timedelta(days=3)}
    form = form_class(data=data, instance=row)
    assert not form.is_valid()
    assert any(error.code == "feature_retired" for error in form.errors.as_data().get(end_field, [])), form.errors


def test_retired_personnel_period_can_be_cancelled_and_its_history_retained(scene):
    api, _, _, _, planned, _ = scene
    planned.status_type = "seconded_to"
    planned.save()
    response = api.post(f"/api/statuses/statuses/{planned.pk}/cancel/", {"reason": "Retired workflow"}, format="json")
    assert response.status_code == 200, response.data
    planned.refresh_from_db()
    assert planned.state == EmployeeStatus.StatusState.CANCELLED
    assert planned.change_history.exists()


def test_admin_cannot_add_participation_to_a_retired_status(scene):
    _, user, employee, _, _, start = scene
    row = OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code="ATTACHED",
                                           date_start=start, date_end=start + timedelta(days=2), created_by="test")
    request = RequestFactory().get("/admin/")
    request.user = user
    for inline in admin.site._registry[OpsEmployeeStatus].get_inline_instances(request, obj=row):
        if inline.model is OpsStatusParticipation:
            assert not inline.has_add_permission(request, obj=row)
            assert not inline.has_change_permission(request, obj=row)
            assert not inline.has_delete_permission(request, obj=row)
    form_class = admin.site._registry[OpsStatusParticipation].get_form(request)
    form = form_class(data={"status": row.pk, "event_id": 999, "kind_code": "OTHER", "role_code": "OTHER"})
    assert not form.is_valid()
    assert any(error.code == "feature_retired" for error in form.errors.as_data().get("status", [])), form.errors


@pytest.mark.parametrize("route", ["personnel", "operations"])
def test_existing_retired_period_can_still_be_shortened(scene, route):
    api, _, employee, _, planned, start = scene
    if route == "personnel":
        planned.status_type = "seconded_to"
        planned.save()
        shortened = planned.end_date - timedelta(days=1)
        response = api.patch(f"/api/statuses/statuses/{planned.pk}/", {"end_date": str(shortened)}, format="json")
        planned.refresh_from_db()
        assert planned.end_date == shortened
    else:
        row = OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code="ATTACHED",
                                               date_start=start, date_end=start + timedelta(days=2), created_by="test")
        shortened = start + timedelta(days=1)
        response = api.patch(f"/api/operations/statuses/{row.pk}/", {"date_end": str(shortened)}, format="json")
        row.refresh_from_db()
        assert row.date_end == shortened
    assert response.status_code == 200, response.data
