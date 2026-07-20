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
from apps.operations.facilities.models import Facility, FacilityPassport

_PK_RE = re.compile(r"0|[1-9][0-9]*")


def _not_found(pk) -> DomainError:
    return DomainError("ENTITY_NOT_FOUND", 404, detail={"facility_id": str(pk)})


class FacilitySelector:
    @staticmethod
    def canonize_pk(pk) -> int:
        if isinstance(pk, bool) or not isinstance(pk, (int, str)):
            raise _not_found(pk)
        text = pk.strip() if isinstance(pk, str) else str(pk)
        if not _PK_RE.fullmatch(text):
            raise _not_found(pk)
        return int(text)

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
