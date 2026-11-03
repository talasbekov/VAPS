"""The catalog object's point, independent of private per-event map files."""
import math

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_object import OpsSecurityObject


def _validation(message):
    return DomainError(
        "VALIDATION_ERROR", 400,
        detail={"location": [message]},
        message="Проверьте координаты объекта.",
    )


def normalize_location(value):
    """Accept an explicit null or exactly two finite WGS84 numbers."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"latitude", "longitude"}:
        raise _validation("Укажите широту и долготу.")
    for key, limit in (("latitude", 90), ("longitude", 180)):
        number = value[key]
        # Check range before math.isfinite: arbitrarily large JSON integers
        # cannot be converted to a float, and are ordinary validation errors.
        if (
            isinstance(number, bool)
            or not isinstance(number, (int, float))
            or abs(number) > limit
            or not math.isfinite(number)
        ):
            raise _validation("Координаты выходят за допустимые границы.")
    return {key: round(float(value[key]), 6) for key in ("latitude", "longitude")}


def location_from_pair(latitude, longitude):
    if latitude is None or longitude is None:
        return None
    return {"latitude": latitude, "longitude": longitude}


def _not_found(object_id):
    return DomainError(
        "ENTITY_NOT_FOUND", 404,
        detail={"id": str(object_id)}, message="Объект не найден.",
    )


@transaction.atomic
def set_object_location(object_id, location, *, actor):
    location = normalize_location(location)
    raw_id = str(object_id)
    if not raw_id.isascii() or not raw_id.isdigit() or not 1 <= int(raw_id) <= 2**63 - 1:
        raise _not_found(object_id)
    obj = OpsSecurityObject.objects.select_for_update().filter(pk=int(raw_id)).first()
    if obj is None:
        raise _not_found(object_id)
    previous = location_from_pair(obj.latitude, obj.longitude)
    if previous == location:
        return obj
    obj.latitude = location["latitude"] if location is not None else None
    obj.longitude = location["longitude"] if location is not None else None
    obj.save(update_fields=["latitude", "longitude", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_OBJECT_LOCATION_UPDATED,
        entity_type=audit_service.ENTITY_SECURITY_OBJECT,
        entity_id=obj.pk,
        old_value={"location": previous},
        new_value={"location": location},
    )
    return obj
