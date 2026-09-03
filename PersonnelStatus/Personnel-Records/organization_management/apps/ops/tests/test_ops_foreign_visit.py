"""Визит иностранного ОЛ — своя сущность (Plane №435, `[МД-05]` `[ГВО-06]`
`[ГВО-08]`, Ш-19).

Правка сводки FOREIGN-мероприятия заводит визит и пишет в него (версия
растёт); у внутреннего ОМ сводка отбивается 422; «уточняется» — флаг поля:
пустое по умолчанию, в документе печатается словом только по флагу;
встречающие — ссылки на сотрудников с подписями; бэкфилл переносит патч в
визит.
"""
import pytest
from django.apps import apps as django_apps

from organization_management.apps.operations.models_gvo import (
    OpsForeignVisit,
    OpsGvoSummaryPatch,
)
from organization_management.apps.ops import documents_summary

from .test_ops_gvo_api import make_event, viewer  # noqa: F401
from .test_ops_security_events_api import make_employee  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/ops/gvo-summaries/"


def _manager():
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for

    api, _ = client_for("gvo-manager", "GVO_MANAGER", perms=("event.view", "gvo.manage"))
    return api


def test_patch_creates_the_visit_and_bumps_its_version():
    event = make_event("ОМ-В-1")
    api = _manager()
    resp = api.patch(
        f"{URL}{event.code}/",
        {"section": "head", "values": {"country": "Франция"}, "unspecified": ["radio"]},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    visit = OpsForeignVisit.objects.get(event=event)
    assert (visit.data["country"], visit.version, visit.status) == ("Франция", 2, "READY")
    assert visit.unspecified == ["radio"]
    row = api.get(f"{URL}{event.code}/").json()
    assert row["visit"]["version"] == 2 and row["visit"]["status"] == "READY"
    assert row["unspecified"] == ["radio"]
    assert row["summary"]["country"] == "Франция"
    # Патч живёт рядом (читатели Ш-20 ещё на нём).
    assert OpsGvoSummaryPatch.objects.get(event=event).patch["country"] == "Франция"


def test_internal_event_has_no_visit_and_refuses_the_summary():
    event = make_event("ОМ-В-2")
    event.kind = "INTERNAL"
    event.save(update_fields=["kind"])
    api = _manager()
    resp = api.patch(f"{URL}{event.code}/", {"section": "head", "values": {"country": "X"}}, format="json")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VISIT_FOREIGN_ONLY"
    assert not OpsForeignVisit.objects.filter(event=event).exists()
    assert api.get(f"{URL}{event.code}/").json()["visit"] is None


def test_unspecified_is_a_flag_not_a_default():
    event = make_event("ОМ-В-3")
    base = documents_summary.derive_summary(event)
    assert base["country"] == "" and base["arrival"]["time"] == "" and base["radio"] == ""
    api = _manager()
    api.patch(f"{URL}{event.code}/", {"section": "org", "values": {"radio": ""}, "unspecified": ["radio", "weapons"]}, format="json")
    values = documents_summary.document_values(event)
    assert values["radio_channel_1"] == "уточняется"
    assert values["armament_1"] == "уточняется"
    # Не помеченное пустое — пусто, не выдуманное слово.
    assert values["wishes_1"] == ""


def test_meeting_party_are_references_with_names():
    event = make_event("ОМ-В-4")
    person = make_employee("Встречающий", "В")
    api = _manager()
    resp = api.patch(
        f"{URL}{event.code}/",
        {"section": "arrival", "values": {"meetEmployeeIds": [str(person.pk)]}},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    summary = api.get(f"{URL}{event.code}/").json()["summary"]
    assert summary["meetRefs"][0]["id"] == str(person.pk)
    assert "Встречающий" in summary["meetRefs"][0]["name"]


def test_backfill_moves_patches_into_visits_for_foreign_only():
    from importlib import import_module

    foreign = make_event("ОМ-В-5")
    internal = make_event("ОМ-В-6")
    internal.kind = "INTERNAL"
    internal.save(update_fields=["kind"])
    OpsGvoSummaryPatch.objects.create(event=foreign, patch={"country": "Чехия"})
    OpsGvoSummaryPatch.objects.create(event=internal, patch={"country": "—"})
    migration = import_module(
        "organization_management.apps.operations.migrations.0086_foreign_visit"
    )
    migration.backfill_visits(django_apps, None)
    visit = OpsForeignVisit.objects.get(event=foreign)
    assert visit.data == {"country": "Чехия"} and visit.status == "READY"
    assert not OpsForeignVisit.objects.filter(event=internal).exists()
