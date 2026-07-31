"""Story 15.2a/15.3b — SecurityEvent create/list + recon-capture API
serializers."""

from rest_framework import serializers

from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
)
from apps.operations.facilities.models import Object as FacilityObject


class SecurityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEvent
        fields = [
            "id",
            "object",
            "title",
            "status_code",
            "senior_employee_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status_code", "created_at", "updated_at"]


class SecurityEventCreateSerializer(serializers.Serializer):
    object = serializers.PrimaryKeyRelatedField(queryset=FacilityObject.objects.all())
    title = serializers.CharField(max_length=255)
    senior_employee_id = serializers.UUIDField(required=False, allow_null=True)


class ChecklistItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventChecklistItem
        fields = ["id", "label", "done", "result", "comment"]
        read_only_fields = ["id"]


class SectorPostSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventSectorPost
        fields = [
            "id",
            "sector",
            "post",
            "task",
            "need",
            "requirements",
            "result",
            "comment",
        ]
        read_only_fields = ["id"]
