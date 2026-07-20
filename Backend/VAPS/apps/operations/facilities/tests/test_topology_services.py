"""Service tests for sector/post topology (14.2, AC 2,3,4,6).

Inherited 14.1 pins: FOR UPDATE in captured SQL, atomicity red probes via
monkeypatched record(), honest noop (updated_at snapshot), structural 409 for
state conflicts, whitelist drift vs model.
"""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.facilities.services import topology_service as topo
from apps.operations.facilities.models import (
    Post,
    Sector,
)
from apps.operations.facilities.services import create_facility

pytestmark = pytest.mark.django_db

ACTOR = "user-14"


@pytest.fixture
def facility():
    return create_facility(
        actor=ACTOR, code="OBJ-1", name="Резиденция", address="а"
    )


@pytest.fixture(autouse=True)
def _seed_types():
    from django.core.management import call_command

    call_command("seed_facilities")


def _sector(facility, **overrides):
    fields = {"actor": ACTOR, "facility_id": facility.pk, "name": "Периметр"}
    fields.update(overrides)
    return topo.create_sector(**fields)


def _post(facility, **overrides):
    fields = {
        "actor": ACTOR,
        "facility_id": facility.pk,
        "code": "P-1",
        "name": "Пост №1",
    }
    fields.update(overrides)
    return topo.create_post(**fields)


# --- create_sector -----------------------------------------------------------


def test_create_sector_audits(facility):
    sector = _sector(facility)
    log = AuditLog.objects.get(action="SECTOR_CREATED")
    assert log.entity_type == "sector"
    assert log.new_value["name"] == "Периметр"
    assert log.new_value["facility_id"] == facility.pk
    assert sector.created_by == ACTOR


@pytest.mark.parametrize("dup", ["Периметр", "ПЕРИМЕТР", " Периметр "])
def test_create_sector_duplicate_name_409(facility, dup):
    _sector(facility)
    with pytest.raises(DomainError) as excinfo:
        _sector(facility, name=dup)
    assert excinfo.value.code == "SECTOR_ALREADY_EXISTS"
    assert excinfo.value.http_status == 409


def test_create_sector_on_inactive_facility_409(facility):
    from apps.operations.facilities.services import deactivate_facility

    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        _sector(facility)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


def test_create_sector_negative_sort_order_400(facility):
    with pytest.raises(DomainError) as excinfo:
        _sector(facility, sort_order=-1)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_sector_bool_sort_order_400(facility):
    with pytest.raises(DomainError) as excinfo:
        _sector(facility, sort_order=True)
    assert excinfo.value.code == "VALIDATION_ERROR"


# --- create_post -------------------------------------------------------------


def test_create_post_defaults_and_audit(facility):
    post = _post(facility)
    assert post.post_type_id == "FIXED"
    assert post.max_service_minutes == 480
    assert post.requirements == {"schema_version": 1}
    log = AuditLog.objects.get(action="POST_CREATED")
    assert log.new_value["code"] == "P-1"
    assert log.new_value["facility_id"] == facility.pk


@pytest.mark.parametrize("dup", ["P-1", "p-1", " P-1 "])
def test_create_post_duplicate_code_409(facility, dup):
    _post(facility)
    with pytest.raises(DomainError) as excinfo:
        _post(facility, code=dup, name="Дубль")
    assert excinfo.value.code == "POST_ALREADY_EXISTS"


def test_create_post_unknown_type_400(facility):
    with pytest.raises(DomainError) as excinfo:
        _post(facility, post_type_code="DRONE")
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "post_type_code" in excinfo.value.detail["fields"]


def test_create_post_with_sector_of_same_facility(facility):
    sector = _sector(facility)
    post = _post(facility, sector_id=sector.pk)
    assert post.sector_id == sector.pk


def test_create_post_with_foreign_sector_400(facility):
    other = create_facility(
        actor=ACTOR, code="OBJ-2", name="Другой", address="б"
    )
    foreign = _sector(other)
    with pytest.raises(DomainError) as excinfo:
        _post(facility, sector_id=foreign.pk)
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "sector_id" in excinfo.value.detail["fields"]


def test_create_post_with_inactive_sector_409(facility):
    sector = _sector(facility)
    topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    with pytest.raises(DomainError) as excinfo:
        _post(facility, sector_id=sector.pk)
    assert excinfo.value.code == "SECTOR_ALREADY_INACTIVE"


