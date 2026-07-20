"""Duty type services (14.4) — the only writers of ``ops_duty_types``.

Inherits every 14.1/14.2 service canon: actor kwarg, locked reads inside
atomic, pre-check duplicates (sequential 409) + CONSTRAINT_ERROR_MAP race
backstop, honest noop on updates, structural 409 for state conflicts, frozen-
aggregate guard on EVERY mutation, flat public keys in audit diffs, one
canonizer dict serving BOTH create kwargs and update changes.

Layer-specific contracts:
- ``code`` is NOT editable (Д3): it is the identity duty plans (14.5) and
  IMPORT_DUTY_TYPES (object_code+code) reference; renaming = deactivate +
  create.
- ``default_post_type_code`` resolves UNDER LOCK inside the mutation's
  transaction (is_active gate; the 14.3a template-lock canon — a concurrent
  admin delete/deactivation of the PostType must not slip between resolve and
  INSERT as an unmapped FK 500); ``None`` clears the hint — the FK is
  SET_NULL (Д2).
- ``deactivate_facility`` does NOT cascade duty types (Д4): the frozen guard
  blocks their mutations, and no PROTECT trap exists here (external references
  arrive only with 14.5's RESTRICT).
"""

import uuid

from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import DutyType, PostType
from apps.operations.facilities.selectors import (
    DutyTypeSelector,
    FacilitySelector,
)
from apps.operations.facilities.services.facility_service import (
    _invalid,
    _require_actor,
    _require_non_blank,
)
from apps.operations.facilities.services.topology_service import (
    _canonize_bool,
    _canonize_int,
    _canonize_text,
    _check_unknown,
    _diff_value,
    _require_active_facility,
)

_DUTY_TYPE_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:duty_type")


def _duty_type_inactive(pk) -> DomainError:
    return DomainError(
        "DUTY_TYPE_ALREADY_INACTIVE",
        409,
        detail={"duty_type_id": pk},
        message="Вид дежурства деактивирован.",
    )


def _require_active_duty_type(duty_type):
    if not duty_type.is_active:
        raise _duty_type_inactive(duty_type.pk)


def _resolve_default_post_type_locked(code):
    """Локированный резолв справочной ссылки ВНУТРИ транзакции мутации
    (канон _resolve_template_locked 14.3a): конкурентный admin-delete типа
    между резолвом и INSERT/UPDATE иначе всплывает незамапленным FK-500
    (SET_NULL срабатывает только на закоммиченных строках), а конкурентная
    деактивация проскакивает мимо is_active-гейта. None снимает подсказку
    (Д2 — SET_NULL, не контракт). Ревью-фикс: детали ошибки несут публичный
    ключ default_post_type_code, не post_type_code топологии."""
    if code is None:
        return None
    code = _require_non_blank(code, "default_post_type_code", max_len=50)
    post_type = (
        PostType.objects.select_for_update()
        .filter(pk=code, is_active=True)
        .first()
    )
    if post_type is None:
        raise _invalid(
            "default_post_type_code",
            f"Неизвестный или неактивный тип поста: {code}.",
        )
    return post_type


# Один словарь канонизаторов на create И update — расхождение правил
# create/update не может появиться, не тронув этот dict (канон 14.2).
# default_post_type_code канонизируется отдельно: ему нужен локированный
# резолв внутри транзакции (канон sector_id в create_post).
_DUTY_TYPE_CANONIZERS = {
    "name": lambda v: _require_non_blank(v, "name", max_len=255),
    "description": lambda v: _canonize_text(v, "description"),
    "default_duration_minutes": lambda v: _canonize_int(
        v, "default_duration_minutes", 1, nullable=True
    ),
    "rest_after_minutes": lambda v: _canonize_int(
        v, "rest_after_minutes", 0
    ),
    "before_duty_minutes": lambda v: _canonize_int(
        v, "before_duty_minutes", 0
    ),
    "requires_reconnaissance": lambda v: _canonize_bool(
        v, "requires_reconnaissance"
    ),
}
DUTY_TYPE_EDITABLE_FIELDS = frozenset(_DUTY_TYPE_CANONIZERS) | {
    "default_post_type_code"
}
# public key → model attribute
_DUTY_TYPE_ATTRS = {"default_post_type_code": "default_post_type"}


