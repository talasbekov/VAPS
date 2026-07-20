"""Sector/Post topology services (14.2) — the only writers of Sector/Post.

Inherits every 14.1 service canon: actor kwarg, locked reads inside atomic,
pre-check duplicates (sequential 409) + CONSTRAINT_ERROR_MAP race backstop,
honest noop on updates, structural 409 for state conflicts, length caps.

Topology invariants owned here (cross-row, not expressible as CHECK):
- a post's sector must belong to the SAME facility (create and move); the
  sector reference is resolved UNDER LOCK inside the mutation's transaction —
  otherwise a concurrent deactivate_sector unties existing posts while this
  write attaches a fresh post to a dead sector with no backstop;
- EVERY mutation (including deactivations) first locks the facility row and
  requires it active: soft-delete freezes the aggregate (ARCH-DATA-025);
- deactivating a sector unties its posts (service-level mirror of the
  donor's SET_NULL — the service path never DELETEs) via one bulk UPDATE
  that also advances ``updated_at`` (bulk UPDATE bypasses auto_now).

Public field keys are the FLAT reference names (``sector_id``,
``post_type_code``) in both ``changes`` dicts and audit diffs — the JSON
canon (плоский <fk>_id), matching the create kwargs; model attribute names
never leak into the audit trail.

Uniqueness is PARTIAL (is_active=True): a deactivated sector/post releases
its name/code for re-creation — soft-delete must not squat display
identifiers forever (facility.code stays total: it is a global identity).

POST_IN_USE (deactivation blocked by future duty assignments, donor :1228)
is a named defer to 14.5 — there are no duties yet to check.
"""

import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import Post, PostType, Sector
from apps.operations.facilities.selectors import (
    FacilitySelector,
    PostSelector,
    SectorSelector,
    _canonize_pk,
)
from apps.operations.facilities.services.facility_service import (
    _invalid,
    _require_actor,
    _require_non_blank,
)
from apps.operations.facilities.validators import validate_requirements

_SECTOR_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:sector")
_POST_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:post")

_INT4_MAX = 2_147_483_647


def _require_active_facility(facility):
    if not facility.is_active:
        raise DomainError(
            "FACILITY_ALREADY_INACTIVE",
            409,
            detail={"facility_id": facility.pk},
            message="Объект деактивирован — топология заморожена.",
        )


def _inactive(code, key, pk, message):
    return DomainError(code, 409, detail={key: pk}, message=message)


def _sector_inactive(pk):
    return _inactive(
        "SECTOR_ALREADY_INACTIVE", "sector_id", pk, "Сектор деактивирован."
    )


def _post_inactive(pk):
    return _inactive(
        "POST_ALREADY_INACTIVE", "post_id", pk, "Пост деактивирован."
    )


def _canonize_int(value, field, minimum, maximum=None, nullable=False):
    if value is None:
        if nullable:
            return None
        raise _invalid(field, f"Поле {field} обязательно.")
    if isinstance(value, bool) or not isinstance(value, int):
        raise _invalid(field, f"Поле {field} должно быть целым числом.")
    # int4 ceiling always applies: a value past 2^31-1 dies at the DB as an
    # unmapped DataError → 500 (the 14.1 length-cap lesson for integers).
    maximum = _INT4_MAX if maximum is None else maximum
    if value < minimum or value > maximum:
        raise _invalid(field, f"Поле {field} вне диапазона {minimum}..{maximum}.")
    return value


def _canonize_rating(value):
    if value is None:
        return None
    try:
        rating = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise _invalid("min_rating", "min_rating должен быть числом.")
    if not rating.is_finite():
        raise _invalid("min_rating", "min_rating должен быть конечным числом.")
    rating = rating.quantize(Decimal("0.1"))
    if rating < 0:
        raise _invalid("min_rating", "min_rating не может быть отрицательным.")
    if rating >= 100:
        raise _invalid("min_rating", "min_rating не влезает в NUMERIC(3,1).")
    return rating


def _canonize_text(value, field):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _invalid(field, f"Поле {field} должно быть строкой.")
    return value.strip()