@pytest.mark.parametrize("minutes", [29, 1441, True, "480"])
def test_create_post_bad_service_minutes_400(facility, minutes):
    with pytest.raises(DomainError) as excinfo:
        _post(facility, max_service_minutes=minutes)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_post_bad_requirements_400(facility):
    with pytest.raises(DomainError) as excinfo:
        _post(facility, requirements={})
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_post_min_rating_quantized(facility):
    from decimal import Decimal

    post = _post(facility, min_rating="7.35")
    assert post.min_rating == Decimal("7.4")


@pytest.mark.parametrize("rating", ["NaN", "-0.1", "abc"])
def test_create_post_bad_rating_400(facility, rating):
    with pytest.raises(DomainError) as excinfo:
        _post(facility, min_rating=rating)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_post_atomic_when_audit_fails(facility, monkeypatch):
    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(topo, "record", _boom)
    with pytest.raises(RuntimeError):
        _post(facility)
    assert Post.objects.count() == 0


# --- update_sector / update_post ---------------------------------------------


def test_update_sector_diff_audit_and_lock(facility):
    sector = _sector(facility)
    with CaptureQueriesContext(connection) as ctx:
        topo.update_sector(
            actor=ACTOR,
            sector_id=sector.pk,
            changes={"name": "Северный периметр", "sort_order": 2},
        )
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
    log = AuditLog.objects.get(action="SECTOR_UPDATED")
    assert log.old_value == {"name": "Периметр", "sort_order": 0}
    assert log.new_value == {"name": "Северный периметр", "sort_order": 2}


def test_update_sector_whitelist_mirrors_model():
    excluded = {
        "id",
        "facility",
        "is_active",
        "created_at",
        "updated_at",
        "created_by",
        "posts",
    }
    model_fields = {
        f.name for f in Sector._meta.get_fields() if f.name not in excluded
    }
    assert model_fields == topo.SECTOR_EDITABLE_FIELDS


def test_update_post_whitelist_mirrors_model():
    # Public keys are the FLAT reference names (sector_id/post_type_code) —
    # the same in changes, create kwargs and audit diffs.
    excluded = {
        "id",
        "facility",
        "code",
        "is_active",
        "created_at",
        "updated_at",
        "created_by",
    }
    public = {"sector": "sector_id", "post_type": "post_type_code"}
    model_fields = {
        public.get(f.name, f.name)
        for f in Post._meta.get_fields()
        if f.name not in excluded
    }
    assert model_fields == topo.POST_EDITABLE_FIELDS


