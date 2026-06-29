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
