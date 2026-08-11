from rest_framework import serializers
from organization_management.apps.secondments.models import SecondmentRequest


class _EmployeeDetailSerializer(serializers.Serializer):
    """Форма employee_detail, которую ждёт фронт (features/secondment-requests)."""

    id = serializers.IntegerField()
    personnel_number = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    middle_name = serializers.CharField(allow_blank=True, allow_null=True)
    full_name = serializers.SerializerMethodField()
    rank = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()

    def get_full_name(self, obj):
        parts = [obj.last_name, obj.first_name, obj.middle_name]
        return " ".join(p for p in parts if p)

    def get_rank(self, obj):
        return str(obj.rank) if obj.rank_id else None

    def get_photo_url(self, obj):
        return obj.photo.url if obj.photo else None


class _DivisionDetailSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    division_type = serializers.CharField()


class SecondmentRequestSerializer(serializers.ModelSerializer):
    employee_detail = _EmployeeDetailSerializer(source="employee", read_only=True)
    from_division_detail = _DivisionDetailSerializer(source="from_division", read_only=True)
    to_division_detail = _DivisionDetailSerializer(source="to_division", read_only=True)

    class Meta:
        model = SecondmentRequest
        fields = '__all__'