def _canonize_bool(value, field):
    if not isinstance(value, bool):
        raise _invalid(field, f"Поле {field} — булево.")
    return value


def _canonize_opt_bool(value, field):
    if value is not None and not isinstance(value, bool):
        raise _invalid(field, f"Поле {field} — булево или null.")
    return value


def _resolve_post_type(code):
    # Always by code — an instance path would bypass the is_active gate.
    code = _require_non_blank(code, "post_type_code", max_len=50)
    post_type = PostType.objects.filter(pk=code, is_active=True).first()
    if post_type is None:
        raise _invalid(
            "post_type_code", f"Неизвестный или неактивный тип поста: {code}."
        )
    return post_type


# One canonization table serves BOTH create kwargs and update changes — a
# create/update rule divergence (the tasks=None asymmetry class) cannot
# reappear without touching this single dict.
_POST_CANONIZERS = {
    "name": lambda v: _require_non_blank(v, "name", max_len=255),
    "post_type_code": _resolve_post_type,
    "max_service_minutes": lambda v: _canonize_int(
        v, "max_service_minutes", 30, 1440
    ),
    "max_continuous_minutes": lambda v: _canonize_int(
        v, "max_continuous_minutes", 1, nullable=True
    ),
    "min_rating": _canonize_rating,
    "requirements": validate_requirements,
    "tasks": lambda v: _canonize_text(v, "tasks"),
    "features": lambda v: _canonize_text(v, "features"),
    "location_description": lambda v: _canonize_text(v, "location_description"),
    "is_outdoor": lambda v: _canonize_opt_bool(v, "is_outdoor"),
    "requires_weapon": lambda v: _canonize_bool(v, "requires_weapon"),
    "requires_special_equipment": lambda v: _canonize_bool(
        v, "requires_special_equipment"
    ),
    "requires_uniform": lambda v: _canonize_bool(v, "requires_uniform"),
}
# sector_id is canonized separately: it needs the facility context and a
# locked read inside the transaction.
POST_EDITABLE_FIELDS = frozenset(_POST_CANONIZERS) | {"sector_id"}
# public key → model attribute
_POST_ATTRS = {"post_type_code": "post_type", "sector_id": "sector"}

SECTOR_EDITABLE_FIELDS = frozenset({"name", "sort_order"})


def _resolve_sector_locked(facility_pk, sector_id):
    """Locked same-facility sector resolve, called INSIDE the transaction.

    A dead reference in the PAYLOAD is a 400 — the selector's 404 addresses
    the URL resource, not body references.
    """
    if sector_id is None:
        return None
    canonical = _canonize_pk(sector_id, "sector_id")
    sector = Sector.objects.select_for_update().filter(pk=canonical).first()
    if sector is None:
        raise _invalid("sector_id", f"Сектор {canonical} не существует.")
    if sector.facility_id != facility_pk:
        raise _invalid("sector_id", "Сектор принадлежит другому объекту.")
    if not sector.is_active:
        raise _sector_inactive(sector.pk)
    return sector


def _check_unknown(changes, whitelist, what):
    if not isinstance(changes, dict) or not changes:
        raise _invalid("changes", "Требуется непустой словарь изменений.")
    unknown = sorted((str(k) for k in set(changes) - whitelist), key=str)
    if unknown:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"unknown_fields": unknown},
            message=f"Неизвестные или нередактируемые поля {what}.",
        )


def _diff_value(value):
    if isinstance(value, (Sector, PostType)):
        return value.pk
    if isinstance(value, Decimal):
        return str(value)
    return value


# --- Sector ------------------------------------------------------------------


