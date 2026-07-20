"""Service tests for duty types (14.4, AC 3-6).

Inherited pins: FOR UPDATE asserted PER TABLE (any("FOR UPDATE") is vacuous —
14.3a review), atomicity red probes via monkeypatched record(), honest noop
(updated_at snapshot), structural 409 for state conflicts, whitelist drift vs
model, literal of= pin.
"""

import uuid

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import DutyType, PostType
from apps.operations.facilities.selectors import DutyTypeSelector
from apps.operations.facilities.services import (
    create_facility,
    deactivate_facility,
)
from apps.operations.facilities.services import duty_type_service as svc

pytestmark = pytest.mark.django_db

ACTOR = "user-14"

_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:duty_type")


@pytest.fixture
def facility():
    return create_facility(
        actor=ACTOR, code="OBJ-1", name="Резиденция", address="а"
    )


@pytest.fixture
def post_type():
    return PostType.objects.create(code="DT-FIXED", name="Стационарный")


def _duty_type(facility, **overrides):
    fields = {
        "actor": ACTOR,
        "facility_id": facility.pk,
        "code": "DAY",
        "name": "Суточное",
    }
    fields.update(overrides)
    return svc.create_duty_type(**fields)


# --- create ------------------------------------------------------------------


def test_create_defaults_and_audit(facility):
    duty_type = _duty_type(facility)
    assert duty_type.created_by == ACTOR
    assert duty_type.rest_after_minutes == 1440
    assert duty_type.before_duty_minutes == 0
    log = AuditLog.objects.get(action="DUTY_TYPE_CREATED")
    assert log.entity_type == "duty_type"
    assert log.actor_user_id == ACTOR
    # uuid5-ось запинена: чужой неймспейс = дырявая история сущности.
    assert log.entity_id == uuid.uuid5(_NS, str(duty_type.pk))
    assert log.new_value == {
        "id": duty_type.pk,
        "facility_id": facility.pk,
        "code": "DAY",
        "name": "Суточное",
        "description": "",
        "default_post_type_code": None,
        "default_duration_minutes": None,
        "rest_after_minutes": 1440,
        "before_duty_minutes": 0,
        "requires_reconnaissance": False,
    }


def test_create_with_post_type_flat_key(facility, post_type):
    duty_type = _duty_type(facility, default_post_type_code="DT-FIXED")
    assert duty_type.default_post_type_id == "DT-FIXED"
    log = AuditLog.objects.get(action="DUTY_TYPE_CREATED")
    assert log.new_value["default_post_type_code"] == "DT-FIXED"


@pytest.mark.parametrize("dup", ["DAY", "day", " DAY "])
def test_create_duplicate_code_409(facility, dup):
    _duty_type(facility)
    with pytest.raises(DomainError) as excinfo:
        _duty_type(facility, code=dup, name="Дубль")
    assert excinfo.value.code == "DUTY_TYPE_ALREADY_EXISTS"
    assert excinfo.value.http_status == 409


def test_create_on_inactive_facility_409(facility):
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        _duty_type(facility)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    assert excinfo.value.http_status == 409


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("code", "   "),
        ("name", ""),
        ("default_duration_minutes", 0),
        ("default_duration_minutes", True),
        ("rest_after_minutes", -1),
        ("before_duty_minutes", -1),
        ("requires_reconnaissance", "да"),
        ("default_post_type_code", "NO-SUCH"),
        # Капы до БД: int4-потолок и длины — 400, не DataError-500.
        ("rest_after_minutes", 2**31),
        ("rest_after_minutes", None),
        ("before_duty_minutes", None),
        ("code", "X" * 101),
        ("name", "И" * 256),
    ],
)
def test_create_invalid_params_400(facility, field, value):
    with pytest.raises(DomainError) as excinfo:
        _duty_type(facility, **{field: value})
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.http_status == 400


def test_create_inactive_post_type_400(facility):
    PostType.objects.create(
        code="DT-OFF", name="Выключен", is_active=False
    )
    with pytest.raises(DomainError) as excinfo:
        _duty_type(facility, default_post_type_code="DT-OFF")
    assert excinfo.value.code == "VALIDATION_ERROR"
    # Публичный ключ поля — свой, не post_type_code топологии (ревью-фикс).
    assert excinfo.value.detail == {"fields": ["default_post_type_code"]}


