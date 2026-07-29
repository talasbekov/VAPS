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
        ]
        read_only_fields = fields
