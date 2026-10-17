"""Named duty choices persist through the personnel API into the service roster."""
from datetime import timedelta

import pytest
from django.core.management import call_command

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.snapshot import build_division_snapshot
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

VARIANTS = {
    "DUTY_COMBAT": "Боевое дежурство",
    "DUTY_DAILY": "Суточное дежурство",
    "DUTY_OPERATIONAL": "Оперативное дежурство",
}


def test_seed_adds_duty_choices_once_without_overwriting_operator_settings():
    StatusType.objects.filter(code__in=VARIANTS).delete()
    StatusType.objects.create(
        code="DUTY_COMBAT", name="Дежурный управления", priority=74,
        report_column_code="ON_DUTY", color="#123456", is_active=False,
        max_duration_days=4,
    )
    custom_before = StatusType.objects.filter(code="DUTY_COMBAT").values().get()
    call_command("seed_status_types", verbosity=0)
    call_command("seed_status_types", verbosity=0)
    assert set(StatusType.objects.filter(code__in=VARIANTS).values_list("code", flat=True)) == set(VARIANTS)
    assert StatusType.objects.filter(code="DUTY_COMBAT").values().get() == custom_before


@pytest.mark.parametrize("code,label", VARIANTS.items())
def test_duty_choice_saves_location_and_appears_in_service_roster_and_snapshot(code, label):
    call_command("seed_status_types", verbosity=0)
    api, _ = client_for("duty-variants", "DUTY_VARIANTS", ("status.view", "status.manage", "duty.view"))
    types = api.get("/api/statuses/types/", {"selectable": "1"})
    assert types.status_code == 200
    selected = next((row for row in types.json() if row["code"] == code), None)
    assert selected is not None, "The named duty must be available for selection"
    assert selected["label"] == label
    assert selected.get("report_column_code") == "ON_DUTY"
    department = Division.objects.create(name="Департамент дежурств", division_type="department")
    employee = make_employee(department)
    day = Clock.today_local()
    response = api.post("/api/statuses/statuses/", {
        "employee": employee.pk, "status_type": code,
        "start_date": day.isoformat(), "end_date": day.isoformat(),
        "location": "Административное здание, пост 2",
    }, format="json")
    assert response.status_code == 201, response.content
    saved = EmployeeStatus.objects.get(employee=employee)
    assert saved.status_type == code
    assert saved.location == "Административное здание, пост 2"
    projected = OpsEmployeeStatus.objects.get(employee_id=employee.pk, cancelled_at__isnull=True)
    assert projected.status_type_code == code
    assert projected.date_end == day + timedelta(days=1)
    roster = api.get("/api/ops/service-combat-duty/", {"business_date": day.isoformat()})
    assert roster.status_code == 200, roster.content
    person = roster.json()["departments"][0]["employees"][0]
    assert person["status_label"] == label
    assert person["destination"] == saved.location
    snapshot = build_division_snapshot(department.pk, day)
    assert [(row["employee_id"], row["status_type_code"]) for row in snapshot["rows"]] == [(employee.pk, code)]


def test_custom_duty_catalog_exposes_category_without_relying_on_name():
    StatusType.objects.create(
        code="CUSTOM_DUTY", name="Наряд специального подразделения",
        priority=72, report_column_code="ON_DUTY",
    )
    api, _ = client_for("custom-duty-catalog")
    row = next(item for item in api.get("/api/statuses/types/").json() if item["code"] == "CUSTOM_DUTY")
    assert row.get("report_column_code") == "ON_DUTY"


def test_migration_is_additive_and_preserves_existing_variant_settings():
    from importlib import import_module
    from types import SimpleNamespace
    from django.apps import apps
    from django.db import connection

    migrate = import_module(
        "organization_management.apps.operations.migrations.0134_duty_status_variants"
    ).add_duty_variants
    StatusType.objects.filter(code__in=VARIANTS).delete()
    StatusType.objects.create(
        code="DUTY_OPERATIONAL", name="Операторский вид", priority=80,
        report_column_code="ON_DUTY", is_active=False, color="#abcdef",
    )
    before = list(StatusType.objects.order_by("code").values())
    editor = SimpleNamespace(connection=connection)
    migrate(apps, editor)
    migrate(apps, editor)
    assert set(StatusType.objects.filter(code__in=VARIANTS).values_list("code", flat=True)) == set(VARIANTS)
    for previous in before:
        assert StatusType.objects.filter(code=previous["code"]).values().get() == previous


@pytest.mark.parametrize("active", [True, False])
def test_custom_canonical_duty_projects_only_when_active(active):
    StatusType.objects.create(
        code="CUSTOM_DUTY", name="Особое дежурство", priority=72,
        report_column_code="ON_DUTY", is_active=active,
    )
    employee = make_employee()
    day = Clock.today_local()
    EmployeeStatus.objects.create(
        employee=employee, status_type="CUSTOM_DUTY", start_date=day, end_date=day,
    )
    assert list(OpsEmployeeStatus.objects.filter(
        employee_id=employee.pk, cancelled_at__isnull=True,
    ).values_list("status_type_code", flat=True)) == (["CUSTOM_DUTY"] if active else [])


def test_legacy_mapping_keeps_precedence_over_a_similarly_named_canonical_type():
    call_command("seed_status_types", verbosity=0)
    StatusType.objects.create(
        code="on_duty", name="Другой пользовательский тип", priority=72,
        report_column_code="OTHER",
    )
    employee = make_employee()
    day = Clock.today_local()
    EmployeeStatus.objects.create(
        employee=employee, status_type="on_duty", start_date=day, end_date=day,
    )
    assert OpsEmployeeStatus.objects.get(employee_id=employee.pk).status_type_code == "DUTY"
