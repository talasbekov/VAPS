"""Story 5.8a — daily-submissions API serializers (input form + 201 projection)."""

from rest_framework import serializers

from apps.operations.submissions.models import DailySubmission


class DailySubmissionCreateSerializer(serializers.Serializer):
    """POST-body form — exactly the two kwargs the API forwards to submit_day:
    a flat UUID division ref (ARCH-003) and a YYYY-MM-DD business date (closes
    the business_date=None defer class for the submit path). The actor NEVER
    comes from the payload (ARCH-SEC-030) — extra fields, including
    submitted_by, are ignored.
    """

    division_id = serializers.UUIDField()
    business_date = serializers.DateField()


class DailySubmissionSerializer(serializers.ModelSerializer):
    """201 projection — flat, snake_case, WITHOUT the heavy snapshot JSON
    (tens–hundreds of KB per row) and without the amend-only fields
    (reason/sanction/triggered_by_status_id — always empty on v1). Whether the
    detail view returns the snapshot is 5.8c's decision.
    """

    class Meta:
        model = DailySubmission
        fields = [
            "id",
            "division_id",
            "business_date",
            "version",
            "is_current",
            "event",
            "submitted_by",
            "submitted_at",
            "late",
        ]
        read_only_fields = fields
