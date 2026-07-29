from zoneinfo import ZoneInfo

from django.conf import settings
from rest_framework import serializers

from apps.operations.bugreports.models import BugReport


class BugReportCreateSerializer(serializers.Serializer):
    screen_path = serializers.CharField(max_length=255)
    app_version = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    build_sha = serializers.CharField(max_length=100, required=False, allow_blank=True)
    # max_length caps ELEMENT COUNT (DRF ListField), not string length — the
    # frontend (13.1b) only ever needs "last few" request ids; without this,
    # a giant array is still bounded by Django's global
    # DATA_UPLOAD_MAX_MEMORY_SIZE, but that's incidental, not a designed cap
    # (review: Edge Case Hunter).
    last_request_ids = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
        default=list,
        max_length=20,
    )
    description = serializers.CharField()


class BugReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = BugReport
        fields = [
            "id",
            "user_id",
            "screen_path",
            "app_version",
            "build_sha",
            "last_request_ids",
            "description",
            "created_at",
            "resolved_at",
            "resolved_in_version",
            "resolution_summary",
        ]
        read_only_fields = fields


class BugReportResolveSerializer(serializers.Serializer):
    """Story 13.4a: developer-authored, public-facing fields — NOT a copy
    of the operator's raw ``description`` (see model docstring)."""

    resolved_in_version = serializers.CharField(max_length=100)
    resolution_summary = serializers.CharField(max_length=500)

    def validate_resolved_in_version(self, value):
        if not value.strip():
            raise serializers.ValidationError("не может быть пустым.")
        return value.strip()

    def validate_resolution_summary(self, value):
        if not value.strip():
            raise serializers.ValidationError("не может быть пустым.")
        return value.strip()


class BugReportJournalEntrySerializer(serializers.ModelSerializer):
    """Story 13.4a: public journal projection (any authenticated user, see
    BugReportViewSet.journal) — deliberately NOT BugReportSerializer's
    fields. user_id/screen_path/description/last_request_ids never reach
    this projection, matching frontend/src/features/changelog/changelog.ts's
    FixEntry contract field-for-field (renamed to match its camelCase)."""

    # FixEntry.id is a string (frontend/src/features/changelog/changelog.ts)
    # — BugReport.id is an integer PK, CharField's to_representation stringifies.
    id = serializers.CharField()
    version = serializers.CharField(source="resolved_in_version")
    releasedAt = serializers.SerializerMethodField()
    summary = serializers.CharField(source="resolution_summary")

    class Meta:
        model = BugReport
        fields = ["id", "version", "releasedAt", "summary"]
        read_only_fields = fields

    def get_releasedAt(self, obj):
        # DRF's plain DateField refuses a datetime input outright (rightly —
        # bare .date() on the raw UTC-aware value would silently pick the
        # WRONG calendar day whenever local time crosses midnight relative
        # to UTC, exactly the class of tz bug this project's Clock exists to
        # prevent). Same conversion Clock.today_local() applies to "now",
        # applied here to a stored moment instead.
        return obj.resolved_at.astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)).date()
