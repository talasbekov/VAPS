"""Candidate assessment must never allocate personnel or widen request scope."""
import pytest
from django.db import connection
from django.contrib.auth import get_user_model
from django.test.utils import CaptureQueriesContext

from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.ops.force_campaigns import create_campaign
from .test_ops_forces_scope import employee_of, _split_first, _status_head
from .test_ops_forces_scope import _soft_conflicting_status
from .test_ops_security_events_api import client_for
from .test_ops_forces_gathering import allocated_event, make_department, make_directorate, make_assignment_status_type
from .test_ops_security_events_api import manager  # noqa: F401

pytestmark = pytest.mark.django_db


def setup_request(manager):
    department = make_department()
    division = make_directorate(department, "Свои")
    base, allocation = allocated_event(manager, department)
    _split_first(manager, base, allocation, division)
    head = _status_head("candidate-head", "CANDIDATE_HEAD", division)
    person = employee_of(division, "Кандидатов")
    make_assignment_status_type()
    OpsDictionaryEntry.objects.update_or_create(dictionary_code="EVENT_PARTICIPATION_KINDS", code="CANDIDATE_GROUP", defaults={"label": "Группа", "is_active": True})
    url = f"/api/ops/security-events/forces/requests/{allocation}/directorate/"
    return head, person, url, base, allocation


def vacation(person):
    StatusType.objects.get_or_create(code="VACATION", defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"})
    OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code="VACATION", date_start="2026-08-10", date_end="2026-08-12")


def test_assessment_is_read_only_and_matches_final_hard_conflict(manager):
    head, person, url, _, _ = setup_request(manager)
    vacation(person)
    with CaptureQueriesContext(connection) as captured:
        response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.status_code == 200, response.data
    assert not any(query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for query in captured)
    row = next(row for row in response.data["results"] if row["employeeId"] == str(person.pk))
    assert row["assessment"] == "BLOCKED"
    final = head.post(url + "select/", {"kindCode": "CANDIDATE_GROUP", "employeeIds": [str(person.pk)]}, format="json")
    assert row["code"] == final.data["refused"][0]["code"] == "OVERLAPPING_HARD_STATUS"
    assert row["overridable"] is False


def test_scope_and_foreign_request_are_not_disclosed(manager):
    head, person, url, _, _ = setup_request(manager)
    foreign = make_directorate(make_department("Чужие"), "Чужое управление")
    outsider = employee_of(foreign, "Секретов")
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.status_code == 200
    assert {row["employeeId"] for row in response.data["results"]} == {str(person.pk)}
    other = _status_head("candidate-other", "CANDIDATE_OTHER", foreign)
    assert other.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"}).status_code == 404
    assert outsider.last_name not in str(response.data)


def test_stale_successful_assessment_does_not_override_final_check(manager):
    head, person, url, _, _ = setup_request(manager)
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.status_code == 200
    assert response.data["results"][0]["assessment"] == "AVAILABLE"
    vacation(person)
    final = head.post(url + "select/", {"kindCode": "CANDIDATE_GROUP", "employeeIds": [str(person.pk)]}, format="json")
    assert final.data["selected"] == []
    assert final.data["refused"][0]["code"] == "OVERLAPPING_HARD_STATUS"


def test_reserve_eligibility_does_not_promise_event_availability(manager):
    head, person, url, base, _ = setup_request(manager)
    vacation(person)
    event_id = base.strip("/").split("/")[-1]
    create_campaign(title="Резерв", event_ids=[event_id], actor=get_user_model().objects.get(username="ev-manager").pk)
    with CaptureQueriesContext(connection) as assessment_queries:
        response = head.get(url + "candidates/", {"kindCode": "PHYSICAL_SQUAD"})
    assert response.status_code == 200, response.data
    assert not any("FOR UPDATE" in query["sql"].upper() for query in assessment_queries)
    assert not any(query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for query in assessment_queries)
    row = response.data["results"][0]
    assert row["assessment"] == "RESERVE_ELIGIBLE"
    assert "резерв" in row["message"].lower()
    assert response.data["assessmentScope"] == "page"
    with CaptureQueriesContext(connection) as write_queries:
        final = head.post(url + "select/", {"kindCode": "PHYSICAL_SQUAD", "employeeIds": [str(person.pk)]}, format="json")
    assert final.status_code == 200, final.data
    assert final.data["selected"] == [str(person.pk)]
    assert any('"ops_force_campaigns"' in query["sql"] and "FOR UPDATE" in query["sql"].upper() for query in write_queries)


