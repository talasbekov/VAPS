"""Story 6.10b — HTTP gate for the «расход на завтра» block (FR-18).

Wraps the derive-only ``tomorrow_block`` (5.6a) with the HTTP-422 surfacing the
service deliberately left to the API layer: for a FUTURE ``business_date`` a live
block raises 422 ``TOMORROW_BLOCKED`` with the (JSON-safe, stale-filtered)
laggards. Past/today dates are never blocked (FR-18: «за прошедшие даты —
всегда»). The legal bypass is the separate override endpoint (6.10b) over
``override_tomorrow_block`` (5.6b) — an active override lifts ``blocked`` inside
``tomorrow_block`` itself, so no special-casing here.

Isolation (ARCH-004): reads the structure only through ``CoreDivisionTreeSelector``
(stale-id filter), never ``apps.core.models``. Business_date + today are explicit
arguments (the view passes ``Clock.today_local()``); no Clock read here.
"""

from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.submissions.tomorrow_block import tomorrow_block


def assert_tomorrow_not_blocked(*, business_date, today):
    """Raise 422 ``TOMORROW_BLOCKED`` if issuing расход for a blocked future date.

    Only FUTURE dates are gated (FR-18). ``laggards`` are coerced to ``str`` (they
    are ``uuid.UUID`` from the ArrayField — a raw UUID is not JSON-serializable in
    the §36 error ``detail``) and filtered of stale required-ids (a division id in
    the config that no longer exists — deferred from 5.6a).
    """
    if business_date <= today:
        return
    block = tomorrow_block(business_date)
    if not block.blocked:
        return
    # Stale-id filter (defer 5.6a): keep only laggards whose division still
    # exists; divisions_map returns {id: name} for the existing ones.
    existing = CoreDivisionTreeSelector.divisions_map(block.laggards)
    laggards = [str(d) for d in block.laggards if d in existing]
    raise DomainError(
        "TOMORROW_BLOCKED",
        422,
        detail={"laggards": laggards},
        message="Расход на завтра заблокирован — не все необходимые управления сдали.",
    )
