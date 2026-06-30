from apps.operations.submissions.models import (
    DailySubmission,
    SubmissionControlSettings,
)


class DailySubmissionSelector:
    """Read access to daily submissions for the сдача service (5.3b)."""

    @staticmethod
    def current_for(division_id, business_date):
        """The current (is_current) submission for (division, day), or None.

        Drives the duplicate pre-check (409 DAY_ALREADY_SUBMITTED): a second
        сдача of a day that already has a current version is rejected before the
        INSERT (the partial-unique is only the race backstop).
        """
        return DailySubmission.objects.filter(
            division_id=division_id, business_date=business_date, is_current=True
        ).first()

    @staticmethod
    def covering(employee_id, business_dates):
        """Current submissions on ``business_dates`` whose snapshot roster contains
        the employee — amendment-enforcement detection by snapshot MEMBERSHIP (5.4b).

        Detection MUST key off the immutable snapshot (which froze the employee's
        division at сдача-time), NOT a recomputed edit-time division: a transfer or
        history correction between сдача and the retro-edit moves the live division,
        so resolving via ``division_at`` would look at the wrong day's submission and
        miss the covered one (the «две правды» the invariant forbids). One JSONB
        containment query (``snapshot->'roster' @> [{"employee_id": …}]``) over all
        affected days. ``is_current=True`` means a withdrawn («ноль текущих») day has
        no active расход to keep consistent → correctly excluded.
        """
        if not business_dates:
            return []
        return list(
            DailySubmission.objects.filter(
                business_date__in=business_dates,
                is_current=True,
                snapshot__roster__contains=[{"employee_id": str(employee_id)}],
            )
        )

    @staticmethod
    def latest_for(division_id, business_date, lock=False):
        """The highest-version submission for (division, day) — current or not — or
        None. Basis for amendment (5.4a): version = latest.version + 1.

        Unlike ``current_for`` (which filters is_current), this finds the chain head
        even in the «ноль текущих» edge (a day with only non-current versions), so
        amendment never collides with ``unique_daily_submission_version``. ``lock``
        takes ``select_for_update`` on the matched row to serialize concurrent
        amendments inside the service's atomic block (constraint is the backstop).
        """
        qs = DailySubmission.objects.filter(
            division_id=division_id, business_date=business_date
        )
        if lock:
            qs = qs.select_for_update()
        return qs.order_by("-version").first()

    @staticmethod
    def previous_for(division_id, business_date):
        """The most recent current submission STRICTLY before business_date — the
        «вчерашний снапшот» diff-baseline (5.3b event).

        Most-recent prior is_current (NOT literal business_date-1): robust to
        weekends/gaps. Rides idx_daily_submission_lookup (division_id,
        business_date, -version).
        """
        return (
            DailySubmission.objects.filter(
                division_id=division_id,
                business_date__lt=business_date,
                is_current=True,
            )
            .order_by("-business_date", "-version")
            .first()
        )


class SubmissionControlSettingsSelector:
    """Read-only access to the singleton submission-control settings.

    Deviation from the list-selector convention (no actor scoping): this reads
    a single global config row, so visibility narrowing does not apply. The
    default row (control_hour=17:00, required_division_ids=[]) is seeded by
    migration 0001, so get_or_create normally just reads; it stays self-healing
    if the row is ever removed.
    """

    @classmethod
    def get(cls):
        settings, _ = SubmissionControlSettings.objects.get_or_create(singleton_key=1)
        return settings

    @classmethod
    def control_hour(cls):
        return cls.get().control_hour

    @classmethod
    def required_division_ids(cls):
        return list(cls.get().required_division_ids)
