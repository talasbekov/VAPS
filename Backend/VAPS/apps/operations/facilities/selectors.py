"""Facility selectors — ``<Domain>Selector`` canon (Story 14.1).

Every external input is canonized before touching the ORM (E5 §4.1): a
garbage pk yields ENTITY_NOT_FOUND 404 — never a 500 and never a silently
COERCED lookup. Bare ``int()`` would truncate floats (1.9 → 1) and accept
bools (True → 1), resolving a DIFFERENT facility; canonical ASCII digits
only, mirroring ``DailySubmissionSelector.by_id`` (reviews 5.8b/5.8c —
"+5"/"05"/" ٥ " are alias spellings of the same write-URL).
"""

import re

from apps.core.exceptions import DomainError
from apps.operations.facilities.models import (
    Facility,
    FacilityPassport,
    Post,
    Sector,
)

_PK_RE = re.compile(r"0|[1-9][0-9]*")


def _not_found(pk, key="facility_id") -> DomainError:
    return DomainError("ENTITY_NOT_FOUND", 404, detail={key: str(pk)})


def _canonize_pk(pk, key) -> int:
    if isinstance(pk, bool) or not isinstance(pk, (int, str)):
        raise _not_found(pk, key)
    text = pk.strip() if isinstance(pk, str) else str(pk)
    if not _PK_RE.fullmatch(text):
        raise _not_found(pk, key)
    return int(text)


class FacilitySelector:
    @staticmethod
    def canonize_pk(pk) -> int:
        return _canonize_pk(pk, "facility_id")

    @staticmethod
    def get(pk) -> Facility:
        canonical = FacilitySelector.canonize_pk(pk)
        facility = Facility.objects.filter(pk=canonical).first()
        if facility is None:
            raise _not_found(canonical)
        return facility

    @staticmethod
    def get_for_update(pk) -> Facility:
        """Locked read for mutation services (canon: select_for_update lives
        in the selector and runs inside the service's atomic block)."""
        canonical = FacilitySelector.canonize_pk(pk)
        facility = (
            Facility.objects.select_for_update().filter(pk=canonical).first()
        )
        if facility is None:
            raise _not_found(canonical)
        return facility

    @staticmethod
    def passport_for_update(pk) -> FacilityPassport:
        """Locked passport by facility pk — one JOIN query, locks both rows.

        A facility row without a passport is reachable only outside the
        service path (raw ORM, seed, donor import): surfaced as 404, not as
        an uncaught RelatedObjectDoesNotExist 500 (BR-OBJECT-001 backstop).
        """
        canonical = FacilitySelector.canonize_pk(pk)
        passport = (
            FacilityPassport.objects.select_for_update()
            .select_related("facility")
            .filter(facility_id=canonical)
            .first()
        )
        if passport is None:
            raise _not_found(canonical)
        return passport

    @staticmethod
    def list(actor):
        # actor-first per the list-selector canon; scope narrowing arrives
        # with the API story. ``id`` is the tie-breaker — without it
        # pagination on equal names silently drops rows (canon L427).
        return Facility.objects.filter(is_active=True).order_by("name", "id")


class SectorSelector:
    @staticmethod
    def get(pk) -> Sector:
        canonical = _canonize_pk(pk, "sector_id")
        sector = (
            Sector.objects.select_related("facility").filter(pk=canonical).first()
        )
        if sector is None:
            raise _not_found(canonical, "sector_id")
        return sector

    @staticmethod
    def get_for_update(pk) -> Sector:
        canonical = _canonize_pk(pk, "sector_id")
        sector = (
            Sector.objects.select_for_update()
            .select_related("facility")
            .filter(pk=canonical)
            .first()
        )
        if sector is None:
            raise _not_found(canonical, "sector_id")
        return sector

    @staticmethod
    def list_for_facility(actor, facility_pk):
        canonical = _canonize_pk(facility_pk, "facility_id")
        return Sector.objects.filter(
            facility_id=canonical, is_active=True
        ).order_by("sort_order", "name", "id")


class PostSelector:
    @staticmethod
    def get(pk) -> Post:
        canonical = _canonize_pk(pk, "post_id")
        post = (
            Post.objects.select_related("facility", "sector")
            .filter(pk=canonical)
            .first()
        )
        if post is None:
            raise _not_found(canonical, "post_id")
        return post

    @staticmethod
    def get_for_update(pk) -> Post:
        canonical = _canonize_pk(pk, "post_id")
        # of= must exclude sector (nullable side of the LEFT JOIN — Postgres
        # forbids FOR UPDATE there) but MUST include facility: the frozen-
        # aggregate guard reads facility.is_active and needs it locked
        # against a concurrent deactivate_facility.
        post = (
            Post.objects.select_for_update(of=("self", "facility"))
            .select_related("facility", "sector")
            .filter(pk=canonical)
            .first()
        )
        if post is None:
            raise _not_found(canonical, "post_id")
        return post

    @staticmethod
    def list_for_facility(actor, facility_pk):
        canonical = _canonize_pk(facility_pk, "facility_id")
        return Post.objects.filter(
            facility_id=canonical, is_active=True
        ).order_by("code", "id")
