"""Story 15.4 — ObjectPassport update API serializers."""

from rest_framework import serializers

from apps.operations.facilities.models import ObjectPassport


class ObjectPassportSerializer(serializers.ModelSerializer):
    class Meta:
        model = ObjectPassport
        fields = [
            "id",
            "object",
            "object_type",
            "responsible_user_id",
            "responsible_employee_id",
            "description",
            "security_notes",
            "vulnerable_places",
            "access_routes",
            "entrances",
            "exits",
            "service_entrances",
            "parking_zones",
            "dropoff_zones",
            "elevators",
            "stairs",
            "roofs",
            "basements",
            "technical_rooms",
            "cameras",
            "power_supply",
            "ventilation",
            "communication",
            "internet",
            "nearby_high_buildings",
            "public_zones",
            "crowd_places",
            "repair_works",
            "completeness_status",
            "last_verified_at",
            "last_verified_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "object",
            "last_verified_at",
            "last_verified_by",
            "created_at",
            "updated_at",
        ]


class ObjectPassportUpdateSerializer(serializers.ModelSerializer):
    """Partial-update body — every model field here has `blank=True`, so
    DRF already derives `required=False` for all of them (AC-3:
    непереданные поля не затираются — `is_valid()` never demands them).
    `object`/`last_verified_*` excluded — server-assigned, not client
    input."""

    class Meta:
        model = ObjectPassport
        fields = [
            "object_type",
            "responsible_user_id",
            "responsible_employee_id",
            "description",
            "security_notes",
            "vulnerable_places",
            "access_routes",
            "entrances",
            "exits",
            "service_entrances",
            "parking_zones",
            "dropoff_zones",
            "elevators",
            "stairs",
            "roofs",
            "basements",
            "technical_rooms",
            "cameras",
            "power_supply",
            "ventilation",
            "communication",
            "internet",
            "nearby_high_buildings",
            "public_zones",
            "crowd_places",
            "repair_works",
            "completeness_status",
        ]