def create_sector(*, actor, facility_id, name, sort_order=0) -> Sector:
    actor = _require_actor(actor)
    name = _require_non_blank(name, "name", max_len=255)
    sort_order = _canonize_int(sort_order, "sort_order", 0)

    with transaction.atomic():
        facility = FacilitySelector.get_for_update(facility_id)
        _require_active_facility(facility)
        if Sector.objects.filter(
            facility_id=facility.pk, name__iexact=name, is_active=True
        ).exists():
            raise DomainError(
                "SECTOR_ALREADY_EXISTS",
                409,
                detail={"facility_id": facility.pk, "name": name},
                message="Сектор с таким именем на объекте уже существует.",
            )
        sector = Sector.objects.create(
            facility=facility, name=name, sort_order=sort_order, created_by=actor
        )
        record(
            actor=actor,
            action="SECTOR_CREATED",
            entity_type="sector",
            entity_id=uuid.uuid5(_SECTOR_NS, str(sector.pk)),
            new_value={
                "id": sector.pk,
                "facility_id": facility.pk,
                "name": sector.name,
                "sort_order": sector.sort_order,
            },
        )
    return sector


def update_sector(*, actor, sector_id, changes) -> Sector:
    actor = _require_actor(actor)
    _check_unknown(changes, SECTOR_EDITABLE_FIELDS, "сектора")

    canonized = {}
    if "name" in changes:
        canonized["name"] = _require_non_blank(
            changes["name"], "name", max_len=255
        )
    if "sort_order" in changes:
        canonized["sort_order"] = _canonize_int(
            changes["sort_order"], "sort_order", 0
        )

    with transaction.atomic():
        sector = SectorSelector.get_for_update(sector_id)
        _require_active_facility(sector.facility)
        if not sector.is_active:
            raise _sector_inactive(sector.pk)
        if "name" in canonized and (
            Sector.objects.filter(
                facility_id=sector.facility_id,
                name__iexact=canonized["name"],
                is_active=True,
            )
            .exclude(pk=sector.pk)
            .exists()
        ):
            raise DomainError(
                "SECTOR_ALREADY_EXISTS",
                409,
                detail={
                    "facility_id": sector.facility_id,
                    "name": canonized["name"],
                },
                message="Сектор с таким именем на объекте уже существует.",
            )

        old_diff, new_diff = {}, {}
        for field, new_value in canonized.items():
            current = getattr(sector, field)
            if current != new_value:
                old_diff[field] = current
                new_diff[field] = new_value
                setattr(sector, field, new_value)
        if not new_diff:
            return sector
        sector.save(update_fields=[*new_diff, "updated_at"])
        record(
            actor=actor,
            action="SECTOR_UPDATED",
            entity_type="sector",
            entity_id=uuid.uuid5(_SECTOR_NS, str(sector.pk)),
            old_value=old_diff,
            new_value=new_diff,
        )
    return sector


def deactivate_sector(*, actor, sector_id) -> Sector:
    actor = _require_actor(actor)
    with transaction.atomic():
        sector = SectorSelector.get_for_update(sector_id)
        # Soft-delete freezes the whole aggregate — deactivating pieces of a
        # frozen facility would still MUTATE it (bulk untie below).
        _require_active_facility(sector.facility)
        if not sector.is_active:
            raise _sector_inactive(sector.pk)
        untied_ids = list(
            Post.objects.select_for_update(of=("self",))
            .filter(sector_id=sector.pk)
            .values_list("pk", flat=True)
        )
        if untied_ids:
            # Service-level mirror of the donor's SET_NULL. Bulk UPDATE
            # bypasses auto_now — advance updated_at explicitly, or
            # modified-since consumers never see the untie.
            Post.objects.filter(pk__in=untied_ids).update(
                sector=None, updated_at=Clock.now()
            )
        sector.is_active = False
        sector.save(update_fields=["is_active", "updated_at"])
        new_value = {"is_active": False}
        if untied_ids:
            new_value["untied_post_ids"] = untied_ids
        record(
            actor=actor,
            action="SECTOR_DEACTIVATED",
            entity_type="sector",
            entity_id=uuid.uuid5(_SECTOR_NS, str(sector.pk)),
            old_value={"is_active": True},
            new_value=new_value,
        )
    return sector


# --- Post --------------------------------------------------------------------


