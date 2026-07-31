"""Story 14.11a/14.11b/14.11d/14.11e — duty plan/shift API serializers."""

from rest_framework import serializers

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import DutyType, Object as FacilityObject, Post


class DutyPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = DutyPlan
        fields = [
            "id",
            "object",
            "year",
            "month",
            "status_code",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status_code", "created_at", "updated_at"]


class DutyPlanCreateSerializer(serializers.Serializer):
    object = serializers.PrimaryKeyRelatedField(queryset=FacilityObject.objects.all())
    year = serializers.IntegerField()
    month = serializers.IntegerField()


class DutyShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = DutyShift
        fields = [
            "id",
            "plan",
            "employee_id",
            "post",
            "duty_type",
            "duty_role_code",
            "notes",
            "starts_at",
            "ends_at",
            "cancelled_at",
            "cancelled_by",
            "cancelled_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "plan",
            "cancelled_at",
            "cancelled_by",
            "cancelled_reason",
            "created_at",
            "updated_at",
        ]


class DutyShiftCreateSerializer(serializers.Serializer):
    employee_id = serializers.UUIDField()
    post = serializers.PrimaryKeyRelatedField(
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    duty_type = serializers.PrimaryKeyRelatedField(
        queryset=DutyType.objects.all(), required=False, allow_null=True
    )
    duty_role_code = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    notes = serializers.CharField(required=False, allow_blank=True)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()


class DutyShiftCancelSerializer(serializers.Serializer):
    reason = serializers.CharField()


class DutyShiftReplanSerializer(serializers.Serializer):
    """Story 14.11e: partial-update semantics — every field except `reason`
    is optional. An ABSENT field means "inherit the old shift's value"
    (`replan_duty_shift()`'s own contract, 14.9b); an explicit `null` on
    `post`/`duty_type` means "clear it". Empirically confirmed (create-
    story): DRF's `PrimaryKeyRelatedField(required=False, allow_null=True)`
    correctly omits an absent field from `validated_data` while keeping an
    explicit `null` present as `None` — the two cases ARE distinguishable
    through this serializer, not just at the service layer.
    """

    reason = serializers.CharField()
    employee_id = serializers.UUIDField(required=False)
    post = serializers.PrimaryKeyRelatedField(
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    duty_type = serializers.PrimaryKeyRelatedField(
        queryset=DutyType.objects.all(), required=False, allow_null=True
    )
    duty_role_code = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    notes = serializers.CharField(required=False, allow_blank=True)
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False)


class DutyPlanConflictSerializer(serializers.Serializer):
    """Story 14.11f: one entry per detected overlap — plain output-only
    serializer (`validate_duty_plan()` already returns a list of dicts in
    this shape, no model behind it).
    """

    shift_id = serializers.IntegerField()
    employee_id = serializers.UUIDField()
    conflict_code = serializers.CharField()
    severity = serializers.CharField()
    message = serializers.CharField()
