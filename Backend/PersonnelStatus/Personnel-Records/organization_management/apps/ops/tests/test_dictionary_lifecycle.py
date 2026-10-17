"""Жизненный цикл значения справочника (UC-REF-001, подпроект 2)."""
import datetime

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops import dictionaries as service

pytestmark = pytest.mark.django_db


def make(code, dictionary="RETURN_REASONS", **extra):
    return OpsDictionaryEntry.objects.create(
        dictionary_code=dictionary, code=code, label=code.title(),
        description="", is_active=True, **extra,
    )


@pytest.fixture
def api():
    client, _ = client_for(
        "lifecycle-editor", "LIFECYCLE_EDITOR",
        ["dictionary.view", "dictionary_value.manage"],
    )
    return client


def test_serialize_entry_exposes_lifecycle_fields():
    old = make("OLD", inactive_since=datetime.date(2026, 9, 1))
    new = make("NEW", supersedes=old)
    old.is_active = False
    old.save(update_fields=["is_active"])

    rows = {row["code"]: row for row in service.list_entries("RETURN_REASONS")}

    assert rows["OLD"]["inactiveSince"] == "2026-09-01"
    assert rows["OLD"]["supersedes"] is None
    assert rows["OLD"]["supersededBy"] == {"id": str(new.pk), "code": "NEW"}
    assert rows["NEW"]["supersedes"] == {"id": str(old.pk), "code": "OLD"}
    assert rows["NEW"]["supersededBy"] is None
    assert rows["NEW"]["inactiveSince"] is None


def test_new_error_and_audit_codes_are_registered():
    for code, status in (
        ("DICTIONARY_ENTRY_PROTECTED", 422),
        ("DICTIONARY_ENTRY_SUPERSEDED", 409),
        ("DICTIONARY_ENTRY_INACTIVE", 409),
    ):
        DomainError(code, status)  # не бросает ValueError
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in audit_service.ACTIONS
    assert audit_service.ENTITY_POSITION in audit_service.ENTITY_TYPES
    assert audit_service.ENTITY_RANK in audit_service.ENTITY_TYPES


def event(**overrides):
    """Минимальное мероприятие: обязательные поля пустыми значениями.

    Обязательные без default поля `OpsSecurityEvent` (models_event.py:71-260)
    перечислены здесь целиком — проба не должна лечиться подменой сборщика.
    """
    base = dict(
        code=overrides.pop("code", "OM-USAGE"), title="Проба связей",
        object_name="", business_date=datetime.date(2026, 9, 23),
        stage=OpsSecurityEvent.Stage.BULLETIN, readiness_percent=0,
        force_need=0, conflicts_count=0, owner_name="проба",
        recon_checklist=[], demand_rows=[], demand_approved=False,
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        closure_direction_summaries=[],
        recon_sector_posts=[], force_requests=[], force_allocation=[],
        placement_assignments=[], journal_entries=[],
    )
    base.update(overrides)
    return OpsSecurityEvent.objects.create(**base)


#: Обязательные поля строки статуса: ссылка на сотрудника плоская (int), связанных
#: объектов заводить не нужно вовсе.
MINIMAL_STATUS_FIELDS = dict(
    employee_id=1, status_type_code="DUTY",
    date_start=datetime.date(2026, 9, 23), date_end=datetime.date(2026, 9, 24),
)


def refs(entry):
    return {ref["sourceLabel"]: ref["count"] for ref in service.usage_of(entry)["references"]}


def test_journal_entry_types_count_journals():
    entry = make("BRIEFING", "JOURNAL_ENTRY_TYPES")
    event(journal_entries=[{"type": "BRIEFING", "title": "Инструктаж утром"},
                           {"type": "OTHER", "title": "Не считается"}])
    usage = service.usage_of(entry)
    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 1
    assert usage["references"][0]["samples"] == ["OM-USAGE: Инструктаж утром"]


def test_placement_roles_and_sections_count_assignments():
    role = make("SENIOR", "PLACEMENT_ROLES")
    section = make("GATE", "PLACEMENT_SECTIONS")
    event(placement_assignments=[{"roleCode": "SENIOR", "sectionCode": "GATE"},
                                 {"roleCode": "SENIOR", "sectionCode": "OTHER"}])
    assert service.usage_of(role)["totalCount"] == 2
    assert service.usage_of(section)["totalCount"] == 1


def test_participation_kinds_count_json_and_rows():
    kind = make("GROUP_A", "EVENT_PARTICIPATION_KINDS")
    event(
        recon_sector_posts=[{"demandKindCode": "GROUP_A"}],
        force_requests=[{"groupDemands": [{"kindCode": "GROUP_A"}],
                         "groupOffers": [{"kindCode": "GROUP_A"}]}],
        force_allocation=[{"members": [{"kindCode": "GROUP_A", "roleCode": "LEAD"}]}],
    )
    counts = refs(kind)
    assert counts["Расчёт постов ОМ"] == 1
    assert counts["Запросы сил ОМ"] == 2
    assert counts["Выделение сил ОМ"] == 1
    assert service.usage_of(kind)["totalCount"] == 4


