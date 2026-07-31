"""Story 14.11a/14.11b — duty plan/shift API serializers."""

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