def test_create_locks_facility_and_probe_tables(facility):
    # Локи ассертятся ПО ТАБЛИЦАМ (урок 14.3a): any("FOR UPDATE")
    # удовлетворялся бы любым чужим локом.
    with CaptureQueriesContext(connection) as ctx:
        _duty_type(facility)
    lock_idx = [
        i
        for i, q in enumerate(ctx.captured_queries)
        if "FOR UPDATE" in q["sql"] and "ops_facilities" in q["sql"]
    ]
    duty_idx = [
        i
        for i, q in enumerate(ctx.captured_queries)
        if "ops_duty_types" in q["sql"]
    ]
    assert lock_idx and duty_idx
    # Порядок запинен: пре-чек дубля и INSERT идут ПОСЛЕ лока объекта —
    # пре-чек вне лока = окно гонки (ревью 14.4).
    assert lock_idx[0] < duty_idx[0]


def test_create_atomicity_no_orphan_row(facility, monkeypatch):
    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(svc, "record", _boom)
    with pytest.raises(RuntimeError):
        _duty_type(facility)
    assert not DutyType.objects.exists()


# --- update ------------------------------------------------------------------


def test_update_diff_audit_flat_keys(facility, post_type):
    duty_type = _duty_type(facility)
    snapshot = duty_type.updated_at
    svc.update_duty_type(
        actor=ACTOR,
        duty_type_id=duty_type.pk,
        changes={
            "name": "Ночное",
            "default_post_type_code": "DT-FIXED",
            "rest_after_minutes": 720,
        },
    )
    # Персистентность из БД, не in-memory возвращённый объект: setattr без
    # записи в update_fields этот ассерт красит (ревью 14.4, High).
    duty_type.refresh_from_db()
    assert duty_type.name == "Ночное"
    assert duty_type.default_post_type_id == "DT-FIXED"
    assert duty_type.rest_after_minutes == 720
    assert duty_type.updated_at > snapshot
    log = AuditLog.objects.get(action="DUTY_TYPE_UPDATED")
    assert log.entity_type == "duty_type"
    assert log.actor_user_id == ACTOR
    assert log.entity_id == uuid.uuid5(_NS, str(duty_type.pk))
    assert log.old_value == {
        "name": "Суточное",
        "default_post_type_code": None,
        "rest_after_minutes": 1440,
    }
    assert log.new_value == {
        "name": "Ночное",
        "default_post_type_code": "DT-FIXED",
        "rest_after_minutes": 720,
    }


def test_update_clear_default_post_type(facility, post_type):
    # Nullable-ветка: None снимает подсказку (Д2 — потеря не ломает вид).
    duty_type = _duty_type(facility, default_post_type_code="DT-FIXED")
    updated = svc.update_duty_type(
        actor=ACTOR,
        duty_type_id=duty_type.pk,
        changes={"default_post_type_code": None},
    )
    updated.refresh_from_db()
    assert updated.default_post_type is None
    log = AuditLog.objects.get(action="DUTY_TYPE_UPDATED")
    assert log.old_value == {"default_post_type_code": "DT-FIXED"}
    assert log.new_value == {"default_post_type_code": None}


def test_update_clear_duration_null_legal(facility):
    # duration — единственный nullable-числовой параметр: None снимает его.
    duty_type = _duty_type(facility, default_duration_minutes=480)
    svc.update_duty_type(
        actor=ACTOR,
        duty_type_id=duty_type.pk,
        changes={"default_duration_minutes": None},
    )
    duty_type.refresh_from_db()
    assert duty_type.default_duration_minutes is None


def test_update_honest_noop(facility):
    duty_type = _duty_type(facility)
    snapshot = duty_type.updated_at
    result = svc.update_duty_type(
        actor=ACTOR,
        duty_type_id=duty_type.pk,
        changes={"name": "Суточное"},
    )
    result.refresh_from_db()
    assert result.updated_at == snapshot
    assert not AuditLog.objects.filter(action="DUTY_TYPE_UPDATED").exists()


