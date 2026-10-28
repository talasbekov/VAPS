"""Append-only skill evidence never grants access outside the personnel scope."""
from datetime import date
import pytest
from organization_management.apps.core.tests.test_employee_service_profile import people
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

def url(person):
    return f"/api/core/service-employees/{person.pk}/qualifications/"

def body(revision=0, **patch):
    return {"revision": revision, "request_key": "qualification-test-1", "skill": "shooting",
            "score": 4, "assessed_on": "2026-10-20", "valid_until": "2027-10-20",
            "basis": "TEST certificate", **patch}

@pytest.fixture(autouse=True)
def fixed_date(monkeypatch):
    from organization_management.apps.operations.clock import Clock
    monkeypatch.setattr(Clock, "today_local", staticmethod(lambda: date(2026, 10, 27)))

@pytest.fixture
def editor():
    return client_for("qualification-editor", "QUALIFICATION-EDITOR", ["personnel.view", "orgstructure.manage", "admin.roles"])

@pytest.mark.django_db
def test_legacy_score_never_becomes_verified_and_get_is_read_only(people, editor):
    from organization_management.apps.employees.models import EmployeeServiceProfile
    from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
    _, employees = people
    EmployeeServiceProfile.objects.create(employee=employees[0], data={"skills": {"shooting": 5}}, revision=1)
    api, _ = editor
    result = api.get(url(employees[0]))
    assert result.status_code == 200
    assert result.data["current"]["shooting"] == {"state": "unknown", "assessment": None}
    assert result.data["history"]["count"] == 0
    assert OpsEmployeeQualification.objects.count() == 0

@pytest.mark.django_db
def test_record_is_attributed_idempotent_and_revision_guarded(people, editor):
    from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
    _, employees = people
    api, user = editor
    result = api.post(url(employees[0]), body(), format="json")
    assert result.status_code == 201, result.data
    assert result.data["revision"] == 1
    assessment = result.data["current"]["shooting"]["assessment"]
    assert result.data["current"]["shooting"]["state"] == "valid"
    assert assessment["recorded_by"] == str(user.pk)
    assert assessment["basis"] == "TEST certificate"
    assert api.post(url(employees[0]), body(), format="json").status_code == 200
    assert OpsEmployeeQualification.objects.count() == 1
    assert api.post(url(employees[0]), body(score=2), format="json").status_code == 409
    assert api.post(url(employees[0]), body(request_key="another"), format="json").status_code == 409
    assert OpsEmployeeQualification.objects.count() == 1
    assert api.patch(url(employees[0]), {"score": 2}, format="json").status_code == 405
    assert api.delete(url(employees[0])).status_code == 405

@pytest.mark.django_db
@pytest.mark.parametrize("patch", [
    {"score": True}, {"score": "4"}, {"score": 0}, {"score": 6}, {"skill": "unknown"},
    {"assessed_on": "2026-10-28"}, {"assessed_on": "2026-02-30"}, {"assessed_on": "20261020"},
    {"valid_until": "2026-10-19"}, {"basis": " "}, {"basis": "x" * 1001}, {"basis": "x\x00"},
    {"recorded_by": "someone-else"}, {"revision": True}, {"request_key": ""},
])
def test_invalid_assessments_leave_no_record_or_profile(people, editor, patch):
    from organization_management.apps.employees.models import EmployeeServiceProfile
    from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
    _, employees = people
    api, _ = editor
    result = api.post(url(employees[0]), body(**patch), format="json")
    assert result.status_code == 400, result.data
    assert OpsEmployeeQualification.objects.count() == 0
    assert EmployeeServiceProfile.objects.count() == 0

@pytest.mark.django_db
def test_latest_exam_date_wins_and_expiry_is_explicit(people, editor):
    _, employees = people
    api, _ = editor
    first = api.post(url(employees[0]), body(valid_until="2026-10-26"), format="json")
    assert first.data["current"]["shooting"]["state"] == "expired"
    historical = api.post(url(employees[0]), body(1, request_key="older", assessed_on="2026-10-01", score=5), format="json")
    assert historical.status_code == 201
    assert historical.data["current"]["shooting"]["assessment"]["score"] == 4
    same_date_correction = api.post(url(employees[0]), body(2, request_key="newer", valid_until=None), format="json")
    assert same_date_correction.data["current"]["shooting"]["state"] == "unknown"
    assert same_date_correction.data["history"]["count"] == 3
    assert api.get(url(employees[0]) + "?page=2").data["history"]["results"] == []

@pytest.mark.django_db
def test_scope_read_only_and_self_access(people):
    divisions, employees = people
    api, _ = client_for("qualification-reader", "QUALIFICATION-READER", ["personnel.view"], divisions[0].pk)
    assert api.get(url(employees[0])).status_code == 200
    assert api.get(url(employees[0])).data["can_edit"] is False
    assert api.post(url(employees[0]), body(), format="json").status_code == 403
    assert api.get(url(employees[1])).status_code == 404
    api, user = client_for("qualification-self")
    employees[0].user = user
    employees[0].save(update_fields=["user"])
    assert api.get(url(employees[0])).status_code == 200
    assert api.post(url(employees[0]), body(), format="json").status_code == 403

