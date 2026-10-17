"""Scoped administrative journal and explicit execution actions."""
from datetime import date, timedelta

from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin, resolve_actor_id
from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.ops import duty_log, duty_register, duty_roster
from organization_management.apps.ops.duty_record_access import REGISTER_PERMISSIONS, WRITE_PERMISSIONS, MAX_IDENTIFIER
from organization_management.apps.ops.duty_register_query import ATTENTION_CODES


class BusinessDateTimeField(serializers.DateTimeField):
    def default_timezone(self):
        return _local_tz()


class CreateLogSerializer(serializers.Serializer):
    employee_id = serializers.IntegerField(min_value=1, max_value=MAX_IDENTIFIER)
    service_duty_code = serializers.CharField(max_length=100)
    planned_start = BusinessDateTimeField()
    planned_end = BusinessDateTimeField()
    location_label = serializers.CharField(max_length=500, allow_blank=True, default="")
    document_basis = serializers.CharField(max_length=500, allow_blank=True, default="")
    note = serializers.CharField(max_length=10000, allow_blank=True, default="")
    client_request_id = serializers.UUIDField(required=False)


class ChoiceQuerySerializer(serializers.Serializer):
    search = serializers.CharField(max_length=200, allow_blank=True, default="")
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=25)


class RegisterQuerySerializer(ChoiceQuerySerializer):
    kind = serializers.CharField(max_length=100, allow_blank=True, default="")
    state = serializers.ChoiceField(choices=tuple(duty_register.STATE_LABELS) + ("",), default="")
    source = serializers.ChoiceField(choices=tuple(duty_register.SOURCE_LABELS) + ("",), default="")
    attention = serializers.ChoiceField(choices=ATTENTION_CODES + ("ANY", ""), default="")
    employee_id = serializers.IntegerField(min_value=1, max_value=MAX_IDENTIFIER, required=False)
    division_id = serializers.IntegerField(min_value=1, max_value=MAX_IDENTIFIER, required=False)

    def get_fields(self):
        fields = super().get_fields()
        fields["from"] = serializers.DateField(required=False)
        fields["to"] = serializers.DateField(required=False)
        return fields

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError("Неизвестный фильтр журнала.")
        if ("from" in attrs) != ("to" in attrs):
            raise serializers.ValidationError("Укажите обе границы периода.")
        attrs.setdefault("to", Clock.today_local())
        attrs.setdefault("from", attrs["to"] - timedelta(days=29))
        if attrs["to"] == date.max or attrs["from"] > attrs["to"] or (attrs["to"] - attrs["from"]).days >= 366:
            raise serializers.ValidationError("Выберите период от 1 до 366 дней с допустимой конечной датой.")
        return attrs


class ExecutionSerializer(serializers.Serializer):
    at = BusinessDateTimeField(required=False)


class RosterQuerySerializer(serializers.Serializer):
    business_date = serializers.DateField(required=False)
    division_id = serializers.IntegerField(min_value=1, max_value=MAX_IDENTIFIER, required=False)

    def validate(self, attrs):
        day = attrs.setdefault("business_date", Clock.today_local())
        if day in (date.min, date.max):
            raise serializers.ValidationError({"business_date": "Дата должна оставлять место для соседнего дня смены."})
        return attrs


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000, allow_blank=False)


class ClassificationSerializer(ReasonSerializer):
    service_duty_code = serializers.CharField(max_length=100)


class UpdateLogSerializer(ReasonSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    planned_start = BusinessDateTimeField(required=False)
    planned_end = BusinessDateTimeField(required=False)
    location_label = serializers.CharField(max_length=500, allow_blank=True, required=False)
    document_basis = serializers.CharField(max_length=500, allow_blank=True, required=False)
    note = serializers.CharField(max_length=10000, allow_blank=True, required=False)


class DutyRegisterViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {
        "list": REGISTER_PERMISSIONS, "export": REGISTER_PERMISSIONS, "roster": REGISTER_PERMISSIONS,
        "retrieve": REGISTER_PERMISSIONS, "create": WRITE_PERMISSIONS,
        "partial_update": WRITE_PERMISSIONS,
        "kinds": REGISTER_PERMISSIONS, "choices": WRITE_PERMISSIONS,
        "creation_result": REGISTER_PERMISSIONS,
        "close_creation": REGISTER_PERMISSIONS,
        "acknowledge": WRITE_PERMISSIONS + ("duty.dispatch",),
        "start": WRITE_PERMISSIONS + ("duty.dispatch",),
        "complete": WRITE_PERMISSIONS + ("duty.dispatch",),
        "cancel": WRITE_PERMISSIONS + ("duty.dispatch",),
        "classify": WRITE_PERMISSIONS + ("duty.dispatch",),
    }

    def _query(self, request):
        query = RegisterQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return query.validated_data

    def list(self, request):
        return Response(duty_register.snapshot(resolve_actor_id(request), self._query(request)))

    @action(detail=False, methods=["get"])
    def roster(self, request):
        query = RosterQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        data = query.validated_data
        return Response(duty_roster.snapshot(resolve_actor_id(request), data["business_date"], division_id=data.get("division_id")))

    @action(detail=False, methods=["get"])
    def export(self, request):
        return duty_register.export_csv(resolve_actor_id(request), self._query(request))

    def create(self, request):
        body = CreateLogSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row, created = duty_log.create_record(resolve_actor_id(request), body.validated_data)
        return Response(row, status=201 if created else 200)

    @action(detail=False, methods=["get"], url_path=r"requests/(?P<request_id>[0-9a-fA-F-]{36})")
    def creation_result(self, request, request_id=None):
        nonce = serializers.UUIDField().run_validation(request_id)
        return Response(duty_log.creation_result(resolve_actor_id(request), nonce))

    @action(detail=False, methods=["post"], url_path=r"requests/(?P<request_id>[0-9a-fA-F-]{36})/close")
    def close_creation(self, request, request_id=None):
        nonce = serializers.UUIDField().run_validation(request_id)
        return Response(duty_log.close_creation(resolve_actor_id(request), nonce))

    def retrieve(self, request, pk=None):
        return Response(duty_log.record_detail(resolve_actor_id(request), pk))

    def partial_update(self, request, pk=None):
        body = UpdateLogSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_log.update_record(resolve_actor_id(request), pk, body.validated_data))

    @action(detail=False, methods=["get"])
    def kinds(self, request):
        return Response(duty_log.kinds())

    @action(detail=False, methods=["get"])
    def choices(self, request):
        query = ChoiceQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        return Response(duty_log.choices(resolve_actor_id(request), **query.validated_data))

    def _execution(self, request, pk, operation):
        body = ExecutionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_log.mark_execution(resolve_actor_id(request), pk, operation, **body.validated_data))

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        return self._execution(request, pk, "acknowledge")

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._execution(request, pk, "start")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._execution(request, pk, "complete")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        body = ReasonSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_log.cancel_record(resolve_actor_id(request), pk, body.validated_data["reason"]))

    @action(detail=True, methods=["post"])
    def classify(self, request, pk=None):
        body = ClassificationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(duty_log.classify_record(resolve_actor_id(request), pk,
            body.validated_data["service_duty_code"], body.validated_data["reason"]))
