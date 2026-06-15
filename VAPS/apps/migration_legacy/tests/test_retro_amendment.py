"""AC-4: a retroactive edit of a status interval changes the derived
strength on a covered date — demonstrated as a PURE effect, with no
Amendment / DailySubmission machinery (that is E5).

The donor has a flat model with no trace of edits; this shows the VAPS
side: moving ``date_end`` of an interval back/forward re-derives
``resolve_status`` (and therefore the расход column) on a date the
interval now does / no longer covers.
"""

from datetime import date

from apps.operations.statuses.services import (
    REPORT_COLUMN_BY_CODE,
    resolve_status,
)


def vacation(date_end):
    return [
        {
            "status_type_code": "VACATION",
            "date_start": date(2026, 6, 2),
            "date_end": date_end,
        }
    ]


class TestRetroactiveAmendmentEffect:
    def test_extending_date_end_moves_a_covered_date_into_vacation(self):
        covered = date(2026, 6, 6)

        # Before the edit: half-open [06-02, 06-06) does NOT cover 06-06.
        before = resolve_status(vacation(date(2026, 6, 6)), covered)
        assert before == "IN_SERVICE"
        assert REPORT_COLUMN_BY_CODE[before] == "IN_SERVICE"

        # Retroactive edit: date_end pushed to 06-08. The SAME date now
        # resolves differently — the расход column flips without any
        # Amendment record, purely from re-deriving the interval.
        after = resolve_status(vacation(date(2026, 6, 8)), covered)
        assert after == "VACATION"
        assert REPORT_COLUMN_BY_CODE[after] == "VACATION"

    def test_shortening_date_end_moves_a_covered_date_back_in_service(self):
        covered = date(2026, 6, 4)

        after_long = resolve_status(vacation(date(2026, 6, 6)), covered)
        assert after_long == "VACATION"

        # Shortening the interval to end on 06-03 (exclusive 06-04) pulls
        # 06-04 back to "В строю".
        after_short = resolve_status(vacation(date(2026, 6, 4)), covered)
        assert after_short == "IN_SERVICE"