def test_group_roles_count_allocation_members_and_children_link_parent():
    kind = make("GROUP_B", "EVENT_PARTICIPATION_KINDS")
    role = make("LEAD_B", "EVENT_GROUP_ROLES", group_code="GROUP_B")
    event(force_allocation=[{"members": [{"kindCode": "GROUP_B", "roleCode": "LEAD_B"}]}])
    assert refs(role)["Выделение сил ОМ"] == 1
    assert refs(kind)["Роли внутри группы"] == 1


def test_post_requirement_groups_count_children():
    group = make("ACCESS", "POST_REQUIREMENT_GROUPS")
    make("ACCESS_A", "POST_REQUIREMENTS", group_code="ACCESS")
    assert refs(group) == {"Требования к постам": 1}


def test_participation_rows_are_counted():
    kind = make("GROUP_C", "EVENT_PARTICIPATION_KINDS")
    role = make("LEAD_C", "EVENT_GROUP_ROLES", group_code="GROUP_C")
    ev = event(code="OM-ROWS")
    status = OpsEmployeeStatus.objects.create(**MINIMAL_STATUS_FIELDS)
    OpsStatusParticipation.objects.create(
        status=status, event_id=ev.pk, kind_code="GROUP_C", role_code="LEAD_C",
    )
    assert refs(kind)["Участия в мероприятиях"] == 1
    assert refs(role)["Участия в мероприятиях"] == 1


@pytest.mark.parametrize("dictionary", ["RETURN_REASONS", "POST_REQUIREMENTS", "SEASONAL_CORRECTIONS"])
def test_free_text_dictionaries_are_tracked_with_zero_references(dictionary):
    entry = make("FREE", dictionary)
    usage = service.usage_of(entry)
    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 0
    assert usage["references"] == []
    assert "не хранится" in usage["reason"]


def test_list_entries_uses_one_collection_per_dictionary(django_assert_max_num_queries):
    for index in range(5):
        make(f"R{index}", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "R1", "sectionCode": ""}])
    with django_assert_max_num_queries(6):
        rows = service.list_entries("PLACEMENT_ROLES")
    assert {row["code"]: row["usage"]["totalCount"] for row in rows}["R1"] == 1


def entry_url(entry):
    return f"/api/ops/dictionaries/entries/{entry.pk}/"


def test_deactivation_sets_and_activation_clears_inactive_since(api):
    entry = make("DATES")
    off = api.post(entry_url(entry) + "set-active/", {"isActive": False}, format="json")
    assert off.status_code == 200, off.content
    assert off.json()["inactiveSince"] == service.Clock.today_local().isoformat()
    on = api.post(entry_url(entry) + "set-active/", {"isActive": True}, format="json")
    assert on.status_code == 200, on.content
    assert on.json()["inactiveSince"] is None


def test_remove_without_references_deletes(api):
    entry = make("GONE")
    response = api.delete(entry_url(entry))
    assert response.status_code == 204, response.content
    assert not OpsDictionaryEntry.objects.filter(pk=entry.pk).exists()


def test_remove_with_references_deactivates_instead(api):
    role = make("BUSY", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "BUSY", "sectionCode": ""}])
    response = api.delete(entry_url(role))
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["result"] == "deactivated"
    assert body["entry"]["isActive"] is False
    assert body["entry"]["inactiveSince"] == service.Clock.today_local().isoformat()
    role.refresh_from_db()
    assert role.is_active is False


def test_protected_code_cannot_be_removed_deactivated_or_superseded(api):
    squad = make("PHYSICAL_SQUAD", "EVENT_PARTICIPATION_KINDS")
    assert api.delete(entry_url(squad)).status_code == 422
    off = api.post(entry_url(squad) + "set-active/", {"isActive": False}, format="json")
    assert off.status_code == 422, off.content
    replaced = api.post(entry_url(squad) + "supersede/",
                        {"code": "SQUAD2", "label": "Наряд", "description": ""}, format="json")
    assert replaced.status_code == 422, replaced.content
    assert replaced.json()["error_code"] == "DICTIONARY_ENTRY_PROTECTED"


