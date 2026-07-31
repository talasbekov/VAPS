"""Story 15.2a/15.3b — SecurityEvent create/list + recon-capture API
serializers."""

from rest_framework import serializers

from apps.operations.events.models import (
    Group,
    GroupForceRequest,
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
    SecurityEventStaffingDemand,
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
            # Story 15.3c review (Blind Hunter): without these, a client
            # polling between the first and second recon/confirm call has
            # no way to see a confirmation is pending except the 202/200
            # status code of its own last call — exposed read-only so a
            # second confirmer's UI can show "awaiting your confirmation".
            "recon_first_confirmed_by",
            "recon_first_confirmed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status_code",
            "recon_first_confirmed_by",
            "recon_first_confirmed_at",
            "created_at",
            "updated_at",
        ]


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


class StaffingDemandSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventStaffingDemand
        fields = [
            "id",
            "sector",
            "task",
            "shift",
            "need",
            "group",
            "requirements",
            "comment",
        ]
        read_only_fields = ["id"]


class GroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ["code", "name", "sort_order"]


class GroupForceRequestSerializer(serializers.ModelSerializer):
    group = GroupSerializer(read_only=True)

    class Meta:
        model = GroupForceRequest
        fields = [
            "id",
            "group",
            "requested_count",
            "allocated_count",
            "status",
            "comment",
        ]
        read_only_fields = fields


class AllocateForceRequestSerializer(serializers.Serializer):
    """Story 15.8: broker's allocation body — quantitative only, matches
    the frontend prototype's `UpdateForceAllocationRequest` shape (soft
    signal, not source of truth)."""

    allocated_count = serializers.IntegerField(min_value=0)
    comment = serializers.CharField(required=False, allow_blank=True)


class GenerateForceRequestsResponseSerializer(serializers.Serializer):
    """Story 15.7b: wraps the generated/updated rows plus any StaffingDemand
    group-text that failed to match an active Group (AC-2 — reported, not
    silently dropped), and any PRIOR `GroupForceRequest` whose group no
    longer appears in the current demand (review, Edge Case Hunter —
    reported for visibility, not auto-cancelled)."""

    force_requests = GroupForceRequestSerializer(many=True)
    unmatched_groups = serializers.ListField(child=serializers.CharField())
    stale_groups = serializers.ListField(child=serializers.CharField())
