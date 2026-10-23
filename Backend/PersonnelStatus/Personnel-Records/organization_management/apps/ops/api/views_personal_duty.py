from rest_framework import serializers, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.ops import personal_duty
from organization_management.apps.operations.clock import Clock, _local_tz


class AcknowledgementSerializer(serializers.Serializer):
    token = serializers.RegexField(r"^[0-9a-f]{64}$", trim_whitespace=False)


class PersonalDutyViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def list(self, request):
        if request.query_params:
            raise serializers.ValidationError("Личные выходы определяются только по учётной записи; параметры не поддерживаются.")
        response = Response(personal_duty.snapshot(resolve_actor_id(request)))
        response["Cache-Control"] = "private, no-store"
        return response

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        if request.query_params or not isinstance(request.data, dict) or set(request.data) != {"token"}:
            raise serializers.ValidationError("Передайте только токен просмотренного назначения; время и поля назначения не принимаются.")
        body = AcknowledgementSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = personal_duty.acknowledge(resolve_actor_id(request), pk, **body.validated_data)
        response = Response({"record": row, "generated_at": Clock.to_local(Clock.now()).isoformat(), "time_zone": str(_local_tz())})
        response["Cache-Control"] = "private, no-store"
        return response