def test_supersede_creates_successor_and_closes_predecessor(api, monkeypatch):
    old = make("WEATHER")
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))

    response = api.post(
        entry_url(old) + "supersede/",
        {"code": "weather2", "label": "Погодные условия", "labelKk": "Ауа райы",
         "description": "уточнено"},
        format="json",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["code"] == "WEATHER2"
    assert body["supersedes"] == {"id": str(old.pk), "code": "WEATHER"}
    assert body["isActive"] is True
    old.refresh_from_db()
    assert old.is_active is False
    assert old.inactive_since == service.Clock.today_local()
    assert old.superseded_by.get().code == "WEATHER2"
    actions = [item["action"] for item in recorded]
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in actions
    assert audit_service.DICTIONARY_ENTRY_CREATED in actions
    superseded = next(item for item in recorded if item["action"] == audit_service.DICTIONARY_ENTRY_SUPERSEDED)
    assert superseded["entity_id"] == old.pk
    assert superseded["new_value"]["successorCode"] == "WEATHER2"


def test_supersede_rejects_inactive_duplicate_and_reactivation(api):
    old = make("OLDONE")
    first = api.post(entry_url(old) + "supersede/", {"code": "NEWONE", "label": "Новое", "description": ""}, format="json")
    assert first.status_code == 201, first.content
    again = api.post(entry_url(old) + "supersede/", {"code": "NEWTWO", "label": "Ещё", "description": ""}, format="json")
    assert again.status_code == 409 and again.json()["error_code"] == "DICTIONARY_ENTRY_INACTIVE"
    dup = api.post(entry_url(OpsDictionaryEntry.objects.get(code="NEWONE")) + "supersede/",
                   {"code": "OLDONE", "label": "Дубль", "description": ""}, format="json")
    assert dup.status_code == 400, dup.content
    back = api.post(entry_url(old) + "set-active/", {"isActive": True}, format="json")
    assert back.status_code == 409 and back.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"
    gone = api.delete(entry_url(old))
    assert gone.status_code == 409 and gone.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"


def test_supersede_requires_value_permission():
    api, _ = client_for("lifecycle-manage-only", "LIFECYCLE_MANAGE_ONLY", ["dictionary.view", "dictionary.manage"])
    old = make("NOPERM")
    response = api.post(entry_url(old) + "supersede/", {"code": "NOPERM2", "label": "x", "description": ""}, format="json")
    assert response.status_code == 403


def test_admin_delete_entry_still_refuses_when_used():
    role = make("ADMINBUSY", "PLACEMENT_ROLES")
    event(placement_assignments=[{"roleCode": "ADMINBUSY", "sectionCode": ""}])
    with pytest.raises(DomainError) as failure:
        service.delete_entry(role.pk, actor="admin")
    assert failure.value.code == "DICTIONARY_ENTRY_IN_USE"
    role.refresh_from_db()
    assert role.is_active is True


def test_samples_are_capped_at_three_while_count_stays_full():
    entry = make("BRIEFING5", "JOURNAL_ENTRY_TYPES")
    event(journal_entries=[
        {"type": "BRIEFING5", "title": f"Запись {index}"} for index in range(5)
    ])
    reference = service.usage_of(entry)["references"][0]
    assert reference["count"] == 5
    assert len(reference["samples"]) == 3


def test_list_falls_back_to_unknown_when_collector_fails(api, monkeypatch):
    make("BROKEN")

    def boom(dictionary_code):
        raise RuntimeError("сборщик упал")

    monkeypatch.setattr(service, "collect_usage", boom)

    response = api.get("/api/ops/dictionaries/RETURN_REASONS/entries/")

    assert response.status_code == 200, response.content
    rows = response.json()["results"]
    assert rows and all(row["usage"]["status"] == "UNKNOWN" for row in rows)


def test_supersede_keeps_predecessor_fields_when_body_omits_them(api):
    division = Division.objects.create(name="Управление связей")
    kind = make("GROUP_OWN", "EVENT_PARTICIPATION_KINDS", label_kk="Топ",
                owner_division_id=division.pk)
    role = make("LEAD_OWN", "EVENT_GROUP_ROLES", group_code="GROUP_OWN",
                label_kk="Аға")
    role.description = "как было"
    role.save(update_fields=["description"])

    replaced_role = api.post(entry_url(role) + "supersede/",
                             {"code": "LEAD_OWN2", "label": "Старший"}, format="json")
    assert replaced_role.status_code == 201, replaced_role.content
    assert replaced_role.json()["groupCode"] == "GROUP_OWN"
    assert replaced_role.json()["labelKk"] == "Аға"
    assert replaced_role.json()["description"] == "как было"

    replaced_kind = api.post(entry_url(kind) + "supersede/",
                             {"code": "GROUP_OWN2", "label": "Группа"}, format="json")
    assert replaced_kind.status_code == 201, replaced_kind.content
    assert replaced_kind.json()["ownerDivisionId"] == str(division.pk)
    assert replaced_kind.json()["labelKk"] == "Топ"


def test_supersede_clears_kazakh_label_when_body_sends_empty(api):
    old = make("KKCLEAR", label_kk="Ескі")
    response = api.post(entry_url(old) + "supersede/",
                        {"code": "KKCLEAR2", "label": "Новое", "labelKk": ""},
                        format="json")
    assert response.status_code == 201, response.content
    assert response.json()["labelKk"] == ""
