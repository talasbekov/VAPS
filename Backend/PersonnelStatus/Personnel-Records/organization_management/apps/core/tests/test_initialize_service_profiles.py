"""Initial values are an explicit audited operation, never a read-time default."""
import importlib.util
import json
from pathlib import Path

import pytest
from django.utils import timezone

from organization_management.apps.audit.domain.models import AuditLog
from organization_management.apps.employees.models import Employee, EmployeeServiceProfile
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
PERMISSIONS = ("personnel.view", "orgstructure.manage", "admin.roles")


@pytest.fixture
def tool():
    path = Path(__file__).resolve().parents[4] / "tools" / "initialize_service_profiles.py"
    assert path.is_file(), "The portable initialization command must exist"
    spec = importlib.util.spec_from_file_location("initialize_service_profiles", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def actor():
    _, user = client_for("INITIALIZER-TEST", "INITIALIZER-TEST", PERMISSIONS)
    return user


def employee(number, **kwargs):
    return Employee.objects.create(
        personnel_number=f"INITIAL-{number}", first_name="TEST", last_name="TEST", **kwargs
    )


def run(tool, actor, **kwargs):
    return tool.initialize(actor_id=actor.pk, **kwargs)


def test_dry_run_counts_without_writing(tool, actor):
    employee(1)
    audit_count = AuditLog.objects.count()
    result = run(tool, actor)
    assert result["mode"] == "dry-run"
    assert result["employees"] == result["profiles_created"] == 1
    assert result["fields_filled"] == 5
    assert not EmployeeServiceProfile.objects.exists()
    assert AuditLog.objects.count() == audit_count


def test_all_employee_categories_and_only_empty_fields(tool, actor):
    active = employee(1)
    employee(2, is_active=False)
    employee(3, employment_status=Employee.EmploymentStatus.FIRED)
    employee(4, archived_at=timezone.now(), is_active=False)
    untouched = {
        "inventory": [{"category": "magazine", "name": "TEST", "quantity": 0}],
        "health": {"condition": "TEST-A", "chronic_conditions": None, "restrictions": ""},
        "skills": {"shooting": 2, "hand_to_hand": None},
        "height_cm": 170.5, "weight_kg": None,
    }
    profile = EmployeeServiceProfile.objects.create(employee=active, data=untouched, revision=7)
    result = run(tool, actor, apply=True)
    assert result["employees"] == 4
    assert result["profiles_created"] == 3
    assert result["profiles_updated"] == 1
    assert result["fields_filled"] == 18
    profile.refresh_from_db()
    assert profile.revision == 8
    assert profile.data == {
        **untouched, "skills": {"shooting": 2, "hand_to_hand": 5, "physical_fitness": 5},
        "weight_kg": 75,
    }
    new = EmployeeServiceProfile.objects.exclude(pk=profile.pk).first()
    assert new.data["height_cm"] == 180
    assert new.data["weight_kg"] == 75
    assert new.data["skills"] == dict.fromkeys(("shooting", "hand_to_hand", "physical_fitness"), 5)
    assert new.data.get("health") is None
    assert new.data.get("inventory") is None
    logs = AuditLog.objects.filter(payload__operation=tool.OPERATION)
    assert logs.count() == 5  # four revisions + the durable batch receipt
    serialized = json.dumps(list(logs.values_list("payload", flat=True)))
    assert "TEST-A" not in serialized and "magazine" not in serialized
    assert "массовое начальное заполнение" in json.loads(json.dumps(result))["origin"]


def test_completed_batch_does_not_refill_later_manual_null_or_new_employee(tool, actor):
    person = employee(1)
    first = run(tool, actor, apply=True)
    profile = EmployeeServiceProfile.objects.get(employee=person)
    profile.data["height_cm"] = None
    profile.data["skills"]["shooting"] = 1
    profile.revision += 1
    profile.save()
    employee(2)
    before_audits = AuditLog.objects.count()
    again = run(tool, actor, apply=True)
    assert again["already_applied"] is True
    assert again["batch_id"] == first["batch_id"]
    assert again["fields_filled"] == 0
    profile.refresh_from_db()
    assert profile.data["height_cm"] is None and profile.data["skills"]["shooting"] == 1
    assert EmployeeServiceProfile.objects.count() == 1
    assert AuditLog.objects.count() == before_audits


def test_full_profile_is_unchanged_but_zero_change_batch_is_remembered(tool, actor):
    person = employee(1)
    data = {"skills": dict.fromkeys(("shooting", "hand_to_hand", "physical_fitness"), 3),
            "height_cm": 172, "weight_kg": 68, "inventory": []}
    profile = EmployeeServiceProfile.objects.create(employee=person, data=data, revision=4)
    assert run(tool, actor, apply=True)["fields_filled"] == 0
    profile.refresh_from_db()
    assert profile.data == data and profile.revision == 4
    profile.data["weight_kg"] = None
    profile.save()
    assert run(tool, actor, apply=True)["already_applied"] is True
    profile.refresh_from_db()
    assert profile.data["weight_kg"] is None


@pytest.mark.parametrize("missing", PERMISSIONS)
def test_each_global_personnel_permission_required(tool, missing):
    _, actor = client_for("DENIED-TEST", "DENIED-TEST", tuple(p for p in PERMISSIONS if p != missing))
    employee(1)
    with pytest.raises(PermissionError):
        run(tool, actor, apply=True)
    assert not EmployeeServiceProfile.objects.exists()


def test_scoped_admin_and_inactive_actor_cannot_run_global_batch(tool):
    from organization_management.apps.divisions.models import Division
    division = Division.objects.create(name="TEST-SCOPE")
    _, actor = client_for("SCOPED-TEST", "SCOPED-TEST", PERMISSIONS, division.pk)
    with pytest.raises(PermissionError):
        run(tool, actor)
    _, actor = client_for("INACTIVE-TEST", "GLOBAL-TEST", PERMISSIONS)
    actor.is_active = False
    actor.save()
    with pytest.raises(PermissionError):
        run(tool, actor, apply=True)


def test_invalid_stored_profile_aborts_entire_batch_without_payload_in_error(tool, actor):
    employee(1)
    bad = employee(2)
    EmployeeServiceProfile.objects.create(employee=bad, data={"health": {"condition": ["PRIVATE-TEST"]}})
    count = AuditLog.objects.count()
    with pytest.raises(ValueError) as error:
        run(tool, actor, apply=True)
    assert "PRIVATE-TEST" not in str(error.value)
    assert EmployeeServiceProfile.objects.count() == 1
    assert AuditLog.objects.count() == count


def test_audit_failure_rolls_back_profiles_and_batch_receipt(tool, actor, monkeypatch):
    employee(1)
    count = AuditLog.objects.count()
    original = AuditLog.objects.create

    def fail_receipt(**kwargs):
        if kwargs.get("payload", {}).get("record_type") == "batch_receipt":
            raise RuntimeError("TEST-AUDIT-FAILURE")
        return original(**kwargs)

    monkeypatch.setattr(AuditLog.objects, "create", fail_receipt)
    with pytest.raises(RuntimeError, match="TEST-AUDIT-FAILURE"):
        run(tool, actor, apply=True)
    assert not EmployeeServiceProfile.objects.exists()
    assert AuditLog.objects.count() == count


def test_cli_defaults_dry_run_and_writes_only_aggregate_receipt(tool, actor, tmp_path, capsys):
    employee(1)
    path = tmp_path / "receipt.json"
    assert tool.main(["--actor-id", str(actor.pk), "--receipt", str(path)]) == 0
    result = json.loads(path.read_text(encoding="utf-8"))
    assert result["mode"] == "dry-run"
    assert result["fields_filled"] == 5
    assert "TEST" not in capsys.readouterr().out
    assert not EmployeeServiceProfile.objects.exists()


def test_explicit_app_root_rejects_missing_application_before_apply(tool, actor, tmp_path):
    employee(1)
    assert tool.main(["--actor-id", str(actor.pk), "--apply", "--app-root", str(tmp_path)]) == 1
    assert not EmployeeServiceProfile.objects.exists()


def test_existing_receipt_is_not_overwritten_and_prevents_apply(tool, actor, tmp_path):
    employee(1)
    path = tmp_path / "receipt.json"
    path.write_text("PREVIOUS", encoding="utf-8")
    assert tool.main(["--actor-id", str(actor.pk), "--apply", "--receipt", str(path)]) == 1
    assert path.read_text(encoding="utf-8") == "PREVIOUS"
    assert not EmployeeServiceProfile.objects.exists()