def create_post(
    *,
    actor,
    facility_id,
    code,
    name,
    sector_id=None,
    post_type_code="FIXED",
    max_service_minutes=480,
    requirements=None,
    tasks="",
    features="",
    location_description="",
    is_outdoor=None,
    max_continuous_minutes=None,
    min_rating=None,
    requires_weapon=False,
    requires_special_equipment=False,
    requires_uniform=True,
) -> Post:
    actor = _require_actor(actor)
    code = _require_non_blank(code, "code", max_len=50)
    kwargs = {
        "name": name,
        "post_type_code": post_type_code,
        "max_service_minutes": max_service_minutes,
        "max_continuous_minutes": max_continuous_minutes,
        "min_rating": min_rating,
        "requirements": (
            {"schema_version": 1} if requirements is None else requirements
        ),
        "tasks": tasks,
        "features": features,
        "location_description": location_description,
        "is_outdoor": is_outdoor,
        "requires_weapon": requires_weapon,
        "requires_special_equipment": requires_special_equipment,
        "requires_uniform": requires_uniform,
    }
    canonized = {
        field: _POST_CANONIZERS[field](value) for field, value in kwargs.items()
    }

    with transaction.atomic():
        facility = FacilitySelector.get_for_update(facility_id)
        _require_active_facility(facility)
        sector = _resolve_sector_locked(facility.pk, sector_id)
        if Post.objects.filter(
            facility_id=facility.pk, code__iexact=code, is_active=True
        ).exists():
            raise DomainError(
                "POST_ALREADY_EXISTS",
                409,
                detail={"facility_id": facility.pk, "code": code},
                message="Пост с таким кодом на объекте уже существует.",
            )
        post = Post.objects.create(
            facility=facility,
            sector=sector,
            code=code,
            created_by=actor,
            **{
                _POST_ATTRS.get(field, field): value
                for field, value in canonized.items()
            },
        )
        record(
            actor=actor,
            action="POST_CREATED",
            entity_type="post",
            entity_id=uuid.uuid5(_POST_NS, str(post.pk)),
            new_value={
                "id": post.pk,
                "facility_id": facility.pk,
                "sector_id": post.sector_id,
                "code": post.code,
                "name": post.name,
                "post_type_code": post.post_type_id,
                "max_service_minutes": post.max_service_minutes,
            },
        )
    return post


def update_post(*, actor, post_id, changes) -> Post:
    actor = _require_actor(actor)
    _check_unknown(changes, POST_EDITABLE_FIELDS, "поста")
    pure = {
        field: _POST_CANONIZERS[field](raw)
        for field, raw in changes.items()
        if field != "sector_id"
    }

    with transaction.atomic():
        post = PostSelector.get_for_update(post_id)
        _require_active_facility(post.facility)
        if not post.is_active:
            raise _post_inactive(post.pk)

        canonized = dict(pure)
        if "sector_id" in changes:
            canonized["sector_id"] = _resolve_sector_locked(
                post.facility_id, changes["sector_id"]
            )

        old_diff, new_diff = {}, {}
        for field, new_value in canonized.items():
            attr = _POST_ATTRS.get(field, field)
            current = getattr(post, attr)
            if current != new_value:
                old_diff[field] = _diff_value(current)
                new_diff[field] = _diff_value(new_value)
                setattr(post, attr, new_value)
        if not new_diff:
            return post
        post.save(
            update_fields=[
                *(_POST_ATTRS.get(f, f) for f in new_diff),
                "updated_at",
            ]
        )
        record(
            actor=actor,
            action="POST_UPDATED",
            entity_type="post",
            entity_id=uuid.uuid5(_POST_NS, str(post.pk)),
            old_value=old_diff,
            new_value=new_diff,
        )
    return post


def deactivate_post(*, actor, post_id) -> Post:
    # POST_IN_USE guard (donor :1228) is a named defer to 14.5 — no duty
    # plans exist yet to be blocked by.
    actor = _require_actor(actor)
    with transaction.atomic():
        post = PostSelector.get_for_update(post_id)
        _require_active_facility(post.facility)
        if not post.is_active:
            raise _post_inactive(post.pk)
        post.is_active = False
        post.save(update_fields=["is_active", "updated_at"])
        record(
            actor=actor,
            action="POST_DEACTIVATED",
            entity_type="post",
            entity_id=uuid.uuid5(_POST_NS, str(post.pk)),
            old_value={"is_active": True},
            new_value={"is_active": False},
        )
    return post
