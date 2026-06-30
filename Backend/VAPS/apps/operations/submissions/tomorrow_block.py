"""Story 5.6a — derive «блокировка на завтра» (read-only FR-18 core).

For one ``business_date`` this answers «can the расход for tomorrow be formed?»:
a division listed in «необходимые управления»
(``SubmissionControlSettings.required_division_ids``) that has NO current
(``is_current=True``) ``DailySubmission`` on the date is a *laggard*; any laggard
blocks. The result is a domain object — the HTTP-422 ``TOMORROW_BLOCKED`` surfacing
lives on the API layer (5.8/6.10), and the legal-bypass override is Story 5.6b.

Bulk by construction (NFR-4): ONE ``current_for_many`` over the whole required
set — never ``current_for`` per division. The required list is flat UUIDs
(ARCH-003); this module reads the structure only through selectors and never
imports ``apps.core.models`` (ARCH-004).

Scope (5.6a): own derive only. No override consultation (5.6b), no HTTP/422/API
(5.8/6.10), no notifications (5.7), no audit (5.9), no actor/RBAC (mirror
``StrengthReportService`` — права на API-слое). ``control_hour`` is NOT read here:
it already fed ``late`` at submit time (5.3b); the block is about the *fact* of a
submission, not its time.
"""

from dataclasses import dataclass
from datetime import date

from apps.operations.submissions.selectors import (
    DailySubmissionSelector,
    SubmissionControlSettingsSelector,
)


@dataclass(frozen=True)
class TomorrowBlock:
    """Result of the next-day lock derive.

    ``laggards`` are the required division ids (UUID) with no current submission
    on the date, in a deterministic (str-sorted) order; ``blocked`` is simply
    ``bool(laggards)``.
    """

    blocked: bool
    laggards: list


def tomorrow_block(business_date: date) -> TomorrowBlock:
    """Derive the next-day lock for ``business_date``.

    ``required`` (необходимые управления) minus the divisions that hold a current
    submission on the date = ``laggards``. An empty config means nothing is
    required → not blocked. ONE ``current_for_many`` query, invariant to the
    number of required divisions (NFR-4).
    """
    required = SubmissionControlSettingsSelector.required_division_ids()
    if not required:
        return TomorrowBlock(blocked=False, laggards=[])
    submitted = DailySubmissionSelector.current_for_many(required, business_date)
    laggards = sorted(set(required) - set(submitted), key=str)
    return TomorrowBlock(blocked=bool(laggards), laggards=laggards)
