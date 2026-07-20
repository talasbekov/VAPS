"""Facility services — the only writers of the facilities subdomain (14.1).

Contracts pinned here:
- BR-OBJECT-001: a facility is created WITH its passport, atomically; the
  passport defaults to RED. A passport missing outside this path (raw ORM,
  seed, donor import) surfaces as ENTITY_NOT_FOUND — never a 500.
- Donor AC-041: a passport change writes BOTH domain history (old/new diff of
  the changed fields + reason) and an audit row, in one transaction.
- Duplicate ``code``: the service PRE-CHECKS and raises the structural 409
  (sequential path); the concurrent race trips ``uq_facility_code`` and is
  mapped by CONSTRAINT_ERROR_MAP at the HTTP layer (summary_service canon) —
  no IntegrityError string-parsing in the service.
- Mutations of existing rows read through ``select_for_update`` inside the
  service's atomic block (lock canon; the E3-retro "update without lock"
  blocker class).
- ``audit_logs.entity_id`` is a UUID while Facility rides an integer PK — the
  entity axis is uuid5 over the pk (block_override precedent). The int pk
  rides in ``new_value`` of FACILITY_CREATED; update/deactivate rows carry
  the field diff only — the axis itself identifies the facility.

No HTTP surface and no permission gate in this story: services take ``actor``
(flat string, ARCH-007); enforcement arrives with the API story.
"""

import json
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import (
    Facility,
    FacilityPassport,
    FacilityPassportHistory,
)
from apps.operations.facilities.selectors import FacilitySelector

_AUDIT_ENTITY_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:facility")

# audit_logs.actor_user_id / created_by / changed_by are all varchar(100).
_ACTOR_MAX = 100

_PASSPORT_TEXT_FIELDS = frozenset(
    {
        "description",
        "security_notes",
        "vulnerable_places",
        "power_supply",
        "ventilation",
        "communication",
        "internet",
        "nearby_high_buildings",
        "public_zones",
        "crowd_places",
        "repair_works",
    }
)
_PASSPORT_LIST_FIELDS = frozenset(
    {
        "access_routes",
        "entrances",
        "exits",
        "service_entrances",
        "parking_zones",
        "dropoff_zones",
        "elevators",
        "stairs",
        "roofs",
        "basements",
        "technical_rooms",
        "cameras",
    }
)
# last_verified_at/by are deliberately absent: the verify flow is 15.4.
# The whitelist is mirrored against the model by a drift test.
PASSPORT_EDITABLE_FIELDS = (
    _PASSPORT_TEXT_FIELDS
    | _PASSPORT_LIST_FIELDS
    | {
        "object_type",
        "responsible_user_id",
        "responsible_employee_id",
        "completeness_status",
    }
)


def _audit_entity_id(facility_pk) -> uuid.UUID:
    return uuid.uuid5(_AUDIT_ENTITY_NS, str(facility_pk))


def _invalid(field: str, message: str, **extra_detail) -> DomainError:
    return DomainError(
        "VALIDATION_ERROR",
        400,
        detail={"fields": [field], **extra_detail},
        message=message,
    )


def _require_actor(actor) -> str:
    if not isinstance(actor, str) or not actor.strip():
        raise _invalid("actor", "Требуется непустой actor.")
    actor = actor.strip()
    if len(actor) > _ACTOR_MAX:
        raise _invalid("actor", f"actor длиннее {_ACTOR_MAX} символов.")
    return actor


