"""Versioned Digital Twin read boundary with a separate global permission."""
import re
from datetime import date

from django.urls import path
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin, require_global_permission
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops import digital_twin


class StrictBusinessDateField(serializers.DateField):
    def to_internal_value(self, value):
        if not isinstance(value, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
            self.fail("invalid", format="YYYY-MM-DD")
        return super().to_internal_value(value)


class SnapshotQuerySerializer(serializers.Serializer):
    date = StrictBusinessDateField(default=Clock.today_local)

    def validate(self, attrs):
        if set(self.initial_data) - {"date"}:
            raise serializers.ValidationError("Unknown snapshot query parameter.")
        # HTML QueryDict handling can replace an explicit blank with the
        # default before the date field's converter receives the value.
        if self.initial_data.get("date") == "":
            raise serializers.ValidationError({"date": "Use YYYY-MM-DD."})
        if hasattr(self.initial_data, "getlist") and len(self.initial_data.getlist("date")) > 1:
            raise serializers.ValidationError({"date": "Specify one business date."})
        if attrs["date"] in (date.min, date.max):
            raise serializers.ValidationError({"date": "The business date must allow adjacent shift days."})
        return attrs


class PointSerializer(serializers.Serializer):
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)


class CatalogPostSerializer(serializers.Serializer):
    id = serializers.CharField()
    source = serializers.ChoiceField(choices=("PASSPORT",))
    sector_id = serializers.CharField()
    sector_name = serializers.CharField()
    name = serializers.CharField()
    need = serializers.IntegerField(min_value=0, allow_null=True)
    location = PointSerializer(allow_null=True)


class CatalogObjectSerializer(serializers.Serializer):
    id = serializers.CharField()
    code = serializers.CharField()
    name = serializers.CharField()
    object_type = serializers.CharField()
    region = serializers.CharField()
    address = serializers.CharField()
    state = serializers.ChoiceField(choices=("ACTIVE", "ARCHIVED"))
    ownership = serializers.ChoiceField(choices=("OWN", "GUARDED"))
    location = PointSerializer(allow_null=True)
    posts = CatalogPostSerializer(many=True)


class EventPostSerializer(serializers.Serializer):
    id = serializers.CharField(allow_null=True)
    source = serializers.ChoiceField(choices=("EVENT",))
    passport_post_id = serializers.CharField(allow_null=True)
    name = serializers.CharField()
    sector_name = serializers.CharField(allow_null=True)
    need = serializers.IntegerField(min_value=0, allow_null=True)
    assigned = serializers.IntegerField(min_value=0)
    location = PointSerializer(allow_null=True)
    outdoor = serializers.BooleanField(allow_null=True)


class EventVisitSerializer(serializers.Serializer):
    id = serializers.CharField()
    object_id = serializers.CharField(allow_null=True)
    object_name = serializers.CharField()
    visit_date = serializers.DateField(allow_null=True)
    stage = serializers.CharField(help_text="Latest stored stage; not a reconstruction of stage on the selected date.")
    placement_need = serializers.IntegerField(min_value=0, allow_null=True)
    placement_assigned = serializers.IntegerField(min_value=0, allow_null=True)
    location = PointSerializer(allow_null=True)
    posts = EventPostSerializer(many=True)


class EventSerializer(serializers.Serializer):
    id = serializers.CharField()
    code = serializers.CharField()
    title = serializers.CharField()
    business_date = serializers.DateField()
    business_date_end = serializers.DateField(allow_null=True)
    stage = serializers.CharField(help_text="Latest stored event stage, including CLOSED.")
    visits = EventVisitSerializer(many=True)
    unresolved_posts = EventPostSerializer(many=True, help_text="Saved event posts not represented under any current visit; no visit owner is inferred.")


class DutyPostCountSerializer(serializers.Serializer):
    post_id = serializers.CharField()
    post_name = serializers.CharField(allow_null=True)
    headcount = serializers.IntegerField(min_value=0)


class DutyGroupCountSerializer(serializers.Serializer):
    group_id = serializers.CharField()
    group_name = serializers.CharField(allow_null=True)
    headcount = serializers.IntegerField(min_value=0)


class DutyObjectCountSerializer(serializers.Serializer):
    object_id = serializers.CharField()
    object_name = serializers.CharField(allow_null=True)
    headcount = serializers.IntegerField(min_value=0)
    posts = DutyPostCountSerializer(many=True)
    groups = DutyGroupCountSerializer(many=True)


class DutyHeadcountsSerializer(serializers.Serializer):
    count_basis = serializers.ChoiceField(choices=("UNIQUE_PEOPLE_ASSIGNED_DURING_BUSINESS_DATE",))
    allocated_headcount = serializers.IntegerField(min_value=0)
    placed_headcount = serializers.IntegerField(min_value=0)
    unplaced_headcount = serializers.IntegerField(min_value=0)
    objects = DutyObjectCountSerializer(many=True)


class DigitalTwinSnapshotSerializer(serializers.Serializer):
    schema_version = serializers.CharField()
    business_date = serializers.DateField()
    generated_at = serializers.DateTimeField()
    time_zone = serializers.CharField()
    objects = CatalogObjectSerializer(many=True)
    events = EventSerializer(many=True)
    duty = DutyHeadcountsSerializer()


class DigitalTwinSnapshotViewSet(RequirePermissionMixin, viewsets.ViewSet):
    http_method_names = ["get", "head", "options"]
    permission_map = {"snapshot": "digital_twin.read"}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method.lower() in self.http_method_names:
            # Scope-bearing grants cannot read a global, aggregate snapshot.
            # This runs before query validation, ORM reads and map access.
            require_global_permission(request, "digital_twin.read")

    @extend_schema(
        operation_id="digital_twin_v1_snapshot",
        tags=["Digital Twin"],
        summary="Read non-personal object, event and daily duty counts",
        description=(
            "Requires an unscoped digital_twin.read grant or unscoped wildcard. "
            "Uses existing JWT authentication. Catalog passports are current; "
            "events overlap the selected date and expose their latest stored stages. "
            "Duty counts are unique people assigned during the business date, "
            "not live occupancy. Event placement and personnel duty are separate sources. "
            "A missing map has null coordinates; unavailable map storage returns 503."
        ),
        parameters=[OpenApiParameter(
            name="date", type=OpenApiTypes.DATE, location=OpenApiParameter.QUERY,
            description="Strict YYYY-MM-DD business date; defaults to the Service business clock. Boundary dates 0001-01-01 and 9999-12-31 are unsupported.",
        )],
        responses={200: DigitalTwinSnapshotSerializer, 400: OpenApiTypes.OBJECT,
                   401: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 503: OpenApiTypes.OBJECT},
    )
    def snapshot(self, request):
        query = SnapshotQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        body = digital_twin.snapshot(query.validated_data["date"])
        return Response(DigitalTwinSnapshotSerializer(body).data)


urlpatterns = [path("snapshot/", DigitalTwinSnapshotViewSet.as_view({"get": "snapshot"}), name="digital-twin-v1-snapshot")]
