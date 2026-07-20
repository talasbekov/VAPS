"""Service tests: create_facility / update_passport / deactivate_facility (14.1).

The service layer is the ONLY writer (no HTTP surface in this story). Pinned
contracts: BR-OBJECT-001 (facility+passport atomically), donor AC-041
(passport change writes BOTH domain history and the audit log, same
transaction), duplicate code → structural 409 via pre-check (race backstop =
CONSTRAINT_ERROR_MAP), locked reads for mutations (E3-retro lock canon),
actor/input sanitization incl. length caps (E5 §4.1).
"""

import uuid
from datetime import datetime

import pytest
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.facilities.services import facility_service as services
from apps.operations.facilities.models import (
    Facility,
    FacilityPassport,
    FacilityPassportHistory,
)

pytestmark = pytest.mark.django_db

ACTOR = "user-14"


def _create(**overrides):
    fields = {
        "actor": ACTOR,
        "code": "OBJ-1",
        "name": "Резиденция",
        "address": "г. Астана, ул. Первая, 1",
    }
    fields.update(overrides)
    return services.create_facility(**fields)


# --- create_facility ---------------------------------------------------------


def test_create_creates_facility_passport_and_audit():
    facility = _create()
    passport = facility.passport
    assert passport.completeness_status == FacilityPassport.Completeness.RED
    log = AuditLog.objects.get(action="FACILITY_CREATED")
    assert log.actor_user_id == ACTOR
    assert log.entity_type == "facility"
    assert log.new_value["code"] == "OBJ-1"
    assert log.new_value["id"] == facility.pk
    assert facility.created_by == ACTOR


@pytest.mark.parametrize("dup_code", ["OBJ-1", "obj-1", " OBJ-1 "])
def test_create_duplicate_code_is_structural_409(dup_code):
    # Case/padding variants are the same facility (Lower("code") unique +
    # iexact pre-check) — every spelling must hit the same 409.
    _create()
    with pytest.raises(DomainError) as excinfo:
        _create(code=dup_code, name="Другой")
    assert excinfo.value.code == "FACILITY_ALREADY_EXISTS"
    assert excinfo.value.http_status == 409
    assert excinfo.value.overridable is False


@pytest.mark.parametrize("actor", ["", "   ", None, "x" * 101])
def test_create_requires_valid_actor(actor):
    with pytest.raises(DomainError) as excinfo:
        _create(actor=actor)
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.http_status == 400


@pytest.mark.parametrize("field", ["code", "name", "address"])
def test_create_requires_non_blank_required_fields(field):
    with pytest.raises(DomainError) as excinfo:
        _create(**{field: "   "})
    assert excinfo.value.code == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("field", "value"),
    [("code", "X" * 51), ("name", "И" * 256), ("importance_level_code", "L" * 51)],
)
def test_create_caps_lengths_before_db(field, value):
    # varchar overflow at the DB is a DataError → 500; the service must 400.
    with pytest.raises(DomainError) as excinfo:
        _create(**{field: value})
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert field in excinfo.value.detail["fields"]


@pytest.mark.parametrize("latitude", ["91", "NaN", "nan", "Infinity", "abc"])
def test_create_rejects_bad_latitude_as_400(latitude):
    # Decimal("NaN") survives the constructor and would explode on ordered
    # comparison — the finite-check must turn it into a clean 400.
    with pytest.raises(DomainError) as excinfo:
        _create(latitude=latitude)
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "latitude" in excinfo.value.detail["fields"]


def test_create_is_atomic_when_audit_fails(monkeypatch):
    # Red probe of the transaction seam: if the audit write blows up, neither
    # the facility nor the passport row may survive (audit rides the caller's
    # ambient transaction — 4.3 canon).
    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(services, "record", _boom)
    with pytest.raises(RuntimeError):
        _create()
    assert Facility.objects.count() == 0
    assert FacilityPassport.objects.count() == 0


def test_create_strips_inputs():
    facility = _create(code="  OBJ-9  ", name="  Штаб  ", address="  Адрес  ")
    assert facility.code == "OBJ-9"
    assert facility.name == "Штаб"
    assert facility.address == "Адрес"