def _duplicate(facility_pk, code) -> DomainError:
    return DomainError(
        "DUTY_TYPE_ALREADY_EXISTS",
        409,
        detail={"facility_id": facility_pk, "code": code},
        message="Вид дежурства с таким кодом на объекте уже существует.",
    )


def create_duty_type(
    *,
    actor,
    facility_id,
    code,
    name,
    description=None,
    default_post_type_code=None,
    default_duration_minutes=None,
    rest_after_minutes=1440,
    before_duty_minutes=0,
    requires_reconnaissance=False,
) -> DutyType:
    actor = _require_actor(actor)
    code = _require_non_blank(code, "code", max_len=100)
    fields = {
        "name": name,
        "description": description,
        "default_duration_minutes": default_duration_minutes,
        "rest_after_minutes": rest_after_minutes,
        "before_duty_minutes": before_duty_minutes,
        "requires_reconnaissance": requires_reconnaissance,
    }
    canonized = {
        key: _DUTY_TYPE_CANONIZERS[key](value)
        for key, value in fields.items()
    }

    with transaction.atomic():
        facility = FacilitySelector.get_for_update(facility_id)
        _require_active_facility(facility)
        default_post_type = _resolve_default_post_type_locked(
            default_post_type_code
        )
        if DutyType.objects.filter(
            facility_id=facility.pk, code__iexact=code, is_active=True
        ).exists():
            raise _duplicate(facility.pk, code)
        duty_type = DutyType.objects.create(
            facility=facility,
            code=code,
            default_post_type=default_post_type,
            created_by=actor,
            **canonized,
        )
        record(
            actor=actor,
            action="DUTY_TYPE_CREATED",
            entity_type="duty_type",
            entity_id=uuid.uuid5(_DUTY_TYPE_NS, str(duty_type.pk)),
            new_value={
                "id": duty_type.pk,
                "facility_id": facility.pk,
                "code": duty_type.code,
                "default_post_type_code": _diff_value(default_post_type),
                **{
                    key: _diff_value(value)
                    for key, value in canonized.items()
                },
            },
        )
    return duty_type


def update_duty_type(*, actor, duty_type_id, changes) -> DutyType:
    actor = _require_actor(actor)
    _check_unknown(changes, DUTY_TYPE_EDITABLE_FIELDS, "вида дежурства")
    canonized = {
        key: _DUTY_TYPE_CANONIZERS[key](value)
        for key, value in changes.items()
        if key != "default_post_type_code"
    }

    with transaction.atomic():
        duty_type = DutyTypeSelector.get_for_update(duty_type_id)
        _require_active_facility(duty_type.facility)
        _require_active_duty_type(duty_type)
        if "default_post_type_code" in changes:
            canonized["default_post_type_code"] = (
                _resolve_default_post_type_locked(
                    changes["default_post_type_code"]
                )
            )

        old_diff, new_diff = {}, {}
        for field, new_value in canonized.items():
            attr = _DUTY_TYPE_ATTRS.get(field, field)
            current = getattr(duty_type, attr)
            if current != new_value:
                old_diff[field] = _diff_value(current)
                new_diff[field] = _diff_value(new_value)
                setattr(duty_type, attr, new_value)
        if not new_diff:
            return duty_type
        duty_type.save(
            update_fields=[
                *(_DUTY_TYPE_ATTRS.get(f, f) for f in new_diff),
                "updated_at",
            ]
        )
        record(
            actor=actor,
            action="DUTY_TYPE_UPDATED",
            entity_type="duty_type",
            entity_id=uuid.uuid5(_DUTY_TYPE_NS, str(duty_type.pk)),
            old_value=old_diff,
            new_value=new_diff,
        )
    return duty_type


def deactivate_duty_type(*, actor, duty_type_id) -> DutyType:
    actor = _require_actor(actor)
    with transaction.atomic():
        duty_type = DutyTypeSelector.get_for_update(duty_type_id)
        _require_active_facility(duty_type.facility)
        _require_active_duty_type(duty_type)
        duty_type.is_active = False
        duty_type.save(update_fields=["is_active", "updated_at"])
        record(
            actor=actor,
            action="DUTY_TYPE_DEACTIVATED",
            entity_type="duty_type",
            entity_id=uuid.uuid5(_DUTY_TYPE_NS, str(duty_type.pk)),
            old_value={"is_active": True},
            new_value={"is_active": False},
        )
    return duty_type
