"""Story 20.3b — query form for GET /load/summary/."""

from decimal import Decimal

from rest_framework import serializers


class OverloadSummaryFilterSerializer(serializers.Serializer):
    """GET /summary/ query form — one division, inclusive date range, and an
    optional threshold (mirrors compute_overload_summary()'s own default)."""

    division_id = serializers.UUIDField()
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    # min_value guards against a non-positive threshold: detect_overload_days
    # selects days where hours >= threshold_hours, so 0/negative would flag
    # every day with any recorded activity as "overloaded" (review finding,
    # Blind Hunter + Edge Case Hunter independently).
    threshold_hours = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        default=Decimal("8"),
        min_value=Decimal("0.01"),
    )
