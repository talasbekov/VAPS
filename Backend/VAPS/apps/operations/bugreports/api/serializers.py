from rest_framework import serializers

from apps.operations.bugreports.models import BugReport


class BugReportCreateSerializer(serializers.Serializer):
    screen_path = serializers.CharField(max_length=255)
    app_version = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    build_sha = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    last_request_ids = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, default=list
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
