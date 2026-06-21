from apps.operations.submissions.models import SubmissionControlSettings


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