def test_update_post_move_to_foreign_sector_rejected(facility):
    other = create_facility(
        actor=ACTOR, code="OBJ-2", name="Другой", address="б"
    )
    foreign = _sector(other)
    post = _post(facility)
    with pytest.raises(DomainError) as excinfo:
        topo.update_post(
            actor=ACTOR, post_id=post.pk, changes={"sector_id": foreign.pk}
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_update_post_requirements_validated(facility):
    post = _post(facility)
    with pytest.raises(DomainError):
        topo.update_post(
            actor=ACTOR,
            post_id=post.pk,
            changes={"requirements": {"schema_version": 2}},
        )
    updated = topo.update_post(
        actor=ACTOR,
        post_id=post.pk,
        changes={"requirements": {"schema_version": 1, "gender": "F"}},
    )
    assert updated.requirements["gender"] == "F"


def test_update_post_noop_touches_nothing(facility):
    post = _post(facility)
    before = post.updated_at
    topo.update_post(actor=ACTOR, post_id=post.pk, changes={"name": "Пост №1"})
    post.refresh_from_db()
    assert post.updated_at == before
    assert AuditLog.objects.filter(action="POST_UPDATED").count() == 0


def test_update_post_atomic_when_audit_fails(facility, monkeypatch):
    post = _post(facility)

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(topo, "record", _boom)
    with pytest.raises(RuntimeError):
        topo.update_post(
            actor=ACTOR, post_id=post.pk, changes={"name": "Новое имя"}
        )
    post.refresh_from_db()
    assert post.name == "Пост №1"


def test_update_inactive_post_409(facility):
    post = _post(facility)
    topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    with pytest.raises(DomainError) as excinfo:
        topo.update_post(actor=ACTOR, post_id=post.pk, changes={"name": "x"})
    assert excinfo.value.code == "POST_ALREADY_INACTIVE"


# --- deactivate --------------------------------------------------------------


def test_deactivate_sector_unties_posts_with_lock(facility):
    sector = _sector(facility)
    p1 = _post(facility, sector_id=sector.pk)
    p2 = _post(facility, code="P-2", name="Пост №2", sector_id=sector.pk)
    with CaptureQueriesContext(connection) as ctx:
        topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
    p1.refresh_from_db()
    p2.refresh_from_db()
    assert p1.sector_id is None and p2.sector_id is None
    log = AuditLog.objects.get(action="SECTOR_DEACTIVATED")
    assert sorted(log.new_value["untied_post_ids"]) == sorted([p1.pk, p2.pk])


def test_deactivate_sector_without_posts_no_untied_key(facility):
    sector = _sector(facility)
    topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    log = AuditLog.objects.get(action="SECTOR_DEACTIVATED")
    assert "untied_post_ids" not in log.new_value


def test_deactivate_sector_twice_409(facility):
    sector = _sector(facility)
    topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    with pytest.raises(DomainError) as excinfo:
        topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    assert excinfo.value.code == "SECTOR_ALREADY_INACTIVE"
    assert AuditLog.objects.filter(action="SECTOR_DEACTIVATED").count() == 1


def test_deactivate_post_twice_409(facility):
    post = _post(facility)
    topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    with pytest.raises(DomainError) as excinfo:
        topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    assert excinfo.value.code == "POST_ALREADY_INACTIVE"
    assert AuditLog.objects.filter(action="POST_DEACTIVATED").count() == 1


# --- ревью-пины: замороженный объект, атомарность, локи, границы -------------


def test_deactivations_frozen_facility_409(facility):
    # Soft-delete замораживает агрегат ЦЕЛИКОМ: deactivate-пути — тоже
    # мутации (untie постов!), не исключение из заморозки.
    from apps.operations.facilities.services import deactivate_facility

    sector = _sector(facility)
    post = _post(facility, sector_id=sector.pk)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    with pytest.raises(DomainError) as excinfo:
        topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    post.refresh_from_db()
    assert post.sector_id == sector.pk  # untie не случился


def test_updates_frozen_facility_409(facility):
    from apps.operations.facilities.services import deactivate_facility

    sector = _sector(facility)
    post = _post(facility)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        topo.update_sector(
            actor=ACTOR, sector_id=sector.pk, changes={"sort_order": 1}
        )
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    with pytest.raises(DomainError) as excinfo:
        topo.update_post(actor=ACTOR, post_id=post.pk, changes={"name": "x"})
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


def test_create_post_frozen_facility_409(facility):
    from apps.operations.facilities.services import deactivate_facility

    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        _post(facility)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


@pytest.mark.parametrize(
    "mutation",
    ["create_sector", "update_sector", "deactivate_sector", "deactivate_post"],
)
def test_all_mutations_atomic_when_audit_fails(facility, monkeypatch, mutation):
    # Каждая мутация живёт и умирает вместе со своей audit-строкой; для
    # deactivate_sector это пиннит и откат bulk-untie постов.
    sector = _sector(facility)
    post = _post(facility, sector_id=sector.pk)

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(topo, "record", _boom)
    with pytest.raises(RuntimeError):
        if mutation == "create_sector":
            _sector(facility, name="Новый")
        elif mutation == "update_sector":
            topo.update_sector(
                actor=ACTOR, sector_id=sector.pk, changes={"sort_order": 7}
            )
        elif mutation == "deactivate_sector":
            topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
        else:
            topo.deactivate_post(actor=ACTOR, post_id=post.pk)

    sector.refresh_from_db()
    post.refresh_from_db()
    assert sector.is_active is True
    assert sector.sort_order == 0
    assert post.is_active is True
    assert post.sector_id == sector.pk  # bulk-untie откатился
    assert Sector.objects.filter(name="Новый").count() == 0


def test_update_and_deactivate_post_hold_row_lock(facility):
    post = _post(facility)
    with CaptureQueriesContext(connection) as ctx:
        topo.update_post(actor=ACTOR, post_id=post.pk, changes={"name": "Н"})
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
    with CaptureQueriesContext(connection) as ctx:
        topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)