def _require_non_blank(value, field: str, max_len: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _invalid(field, f"Поле {field} обязательно и не может быть пустым.")
    value = value.strip()
    if max_len is not None and len(value) > max_len:
        raise _invalid(field, f"Поле {field} длиннее {max_len} символов.")
    return value


def _canonize_coordinate(value, field: str, bound: int):
    if value is None:
        return None
    try:
        decimal_value = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise _invalid(field, f"Поле {field} должно быть числом.")
    # Decimal("NaN") passes the constructor but explodes on ordered
    # comparison (InvalidOperation) — reject all non-finite values first.
    if not decimal_value.is_finite():
        raise _invalid(field, f"Поле {field} должно быть конечным числом.")
    # Quantize to the column scale BEFORE the range check: otherwise the
    # returned instance silently diverges from what numeric(9,6) stores
    # (89.99999999 would pass the check yet land as 90.000000).
    decimal_value = decimal_value.quantize(Decimal("0.000001"))
    if decimal_value < -bound or decimal_value > bound:
        raise _invalid(field, f"Поле {field} вне диапазона ±{bound}.")
    return decimal_value


def _canonize_optional_str(value, field: str, max_len: int):
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid(field, f"Поле {field} должно быть строкой или null.")
    value = value.strip()
    if len(value) > max_len:
        raise _invalid(field, f"Поле {field} длиннее {max_len} символов.")
    return value or None


def create_facility(
    *,
    actor,
    code,
    name,
    address,
    latitude=None,
    longitude=None,
    importance_level_code=None,
) -> Facility:
    actor = _require_actor(actor)
    code = _require_non_blank(code, "code", max_len=50)
    name = _require_non_blank(name, "name", max_len=255)
    address = _require_non_blank(address, "address")
    latitude = _canonize_coordinate(latitude, "latitude", 90)
    longitude = _canonize_coordinate(longitude, "longitude", 180)
    if importance_level_code is not None:
        importance_level_code = _require_non_blank(
            importance_level_code, "importance_level_code", max_len=50
        )

    # Sequential duplicate → structural 409 here; the concurrent race trips
    # uq_facility_code and surfaces via CONSTRAINT_ERROR_MAP (HTTP layer).
    # iexact mirrors the case-insensitive unique (Lower("code")).
    if Facility.objects.filter(code__iexact=code).exists():
        raise DomainError(
            "FACILITY_ALREADY_EXISTS",
            409,
            detail={"code": code},
            message="Объект с таким кодом уже существует.",
        )

    with transaction.atomic():
        facility = Facility.objects.create(
            code=code,
            name=name,
            address=address,
            latitude=latitude,
            longitude=longitude,
            importance_level_code=importance_level_code,
            created_by=actor,
        )
        # BR-OBJECT-001: an active facility always has a passport.
        FacilityPassport.objects.create(facility=facility, created_by=actor)
        record(
            actor=actor,
            action="FACILITY_CREATED",
            entity_type="facility",
            entity_id=_audit_entity_id(facility.pk),
            new_value={
                "id": facility.pk,
                "code": facility.code,
                "name": facility.name,
                "address": facility.address,
                # str() — Decimal is not JSON-safe; None stays None. Without
                # these the coordinates would never reach the FR-36 trail
                # (no update_facility service exists yet).
                "latitude": None if latitude is None else str(latitude),
                "longitude": None if longitude is None else str(longitude),
                "importance_level_code": importance_level_code,
            },
        )
    return facility


def _canonize_passport_value(field: str, value):
    if field in _PASSPORT_LIST_FIELDS:
        if not isinstance(value, list):
            raise _invalid(field, f"Поле {field} должно быть списком.")
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            raise _invalid(
                field,
                f"Поле {field} содержит не JSON-сериализуемые элементы.",
            )
        return value
    if field in _PASSPORT_TEXT_FIELDS:
        if value is None:
            return ""
        if not isinstance(value, str):
            raise _invalid(field, f"Поле {field} должно быть строкой.")
        # strip: a whitespace-only "change" must not fabricate a history row
        # (mirrors create's code/name/address normalization).
        return value.strip()
    if field == "completeness_status":
        if value not in FacilityPassport.Completeness.values:
            raise _invalid(
                field,
                "Недопустимый статус заполненности паспорта.",
                allowed=list(FacilityPassport.Completeness.values),
            )
        return value
    if field == "responsible_employee_id":
        if value is None:
            return None
        try:
            return uuid.UUID(str(value).strip())
        except ValueError:
            raise _invalid(field, "responsible_employee_id должен быть UUID.")
    # object_type / responsible_user_id: nullable bounded strings.
    return _canonize_optional_str(value, field, max_len=100)


def _json_safe(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def update_passport(*, actor, facility_id, changes, reason="") -> FacilityPassport:
    actor = _require_actor(actor)
    if not isinstance(changes, dict) or not changes:
        raise _invalid("changes", "Требуется непустой словарь изменений.")
    if not isinstance(reason, str):
        raise _invalid("reason", "reason должен быть строкой.")
    # key=str: non-string keys are always unknown, and bare sorted() on
    # mixed int/str keys raises TypeError → 500.
    unknown = sorted(
        (str(key) for key in set(changes) - PASSPORT_EDITABLE_FIELDS), key=str
    )
    if unknown:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"unknown_fields": unknown},
            message="Неизвестные или нередактируемые поля паспорта.",
        )
    canonized = {
        field: _canonize_passport_value(field, raw)
        for field, raw in changes.items()
    }

    with transaction.atomic():
        passport = FacilitySelector.passport_for_update(facility_id)
        if not passport.facility.is_active:
            # Soft-delete freezes the aggregate: no passport edits on a
            # deactivated facility (ARCH-DATA-025 lifecycle).
            raise DomainError(
                "FACILITY_ALREADY_INACTIVE",
                409,
                detail={"facility_id": passport.facility_id},
                message="Объект деактивирован — паспорт заморожен.",
            )

        old_diff = {}
        new_diff = {}
        for field, new_value in canonized.items():
            current = getattr(passport, field)
            if current != new_value:
                old_diff[field] = _json_safe(current)
                new_diff[field] = _json_safe(new_value)
                setattr(passport, field, new_value)

        if not new_diff:
            # Honest idempotence: identical values leave no history, no audit
            # and no row touch (an empty-diff history row would be vacuous).
            return passport

        passport.save(update_fields=[*new_diff, "updated_at"])
        FacilityPassportHistory.objects.create(
            passport=passport,
            changed_by=actor,
            changed_at=Clock.now(),
            old_value=old_diff,
            new_value=new_diff,
            reason=reason,
        )
        record(
            actor=actor,
            action="FACILITY_PASSPORT_UPDATED",
            entity_type="facility",
            entity_id=_audit_entity_id(passport.facility_id),
            old_value=old_diff,
            new_value=new_diff,
            reason=reason,
        )
    return passport


