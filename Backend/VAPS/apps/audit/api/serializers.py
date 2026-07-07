"""Story 4.5 — audit read API serializers (output projection + filter form)."""

from rest_framework import serializers

from apps.audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Read-only projection of an audit row — FR-36 fields, snake_case, flat."""

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_user_id",
            "action",
            "entity_type",
            "entity_id",
            "old_value",
            "new_value",
            "reason",
            "request_id",
            "ip_address",
            "user_agent",
            "created_at",
        ]
        read_only_fields = fields


class AuditLogFilterSerializer(serializers.Serializer):
    """Validates query-string filters; a bad UUID/datetime → DRF ValidationError
    → 400 VALIDATION_ERROR via the unified handler (no manual Response).

    ``entity_id`` is a UUID (the employee UUID — реш. 4.4 №1, NOT the integer
    row PK, which lives in ``new_value``). ``actor`` maps to ``actor_user_id``
    (a string, ARCH-007). ``created_from``/``created_to`` are tz-aware datetimes
    (DRF makes naive input aware in the project timezone when ``USE_TZ``).
    """

    entity_type = serializers.CharField(required=False)
    entity_id = serializers.UUIDField(required=False)
    actor = serializers.CharField(required=False)
    action = serializers.CharField(required=False)
    created_from = serializers.DateTimeField(required=False)
    created_to = serializers.DateTimeField(required=False)
