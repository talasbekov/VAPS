"""Story 14.11a — duty plan API serializers."""

from rest_framework import serializers

from apps.operations.duties.models import DutyPlan
from apps.operations.facilities.models import Object as FacilityObject


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