@pytest.mark.django_db
def test_global_read_local_edit_cannot_write_foreign(people):
    from organization_management.apps.operations.models import Permission, Role, RolePermission
    from organization_management.apps.operations.services import RoleAdminService
    divisions, employees = people
    api, user = client_for("qualification-limited", "QUALIFICATION-LIMITED", ["orgstructure.manage", "admin.roles"], divisions[0].pk)
    role = Role.objects.create(code="QUALIFICATION-GLOBAL-READ", name="TEST")
    permission, _ = Permission.objects.get_or_create(code="personnel.view", defaults={"name": "TEST"})
    RolePermission.objects.create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(str(user.pk), role.code, None, actor="test")
    assert api.get(url(employees[1])).data["can_edit"] is False
    assert api.post(url(employees[1]), body(), format="json").status_code == 403

@pytest.mark.django_db
def test_profile_edit_and_assessment_share_revision(people, editor):
    _, employees = people
    api, _ = editor
    assert api.post(url(employees[0]), body(), format="json").status_code == 201
    profile_url = f"/api/core/service-employees/{employees[0].pk}/service-profile/"
    assert api.put(profile_url, {"revision": 0, "profile": {}}, format="json").status_code == 409
    assert api.put(profile_url, {"revision": 1, "profile": {"skills": {"shooting": 2}}}, format="json").status_code == 400
    assert api.put(profile_url, {"revision": 1, "profile": {"height_cm": 180}}, format="json").status_code == 200
    result = api.get(url(employees[0]))
    assert result.data["revision"] == 2
    assert result.data["current"]["shooting"]["assessment"]["score"] == 4
    assert api.get(profile_url).data["profile"]["skills"]["shooting"] == 4

@pytest.mark.django_db
def test_explicit_assessment_syncs_current_score_without_backfill_or_overwriting_other_skills(people, editor):
    from organization_management.apps.employees.models import EmployeeServiceProfile
    from organization_management.apps.employees.service_profile import profile_payload
    _, employees = people
    profile = EmployeeServiceProfile.objects.create(employee=employees[0], revision=1,
        data={"skills": {"shooting": 5, "hand_to_hand": 3}, "height_cm": 180})
    api, _ = editor
    profile_url = f"/api/core/service-employees/{employees[0].pk}/service-profile/"
    assert api.get(profile_url).data["profile"]["skills"]["shooting"] == 5
    assert api.post(url(employees[0]), body(1), format="json").status_code == 201
    current = api.get(profile_url).data
    assert current["profile"]["skills"] == {"shooting": 4, "hand_to_hand": 3, "physical_fitness": None}
    assert current["verified_skills"] == ["shooting"]
    assert current["profile"]["height_cm"] == 180
    profile.refresh_from_db()
    assert profile_payload(profile)["skills"]["shooting"] == 4
    # Entering an older examination preserves the newest examination as current.
    assert api.post(url(employees[0]), body(2, request_key="older-check", assessed_on="2026-10-01", score=2), format="json").status_code == 201
    assert api.get(profile_url).data["profile"]["skills"]["shooting"] == 4
    # A correction for the same examination date becomes current atomically.
    assert api.post(url(employees[0]), body(3, request_key="correction", score=3), format="json").status_code == 201
    assert api.get(profile_url).data["profile"]["skills"]["shooting"] == 3

@pytest.mark.django_db
def test_expiry_is_inclusive_and_does_not_become_fresh_from_profile_edit(people, editor, monkeypatch):
    from organization_management.apps.operations.clock import Clock
    _, employees = people
    api, _ = editor
    response = api.post(url(employees[0]), body(valid_until="2026-10-27"), format="json")
    assert response.data["current"]["shooting"]["state"] == "valid"
    monkeypatch.setattr(Clock, "today_local", staticmethod(lambda: date(2026, 10, 28)))
    assert api.get(url(employees[0])).data["current"]["shooting"]["state"] == "expired"

@pytest.mark.django_db
def test_saved_evidence_is_immutable_and_audit_has_no_document_contents(people, editor):
    from django.core.exceptions import ValidationError
    from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
    from organization_management.apps.operations.models_audit import OpsAuditLog
    _, employees = people
    api, user = editor
    assert api.post(url(employees[0]), body(), format="json").status_code == 201
    record = OpsEmployeeQualification.objects.get()
    record.score = 1
    with pytest.raises(ValidationError):
        record.save()
    with pytest.raises(ValidationError):
        record.delete()
    record.refresh_from_db()
    assert record.score == 4
    audit = OpsAuditLog.objects.get(action="EMPLOYEE_QUALIFICATION_RECORDED")
    assert audit.actor_user_id == str(user.pk)
    assert audit.entity_id == employees[0].pk
    assert "TEST certificate" not in str(audit.new_value)