def test_update_code_is_not_editable(facility):
    # Д3: code — идентификатор для 14.5+/импорта, правка = деактивация+создание.
    duty_type = _duty_type(facility)
    with pytest.raises(DomainError) as excinfo:
        svc.update_duty_type(
            actor=ACTOR,
            duty_type_id=duty_type.pk,
            changes={"code": "NIGHT"},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.detail == {"unknown_fields": ["code"]}


def test_update_unknown_fields_sorted(facility):
    duty_type = _duty_type(facility)
    with pytest.raises(DomainError) as excinfo:
        svc.update_duty_type(
            actor=ACTOR,
            duty_type_id=duty_type.pk,
            changes={"zzz": 1, "aaa": 2},
        )
    assert excinfo.value.detail == {"unknown_fields": ["aaa", "zzz"]}


def test_update_on_inactive_facility_409(facility):
    duty_type = _duty_type(facility)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.update_duty_type(
            actor=ACTOR, duty_type_id=duty_type.pk, changes={"name": "Н"}
        )
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


def test_update_inactive_duty_type_409(facility):
    duty_type = _duty_type(facility)
    svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.update_duty_type(
            actor=ACTOR, duty_type_id=duty_type.pk, changes={"name": "Н"}
        )
    assert excinfo.value.code == "DUTY_TYPE_ALREADY_INACTIVE"
    assert excinfo.value.http_status == 409


def test_update_atomicity_no_partial_write(facility, monkeypatch):
    duty_type = _duty_type(facility)

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(svc, "record", _boom)
    with pytest.raises(RuntimeError):
        svc.update_duty_type(
            actor=ACTOR, duty_type_id=duty_type.pk, changes={"name": "Ночное"}
        )
    duty_type.refresh_from_db()
    assert duty_type.name == "Суточное"


# --- deactivate --------------------------------------------------------------


def test_deactivate_audits(facility):
    duty_type = _duty_type(facility)
    snapshot = duty_type.updated_at
    svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    duty_type.refresh_from_db()
    assert duty_type.is_active is False
    assert duty_type.updated_at > snapshot
    log = AuditLog.objects.get(action="DUTY_TYPE_DEACTIVATED")
    # uuid5-ось всех ТРЁХ record запинена (ревью 14.4: deactivate был дырой).
    assert log.entity_type == "duty_type"
    assert log.actor_user_id == ACTOR
    assert log.entity_id == uuid.uuid5(_NS, str(duty_type.pk))
    assert log.old_value == {"is_active": True}
    assert log.new_value == {"is_active": False}


def test_deactivate_atomicity_no_partial_write(facility, monkeypatch):
    duty_type = _duty_type(facility)

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(svc, "record", _boom)
    with pytest.raises(RuntimeError):
        svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    duty_type.refresh_from_db()
    assert duty_type.is_active is True


def test_deactivate_twice_409(facility):
    duty_type = _duty_type(facility)
    svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    assert excinfo.value.code == "DUTY_TYPE_ALREADY_INACTIVE"


def test_deactivate_on_inactive_facility_409(facility):
    # Д4: deactivate_facility НЕ каскадит виды дежурств — но и мутации их
    # под замороженным объектом недостижимы (канон Sector/Post).
    duty_type = _duty_type(facility)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.deactivate_duty_type(actor=ACTOR, duty_type_id=duty_type.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"
    duty_type.refresh_from_db()
    assert duty_type.is_active is True


def test_deactivate_facility_does_not_cascade_duty_types(facility):
    _duty_type(facility)
    log_count = AuditLog.objects.count()
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    assert DutyType.objects.get().is_active is True
    assert not AuditLog.objects.filter(
        action="DUTY_TYPE_DEACTIVATED"
    ).exists()
    assert AuditLog.objects.count() == log_count + 1  # только FACILITY_*


# --- selector ----------------------------------------------------------------


@pytest.mark.parametrize(
    # 10**9 — валидный формат, строки нет: исполняет ветку first()->None
    # (ревью 14.4: garbage-пробы падали раньше, в _canonize_pk).
    "garbage",
    [None, 1.9, True, "1.9", "+5", "abc", 10**9],
)
def test_selector_garbage_pk_exact_pairs(garbage):
    for fn in (DutyTypeSelector.get, DutyTypeSelector.get_for_update):
        with pytest.raises(DomainError) as excinfo:
            with transaction.atomic():
                fn(garbage)
        # Точные пары (код, статус) — дизъюнктивный ассерт маскировал бы 500.
        assert excinfo.value.code == "ENTITY_NOT_FOUND"
        assert excinfo.value.http_status == 404


def test_selector_lock_scope_literal_of_pin(facility):
    # Состав of= пинуется буквально (урок 3×High 14.3a): facility ОБЯЗАН
    # лочиться (frozen-гвард читает его is_active), справочник PostType — НЕТ
    # (nullable LEFT JOIN + общий справочник).
    duty_type = _duty_type(facility)
    with transaction.atomic():
        with CaptureQueriesContext(connection) as ctx:
            DutyTypeSelector.get_for_update(duty_type.pk)
    (sql,) = [
        q["sql"] for q in ctx.captured_queries if "FOR UPDATE" in q["sql"]
    ]
    of_clause = sql.split("FOR UPDATE OF", 1)[1]
    assert '"ops_duty_types"' in of_clause
    assert '"ops_facilities"' in of_clause
    assert "post_type" not in of_clause


def test_list_for_facility_active_only_ordered(facility):
    b = _duty_type(facility, code="B", name="б")
    a = _duty_type(facility, code="A", name="а")
    dead = _duty_type(facility, code="C", name="в")
    svc.deactivate_duty_type(actor=ACTOR, duty_type_id=dead.pk)
    assert list(DutyTypeSelector.list_for_facility(ACTOR, facility.pk)) == [
        a,
        b,
    ]


# --- guards ------------------------------------------------------------------


def test_constraint_map_covers_duty_type_unique():
    # Дрейф-гвард CONSTRAINT_ERROR_MAP: пиннятся и ЗНАЧЕНИЯ — membership
    # пропустил бы скопипащенный чужой код/статус.
    from apps.core.api.exception_handler import CONSTRAINT_ERROR_MAP

    real = {c.name for c in DutyType._meta.constraints}
    assert "uq_duty_type_facility_code" in real
    assert CONSTRAINT_ERROR_MAP["uq_duty_type_facility_code"] == (
        "DUTY_TYPE_ALREADY_EXISTS",
        409,
        False,
    )


def test_editable_fields_drift_vs_model():
    # Дрейф-гвард whitelist↔модель: поле, исчезнувшее из модели, обязано
    # исчезнуть из whitelist (иначе update падает 500 на setattr/сохранении).
    model_fields = {f.name for f in DutyType._meta.get_fields()}
    public_to_attr = {"default_post_type_code": "default_post_type"}
    for field in svc.DUTY_TYPE_EDITABLE_FIELDS:
        assert public_to_attr.get(field, field) in model_fields
    # code/facility/is_active/created_by — сознательно вне whitelist.
    assert "code" not in svc.DUTY_TYPE_EDITABLE_FIELDS
    assert "is_active" not in svc.DUTY_TYPE_EDITABLE_FIELDS


def test_registries_cover_duty_type_literals():
    # Closed-world: literal-в-literal против реестров.
    import pathlib

    import yaml

    root = pathlib.Path(__file__).resolve().parents[6]
    audit = yaml.safe_load(
        (root / "docs/registries/audit-events.yaml").read_text()
    )
    errors = yaml.safe_load(
        (root / "docs/registries/error-codes.yaml").read_text()
    )
    for action in (
        "DUTY_TYPE_CREATED",
        "DUTY_TYPE_UPDATED",
        "DUTY_TYPE_DEACTIVATED",
    ):
        assert action in audit["actions"], action
    for code in ("DUTY_TYPE_ALREADY_EXISTS", "DUTY_TYPE_ALREADY_INACTIVE"):
        assert code in errors["codes"], code


def test_admin_does_not_register_duty_type():
    # Д1: object-scoped бизнес-модель — НЕ admin-справочник.
    from django.contrib import admin

    assert DutyType not in admin.site._registry


# --- lifecycle chain ---------------------------------------------------------


def test_full_lifecycle_chain(facility, post_type):
    # Цепочка целиком: create → update → deactivate → re-create того же code
    # (partial-уник освобождает идентификатор).
    first = _duty_type(facility)
    svc.update_duty_type(
        actor=ACTOR,
        duty_type_id=first.pk,
        changes={
            "name": "Суточное (СБ)",
            "default_post_type_code": "DT-FIXED",
            "before_duty_minutes": 60,
        },
    )
    svc.deactivate_duty_type(actor=ACTOR, duty_type_id=first.pk)
    # Конечное СОСТОЯНИЕ из БД, не только pk (ревью 14.4: цепочка без
    # ассертов значений — вакуумный снимок).
    first.refresh_from_db()
    assert first.name == "Суточное (СБ)"
    assert first.default_post_type_id == "DT-FIXED"
    assert first.before_duty_minutes == 60
    assert first.is_active is False
    fresh = _duty_type(facility)  # тот же код DAY
    assert fresh.pk != first.pk
    assert list(
        DutyTypeSelector.list_for_facility(ACTOR, facility.pk)
    ) == [fresh]