def test_soft_conflict_is_separate_and_kind_counts_do_not_mix(manager):
    head, person, url, base, allocation = setup_request(manager)
    _soft_conflicting_status(person)
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.status_code == 200
    assert response.data["results"][0]["assessment"] == "REQUIRES_REASON"
    assert response.data["results"][0]["overridable"] is True
    assert response.data["request"]["assignedByKind"] == {}
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    event = OpsSecurityEvent.objects.get(pk=base.strip("/").split("/")[-1])
    event.force_allocation[0]["members"] = [{"employeeId": str(person.pk), "kindCode": "CANDIDATE_GROUP", "divisionId": str(person.staff_unit.division_id)}]
    event.save(update_fields=["force_allocation"])
    response = head.get(url + "candidates/", {"kindCode": "PHYSICAL_SQUAD"})
    counts = response.data["request"]["assignedByKind"]
    assert counts.get("PHYSICAL_SQUAD", 0) == 0
    assert counts["CANDIDATE_GROUP"] == 1
    person.staff_unit.delete()
    response = head.get(url + "candidates/", {"kindCode": "PHYSICAL_SQUAD"})
    assert response.data["request"]["directorates"][0]["assigned"] == 1
    assert response.data["request"]["assignedByKind"]["CANDIDATE_GROUP"] == 1


def test_pagination_search_and_permission_are_explicit(manager):
    head, person, url, _, _ = setup_request(manager)
    for surname in ["Альфа", "Бета", "Гамма"]:
        employee_of(person.staff_unit.division, surname)
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP", "pageSize": 2})
    assert response.status_code == 200
    assert response.data["count"] == 4 and response.data["hasNext"] is True
    second = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP", "pageSize": 2, "page": 2})
    assert len(second.data["results"]) == 2 and second.data["hasNext"] is False
    assert not ({row["employeeId"] for row in response.data["results"]} & {row["employeeId"] for row in second.data["results"]})
    found = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP", "search": "Кандидатов"})
    assert found.data["count"] == 1
    reader, _ = client_for("candidate-reader", "CANDIDATE_READER", perms=("status.view",))
    assert reader.get(url + "candidates/").status_code == 403
    assert head.get(url + "candidates/", {"pageSize": 51}).status_code == 400


def test_group_assessment_uses_the_entire_event_interval(manager):
    head, person, url, base, _ = setup_request(manager)
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    event = OpsSecurityEvent.objects.get(pk=base.strip("/").split("/")[-1])
    event.business_date_end = "2026-08-13"
    event.save(update_fields=["business_date_end"])
    StatusType.objects.get_or_create(code="VACATION", defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"})
    OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code="VACATION", date_start="2026-08-13", date_end="2026-08-14")
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.data["results"][0]["code"] == "OVERLAPPING_HARD_STATUS"
    assert response.data["request"]["businessDateEnd"] == "2026-08-13"


def test_soft_override_does_not_hide_a_submitted_day_restriction(manager):
    from django.utils import timezone
    from organization_management.apps.operations.models_submission import OpsDailySubmission
    head, person, url, _, _ = setup_request(manager)
    _soft_conflicting_status(person)
    OpsDailySubmission.objects.create(division_id=person.staff_unit.division_id, business_date="2026-08-10", event=OpsDailySubmission.Event.CONFIRMED_NO_CHANGES, submitted_by="fixture", submitted_at=timezone.now(), snapshot={"roster": [{"employee_id": person.pk}]})
    response = head.get(url + "candidates/", {"kindCode": "CANDIDATE_GROUP"})
    assert response.status_code == 200
    assert response.data["results"][0]["assessment"] == "BLOCKED"
    assert response.data["results"][0]["code"] == "AMENDMENT_REASON_REQUIRED"
    assert response.data["results"][0]["overridable"] is False