# --- update_passport ---------------------------------------------------------


def test_update_writes_history_and_audit():
    facility = _create()
    passport = services.update_passport(
        actor=ACTOR,
        facility_id=facility.pk,
        changes={
            "vulnerable_places": "неосвещённый периметр у гаража",
            "description": "трёхэтажное здание",
        },
        reason="рекогносцировка 20.07",
    )
    assert passport.vulnerable_places == "неосвещённый периметр у гаража"

    history = FacilityPassportHistory.objects.get()
    assert history.changed_by == ACTOR
    assert history.reason == "рекогносцировка 20.07"
    # Diff carries ONLY the changed fields (full snapshot is the E18 closure
    # concern, not history's).
    assert set(history.old_value) == {"vulnerable_places", "description"}
    assert history.old_value["vulnerable_places"] == ""
    assert history.new_value["vulnerable_places"] == (
        "неосвещённый периметр у гаража"
    )

    log = AuditLog.objects.get(action="FACILITY_PASSPORT_UPDATED")
    assert log.old_value == history.old_value
    assert log.new_value == history.new_value
    assert log.reason == "рекогносцировка 20.07"


def test_update_is_atomic_when_audit_fails(monkeypatch):
    # AC-3 red probe: history and audit live or die together — if record()
    # blows up, the passport fields AND the history row must roll back.
    facility = _create()

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(services, "record", _boom)
    with pytest.raises(RuntimeError):
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"description": "новое"},
        )
    facility.passport.refresh_from_db()
    assert facility.passport.description == ""
    assert FacilityPassportHistory.objects.count() == 0


def test_update_reads_passport_with_row_lock():
    # Lock canon (E3 retro blocker class): the mutation must read FOR UPDATE.
    facility = _create()
    from django.db import connection

    with CaptureQueriesContext(connection) as ctx:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"description": "с локом"},
        )
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)


def test_update_unknown_field_rejected():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"favourite_color": "green"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "favourite_color" in excinfo.value.detail["unknown_fields"]


def test_update_last_verified_fields_are_not_editable():
    # verify-flow belongs to 15.4 — the whitelist must not smuggle it in early.
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"last_verified_at": "2026-07-20T00:00:00Z"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_editable_whitelist_mirrors_model_fields():
    # Drift guard: a passport field added to the model but not to the service
    # whitelist would silently become uneditable (or vice versa). Exclusions
    # are the deliberate ones: pk/FK/timestamps/actor + the 15.4 verify pair.
    excluded = {
        "id",
        "facility",
        "created_at",
        "updated_at",
        "created_by",
        "last_verified_at",
        "last_verified_by",
        "history",
    }
    model_fields = {
        f.name
        for f in FacilityPassport._meta.get_fields()
        if f.name not in excluded
    }
    assert model_fields == services.PASSPORT_EDITABLE_FIELDS


def test_update_noop_writes_nothing_and_touches_nothing():
    # Honest idempotence: identical values → no history, no audit, and the
    # row itself untouched (updated_at snapshot — a save() here would silently
    # move it and break future optimistic-lock/ETag contracts).
    facility = _create()
    before = facility.passport.updated_at
    services.update_passport(
        actor=ACTOR,
        facility_id=facility.pk,
        changes={"description": ""},
    )
    facility.passport.refresh_from_db()
    assert facility.passport.updated_at == before
    assert facility.passport.description == ""
    assert FacilityPassportHistory.objects.count() == 0
    assert AuditLog.objects.filter(action="FACILITY_PASSPORT_UPDATED").count() == 0


def test_update_empty_changes_rejected():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(actor=ACTOR, facility_id=facility.pk, changes={})
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_update_completeness_validated_against_choices():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"completeness_status": "PURPLE"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"

    passport = services.update_passport(
        actor=ACTOR,
        facility_id=facility.pk,
        changes={"completeness_status": "GREEN"},
    )
    assert passport.completeness_status == "GREEN"


