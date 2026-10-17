"""Small HTTP contract for receiver-owned placement."""
import re
from datetime import date, time

from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin, resolve_actor_id
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops import duty_dispatch


class MinuteTimeField(serializers.Field):
    def to_internal_value(self, value):
        if not isinstance(value, str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
            raise serializers.ValidationError("Укажите время ЧЧ:ММ.")
        return time.fromisoformat(value)


class CalendarDateField(serializers.DateField):
    def to_internal_value(self, value):
        day = super().to_internal_value(value)
        if day in (date.min, date.max):
            raise serializers.ValidationError("Дата должна оставлять место для соседнего дня смены.")
        return day


class QuerySerializer(serializers.Serializer):
    business_date = CalendarDateField(required=False)


class ConfigureSerializer(serializers.Serializer):
    department_id = serializers.IntegerField(min_value=1, max_value=2147483647)


class CreateSerializer(serializers.Serializer):
    service_duty_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    employee_id = serializers.IntegerField(min_value=1, max_value=2147483647)
    status_id = serializers.IntegerField(min_value=1, max_value=9223372036854775807)
    business_date = CalendarDateField()
    start_time = MinuteTimeField()
    end_time = MinuteTimeField()
    placement = serializers.JSONField()


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=False, max_length=2000)


class DutyDispatchViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": ("duty.dispatch", "admin.roles"), "create": "duty.dispatch", "configure": "admin.roles", "cancel": "duty.dispatch"}

    def list(self, request):
        query = QuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return Response(duty_dispatch.workspace(resolve_actor_id(request), query.validated_data.get("business_date", Clock.today_local())))

    def create(self, request):
        body = CreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_dispatch.create_assignment(resolve_actor_id(request), **body.validated_data), status=201)

    @action(detail=False, methods=["post"])
    def configure(self, request):
        body = ConfigureSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_dispatch.configure_receiver(resolve_actor_id(request), **body.validated_data))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        key = serializers.IntegerField(min_value=1, max_value=9223372036854775807).run_validation(pk)
        body = CancelSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_dispatch.cancel_assignment(resolve_actor_id(request), key, **body.validated_data))
