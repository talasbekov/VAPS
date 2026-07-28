"""Story 5.7c — notifications read API serializers (output projection + filter form)."""

from rest_framework import serializers

from apps.notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    """Read-only projection of a notification — flat, snake_case (FR-13)."""

    class Meta:
        model = Notification
        fields = [
            "id",
            "recipient",
            "kind",
            "business_date",
            "payload",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


class NotificationMarkReadResponseSerializer(serializers.ModelSerializer):
    """Response projection for ``POST /{id}/read/`` (story 11.4a) — deliberately
    NOT ``NotificationSerializer``: that one's whole field list is
    ``read_only_fields`` (a read-API projection), which is the wrong shape to
    claim as "the response of a write". This mirrors only what the write
    actually changed."""

    class Meta:
        model = Notification
        fields = ["id", "read_at"]
        read_only_fields = fields


class NotificationFilterSerializer(serializers.Serializer):
    """Validates the ``since`` query param; a bad datetime → DRF ValidationError
    → 400 VALIDATION_ERROR via the unified handler (no manual Response).

    ``since`` is a tz-aware datetime (DRF makes naive input aware in the project
    timezone when ``USE_TZ``); the selector applies it as ``created_at > since``.
    """

    since = serializers.DateTimeField(required=False)
