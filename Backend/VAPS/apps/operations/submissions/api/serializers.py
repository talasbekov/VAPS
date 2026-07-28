"""Stories 5.8a/b/c — daily-submissions API serializers (forms + projections).

Story 6.10a adds the расход HTTP forms/projections (issue + by-date + period).
"""

from rest_framework import serializers

from apps.documents.models import IssuedDocument
from apps.operations.submissions.models import DailySubmission


class DailySubmissionCreateSerializer(serializers.Serializer):
    """POST-body form — exactly the two kwargs the API forwards to submit_day:
    a flat UUID division ref (ARCH-003) and a YYYY-MM-DD business date (closes
    the business_date=None defer class for the submit path). The actor NEVER
    comes from the payload (ARCH-SEC-030) — extra fields, including
    submitted_by, are ignored.
    """

    division_id = serializers.UUIDField()
    business_date = serializers.DateField()


class DailySubmissionAmendSerializer(serializers.Serializer):
    """POST /{id}/amend/ form (5.8b) — exactly the reason/sanction pair the
    API forwards to amend_day. DRF defaults (required + trim_whitespace +
    allow_blank=False) reject missing/blank/whitespace-only values at the
    boundary; ``sanction`` carries the model's CharField(255) limit — without
    it an oversized value would reach Postgres as a DataError → 500 (the same
    boundary-lets-garbage-through class as 5.8a's whitespace actor header).
    ``triggered_by_status_id`` is NOT accepted: it is the 5.4b system hook's
    provenance ref (manual HTTP amendment stores None); accepting it would let
    a client write arbitrary EmployeeStatus references. Extra payload fields,
    including submitted_by/actor, are ignored (ARCH-SEC-030, DRF-канон 5.8a Д5).
    """

    reason = serializers.CharField()  # model TextField — deliberately unbounded
    sanction = serializers.CharField(max_length=255)  # model CharField(255)


class DailySubmissionFilterSerializer(serializers.Serializer):
    """GET list query-param form (5.8c) — optional equality filters, mirror of
    AuditLogFilterSerializer: garbage values die here as 400 VALIDATION_ERROR
    instead of leaking into the ORM (the boundary-lets-garbage-through class).
    """

    division_id = serializers.UUIDField(required=False)
    business_date = serializers.DateField(required=False)


class DailySubmissionSerializer(serializers.ModelSerializer):
    """201/list projection — flat, snake_case, WITHOUT the heavy snapshot JSON
    (tens–hundreds of KB per row) and without the amend-only fields
    (reason/sanction/triggered_by_status_id — always empty on v1). The list
    selector defers snapshot; this serializer never touching it keeps the
    deferred column from being silently re-fetched.
    """

    class Meta:
        model = DailySubmission
        fields = [
            "id",
            "division_id",
            "business_date",
            "version",
            "is_current",
            "event",
            "submitted_by",
            "submitted_at",
            "late",
        ]
        read_only_fields = fields


class DailySubmissionDetailSerializer(serializers.ModelSerializer):
    """GET /{id}/ projection (5.8c, Д1) — the nine list fields plus the heavy
    and amend-only payload. Detail is the ONLY HTTP channel for the snapshot
    (расход screens 10.5/10.6, parallel-run reconciliation); reason/sanction
    are empty strings and triggered_by_status_id is None on non-amended rows.
    """

    class Meta:
        model = DailySubmission
        fields = DailySubmissionSerializer.Meta.fields + [
            "snapshot",
            "reason",
            "sanction",
            "triggered_by_status_id",
        ]
        read_only_fields = fields


class ExpenseReportIssueSerializer(serializers.Serializer):
    """POST-body form (6.10a) — the two kwargs forwarded to
    ``issue_expense_document``: a flat UUID division ref (ARCH-003) and a
    YYYY-MM-DD business date. The actor NEVER comes from the payload
    (ARCH-SEC-030); extra fields are ignored."""

    division_id = serializers.UUIDField()
    business_date = serializers.DateField()


class ExpenseReportByDateFilterSerializer(serializers.Serializer):
    """GET-by-date query form (6.10a) — both required for a point lookup of the
    current issued расход. Garbage dies here as 400, not in the ORM."""

    division_id = serializers.UUIDField()
    business_date = serializers.DateField()


class ExpensePeriodFilterSerializer(serializers.Serializer):
    """GET /period/ query form (6.10a) — division + inclusive date range for the
    read-only page-per-date расход (range/length validated in the service)."""

    division_id = serializers.UUIDField()
    date_from = serializers.DateField()
    date_to = serializers.DateField()


class TrafficLightTreeFilterSerializer(serializers.Serializer):
    """GET query form (10.3a) — оба параметра НЕОБЯЗАТЕЛЬНЫ: корень дефолтится
    в скоуп актора (``visible_division_ids``), дата — в ``Clock.today_local()``.

    Граница ловит мусор как 400 VALIDATION_ERROR: не-UUID корень (иначе сырой
    ``ValueError`` из ``uuid.UUID`` внутри сервиса — дефер 5.5b) и не-ISO дату.
    Параметра глубины нет: каскад отдаёт поддерево целиком.
    """

    root_division_id = serializers.UUIDField(required=False)
    business_date = serializers.DateField(required=False)


class TrafficLightDivisionFilterSerializer(serializers.Serializer):
    """GET query form (10.3c) — ``division_id`` ОБЯЗАТЕЛЕН (в отличие от
    ``tree``'s ``root_division_id``): точечный запрос ОДНОГО листа, «весь
    видимый скоуп» здесь не имеет смысла. ``business_date`` опционален —
    дефолт ``Clock.today_local()`` во вьюхе, как у ``tree``."""

    division_id = serializers.UUIDField()
    business_date = serializers.DateField(required=False)


class TomorrowBlockOverrideSerializer(serializers.Serializer):
    """POST-body form (6.10b) — the date whose «на завтра» block is legally
    lifted and the mandatory reason. DRF defaults reject a missing/blank reason
    at the boundary (400); the actor never comes from the payload."""

    business_date = serializers.DateField()
    reason = serializers.CharField()


class IssuedExpenseReportSerializer(serializers.ModelSerializer):
    """Issued расход projection (6.10a) — flat metadata + the attachment ref and
    sha256 for download via 6.7 (X-Accel). The byte file is NOT streamed here."""

    attachment_id = serializers.UUIDField(read_only=True)
    sha256 = serializers.CharField(source="attachment.sha256", read_only=True)

    class Meta:
        model = IssuedDocument
        fields = [
            "id",
            "doc_type",
            "number",
            "year",
            "business_date",
            "division_id",
            "submission_id",
            "submission_version",
            "status",
            "attachment_id",
            "sha256",
        ]
        read_only_fields = fields