def deactivate_facility(*, actor, facility_id) -> Facility:
    actor = _require_actor(actor)
    with transaction.atomic():
        facility = FacilitySelector.get_for_update(facility_id)
        if not facility.is_active:
            raise DomainError(
                "FACILITY_ALREADY_INACTIVE",
                409,
                detail={"facility_id": facility.pk},
                message="Объект уже деактивирован.",
            )
        # Каскад чек-листов (ревью 14.3a): активные привязки замороженного
        # объекта недостижимы для cleanup-мутаций (гвард 409), а их
        # оверрайды через PROTECT навсегда запирали бы удаление пунктов
        # шаблона. Каждая привязка деактивируется со своей audit-строкой.
        # Ленивый импорт: checklist_service сам импортирует этот модуль.
        from apps.operations.facilities.services.checklist_service import (
            deactivate_bindings_for_facility,
        )

        deactivated_binding_ids = deactivate_bindings_for_facility(
            actor, facility
        )
        facility.is_active = False
        facility.save(update_fields=["is_active", "updated_at"])
        new_value = {"is_active": False}
        if deactivated_binding_ids:
            new_value["deactivated_checklist_binding_ids"] = (
                deactivated_binding_ids
            )
        record(
            actor=actor,
            action="FACILITY_DEACTIVATED",
            entity_type="facility",
            entity_id=_audit_entity_id(facility.pk),
            old_value={"is_active": True},
            new_value=new_value,
        )
    return facility