def test_update_list_field_requires_json_safe_list():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"cameras": "две у входа"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"

    # Non-JSON-safe elements would otherwise raise TypeError at save() INSIDE
    # the transaction → 500; must be a clean 400 at canonization.
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"cameras": [{"checked": datetime(2026, 7, 20)}]},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "cameras" in excinfo.value.detail["fields"]

    passport = services.update_passport(
        actor=ACTOR,
        facility_id=facility.pk,
        changes={"cameras": [{"место": "вход", "штук": 2}]},
    )
    assert passport.cameras == [{"место": "вход", "штук": 2}]


def test_update_responsible_employee_id_canonized():
    facility = _create()
    employee_uuid = uuid.uuid4()
    passport = services.update_passport(
        actor=ACTOR,
        facility_id=facility.pk,
        changes={"responsible_employee_id": f"  {employee_uuid}  "},
    )
    assert passport.responsible_employee_id == employee_uuid

    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"responsible_employee_id": "not-a-uuid"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_update_free_string_fields_capped_at_100():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"object_type": "т" * 101},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "object_type" in excinfo.value.detail["fields"]


def test_update_on_deactivated_facility_is_409():
    # Soft-delete freezes the aggregate: no passport edits afterwards.
    facility = _create()
    services.deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR, facility_id=facility.pk, changes={"description": "x"}
        )
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    assert excinfo.value.http_status == 409
    assert FacilityPassportHistory.objects.count() == 0


def test_update_whitespace_only_change_is_noop():
    # strip-normalization: ' ' equals the stored '' — no fabricated history.
    facility = _create()
    services.update_passport(
        actor=ACTOR, facility_id=facility.pk, changes={"description": "   "}
    )
    assert FacilityPassportHistory.objects.count() == 0


def test_update_mixed_type_keys_are_clean_400():
    # sorted() over mixed int/str keys would raise TypeError → 500.
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR, facility_id=facility.pk, changes={1: "x", "bogus": "y"}
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.detail["unknown_fields"] == ["1", "bogus"]


def test_update_reason_must_be_string():
    facility = _create()
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR,
            facility_id=facility.pk,
            changes={"description": "x"},
            reason={"note": "dict"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_audits_coordinates_and_importance():
    # Without an update_facility service these reach the FR-36 trail only
    # here — absence would make "who set the coordinates" unreconstructible.
    _create(latitude="51.1", longitude="71.4", importance_level_code="HIGH")
    log = AuditLog.objects.get(action="FACILITY_CREATED")
    assert log.new_value["latitude"] == "51.100000"
    assert log.new_value["longitude"] == "71.400000"
    assert log.new_value["importance_level_code"] == "HIGH"


def test_missing_facility_404():
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR, facility_id=999_999, changes={"description": "x"}
        )
    assert excinfo.value.code == "ENTITY_NOT_FOUND"
    assert excinfo.value.http_status == 404


def test_update_facility_without_passport_is_404_not_500():
    # BR-OBJECT-001 holds only on the service path; a raw-ORM facility (seed,
    # donor import) has no passport — must surface as DomainError, not as an
    # uncaught RelatedObjectDoesNotExist.
    orphan = Facility.objects.create(code="OBJ-X", name="Без паспорта", address="а")
    with pytest.raises(DomainError) as excinfo:
        services.update_passport(
            actor=ACTOR, facility_id=orphan.pk, changes={"description": "x"}
        )
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


# --- deactivate_facility -----------------------------------------------------


def test_deactivate_sets_flag_and_audits_with_lock():
    facility = _create()
    from django.db import connection

    with CaptureQueriesContext(connection) as ctx:
        result = services.deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    assert result.is_active is False
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
    log = AuditLog.objects.get(action="FACILITY_DEACTIVATED")
    assert log.old_value == {"is_active": True}
    assert log.new_value == {"is_active": False}


def test_deactivate_twice_is_structural_409():
    facility = _create()
    services.deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        services.deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    assert excinfo.value.http_status == 409
    assert AuditLog.objects.filter(action="FACILITY_DEACTIVATED").count() == 1
