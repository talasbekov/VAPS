"""Сериализаторы RBAC раздела ОМ (порт apps/operations/api/serializers.py
из Backend/VAPS; набор полей ответов — дословно).

Сериализаторы ЗАПРОСОВ (AssignRoleRequest/GrantTemporaryDutyRequest) —
добавка переезда: в источнике вьюхи читают request.data[...] напрямую, и
отсутствующее поле даёт KeyError → 500. Здесь недостающее/кривое поле даёт
честный 400 с указанием поля. Идентичность (created_by/actor) в тело запроса
не входит намеренно — она берётся из контракта аутентификации.
"""
from rest_framework import serializers

from organization_management.apps.operations.models import (
    Permission,
    Role,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.validators import DUTY_ROLE_CHOICES


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["code", "name", "description", "is_active"]


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "name", "description", "is_active"]


class UserRoleSerializer(serializers.ModelSerializer):
    role_code = serializers.SlugRelatedField(slug_field="code", read_only=True)

    class Meta:
        model = UserRole
        fields = ["id", "user_id", "role_code", "scope_division_id", "is_active"]


class TemporaryDutySerializer(serializers.ModelSerializer):
    class Meta:
        model = TemporaryDutyPermission
        fields = [
            "id", "user_id", "employee_id", "duty_role_code", "scope_division_id",
            "event_id", "starts_at", "ends_at", "is_active", "created_by",
        ]


class AssignRoleRequestSerializer(serializers.Serializer):
    user_id = serializers.CharField(max_length=100)
    role_code = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), pk_field=serializers.CharField()
    )
    scope_division_id = serializers.IntegerField(required=False, allow_null=True)


class GrantTemporaryDutyRequestSerializer(serializers.Serializer):
    user_id = serializers.CharField(max_length=100)
    duty_role_code = serializers.ChoiceField(choices=DUTY_ROLE_CHOICES)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    employee_id = serializers.IntegerField(required=False, allow_null=True)
    scope_division_id = serializers.IntegerField(required=False, allow_null=True)
    event_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        # Тот же инвариант, что и в TemporaryDutyPermission.clean(), но
        # сработавший ДО записи — иначе ValidationError модели ушёл бы 500-й.
        if attrs["starts_at"] >= attrs["ends_at"]:
            raise serializers.ValidationError(
                {"ends_at": "Окончание должно быть позже начала."}
            )
        return attrs