def test_update_sector_rename_duplicate_409(facility):
    _sector(facility, name="Запад")
    sector = _sector(facility, name="Восток")
    with pytest.raises(DomainError) as excinfo:
        topo.update_sector(
            actor=ACTOR, sector_id=sector.pk, changes={"name": "ЗАПАД"}
        )
    assert excinfo.value.code == "SECTOR_ALREADY_EXISTS"


def test_update_sector_noop_touches_nothing(facility):
    sector = _sector(facility)
    before = sector.updated_at
    topo.update_sector(
        actor=ACTOR, sector_id=sector.pk, changes={"name": "Периметр"}
    )
    sector.refresh_from_db()
    assert sector.updated_at == before
    assert AuditLog.objects.filter(action="SECTOR_UPDATED").count() == 0


@pytest.mark.parametrize(
    ("service_kwargs", "field"),
    [
        ({"sort_order": 2**31}, "sort_order"),
        ({"sort_order": 0}, None),  # контроль: валидный проходит
    ],
)
def test_sector_int_upper_bound(facility, service_kwargs, field):
    # int4-потолок: DataError 'integer out of range' — это 500; сервис
    # обязан отдать 400 (интегральный аналог капа длины 14.1).
    if field is None:
        assert _sector(facility, name="Гранично", **service_kwargs).pk
    else:
        with pytest.raises(DomainError) as excinfo:
            _sector(facility, **service_kwargs)
        assert excinfo.value.code == "VALIDATION_ERROR"


def test_post_continuous_minutes_bounds_service_side(facility):
    with pytest.raises(DomainError) as excinfo:
        _post(facility, max_continuous_minutes=0)
    assert excinfo.value.code == "VALIDATION_ERROR"
    with pytest.raises(DomainError) as excinfo:
        _post(facility, max_continuous_minutes=2**31)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_dead_sector_reference_in_payload_is_400_not_404(facility):
    # 404 адресует ресурс URL (пост/объект), битая ссылка в теле — 400.
    with pytest.raises(DomainError) as excinfo:
        _post(facility, sector_id=999_999)
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "sector_id" in excinfo.value.detail["fields"]


def test_deactivated_sector_frees_name(facility):
    # Partial-unique: soft-delete не скваттит имя навсегда.
    sector = _sector(facility)
    topo.deactivate_sector(actor=ACTOR, sector_id=sector.pk)
    fresh = _sector(facility)  # то же имя «Периметр»
    assert fresh.pk != sector.pk


def test_deactivated_post_frees_code(facility):
    post = _post(facility)
    topo.deactivate_post(actor=ACTOR, post_id=post.pk)
    fresh = _post(facility)  # тот же код P-1
    assert fresh.pk != post.pk


def test_update_post_audit_uses_flat_reference_keys(facility):
    # Ключи диффа = публичные плоские имена (sector_id/post_type_code) —
    # те же, что в POST_CREATED и create-kwargs; имена атрибутов модели
    # в аудит не утекают.
    sector = _sector(facility)
    post = _post(facility)
    topo.update_post(
        actor=ACTOR,
        post_id=post.pk,
        changes={"sector_id": sector.pk, "post_type_code": "MOBILE"},
    )
    log = AuditLog.objects.get(action="POST_UPDATED")
    assert log.old_value == {"sector_id": None, "post_type_code": "FIXED"}
    assert log.new_value == {"sector_id": sector.pk, "post_type_code": "MOBILE"}


def test_constraint_map_keys_match_real_constraints():
    # Дрейф-гвард CONSTRAINT_ERROR_MAP: ключи мапа обязаны существовать как
    # имена констрейнтов моделей — опечатка/переименование при сквоше
    # превращает race-409 в 500 'Unmapped IntegrityError'.
    from apps.core.api.exception_handler import CONSTRAINT_ERROR_MAP
    from apps.operations.facilities.models import Facility

    real = {
        c.name
        for model in (Facility, Sector, Post)
        for c in model._meta.constraints
    }
    ours = {
        "uq_facility_code",
        "uq_sector_facility_name",
        "uq_post_facility_code",
    }
    assert ours <= set(CONSTRAINT_ERROR_MAP)
    assert ours <= real
