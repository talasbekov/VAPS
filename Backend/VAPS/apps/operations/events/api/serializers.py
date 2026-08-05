"""Story 15.2a/15.3b — SecurityEvent create/list + recon-capture API
serializers."""

from rest_framework import serializers

from apps.operations.events.models import (
    AssignmentVersion,
    Group,
    GroupForceRequest,
    JournalEntry,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventClosureSummary,
    SecurityEventDirectAssignment,
    SecurityEventSectorPost,
    SecurityEventStaffingDemand,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post


class SecurityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEvent
        fields = [
            "id",
            "object",
            "title",
            "status_code",
            "senior_employee_id",
            # Story 15.3c review (Blind Hunter): without these, a client
            # polling between the first and second recon/confirm call has
            # no way to see a confirmation is pending except the 202/200
            # status code of its own last call — exposed read-only so a
            # second confirmer's UI can show "awaiting your confirmation".
            "recon_first_confirmed_by",
            "recon_first_confirmed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status_code",
            "recon_first_confirmed_by",
            "recon_first_confirmed_at",
            "created_at",
            "updated_at",
        ]


class SecurityEventCreateSerializer(serializers.Serializer):
    object = serializers.PrimaryKeyRelatedField(queryset=FacilityObject.objects.all())
    title = serializers.CharField(max_length=255)
    senior_employee_id = serializers.UUIDField(required=False, allow_null=True)


class ChecklistItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventChecklistItem
        fields = ["id", "label", "done", "result", "comment"]
        read_only_fields = ["id"]


class SectorPostSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventSectorPost
        fields = [
            "id",
            "sector",
            "post",
            "task",
            "need",
            "requirements",
            "result",
            "comment",
        ]
        read_only_fields = ["id"]


class StaffingDemandSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventStaffingDemand
        fields = [
            "id",
            "sector",
            "task",
            "shift",
            "need",
            "group",
            "requirements",
            "comment",
        ]
        read_only_fields = ["id"]


class GroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ["code", "name", "sort_order"]


class GroupForceRequestSerializer(serializers.ModelSerializer):
    group = GroupSerializer(read_only=True)

    class Meta:
        model = GroupForceRequest
        fields = [
            "id",
            "group",
            "requested_count",
            "allocated_count",
            "status",
            "comment",
        ]
        read_only_fields = fields


class AllocateForceRequestSerializer(serializers.Serializer):
    """Story 15.8: broker's allocation body — quantitative only, matches
    the frontend prototype's `UpdateForceAllocationRequest` shape (soft
    signal, not source of truth)."""

    allocated_count = serializers.IntegerField(min_value=0)
    comment = serializers.CharField(required=False, allow_blank=True)


class GenerateForceRequestsResponseSerializer(serializers.Serializer):
    """Story 15.7b: wraps the generated/updated rows plus any StaffingDemand
    group-text that failed to match an active Group (AC-2 — reported, not
    silently dropped), and any PRIOR `GroupForceRequest` whose group no
    longer appears in the current demand (review, Edge Case Hunter —
    reported for visibility, not auto-cancelled)."""

    force_requests = GroupForceRequestSerializer(many=True)
    unmatched_groups = serializers.ListField(child=serializers.CharField())
    stale_groups = serializers.ListField(child=serializers.CharField())


class DirectAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityEventDirectAssignment
        fields = ["id", "sector_post", "employee_id", "comment", "created_at"]
        read_only_fields = ["id", "created_at"]


class PlacementAssignmentSerializer(serializers.ModelSerializer):
    """Story 16.8a: read-only — persisted conflict/acknowledgement state,
    not recomputed on GET (same convention the rest of this read-API
    already follows)."""

    class Meta:
        model = PlacementAssignment
        fields = [
            "id",
            "employee_id",
            "post",
            "conflict_severity",
            "conflict_codes",
            "acknowledged_at",
            "ack_escalated_at",
        ]
        read_only_fields = fields


class AssignmentVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssignmentVersion
        fields = [
            "id",
            "event",
            "status",
            "version",
            "is_current",
            "signature_hash",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AssignmentVersionDetailSerializer(AssignmentVersionSerializer):
    assignments = PlacementAssignmentSerializer(many=True, read_only=True)

    class Meta(AssignmentVersionSerializer.Meta):
        fields = AssignmentVersionSerializer.Meta.fields + ["assignments"]
        read_only_fields = fields


class ReturnVersionSerializer(serializers.Serializer):
    """Story 16.8c: write-only request body for `POST .../return` —
    `return_assignment_version()` (16.4) already requires a non-blank
    `reason`; this validates presence BEFORE the service call (same
    is_valid(raise_exception=True) idiom as DirectAssignmentSerializer),
    not a duplicate of the service's own blank-check."""

    reason = serializers.CharField()


class ApproveVersionSerializer(serializers.Serializer):
    """Story 16.8d: optional request body for `POST .../approve` —
    literal copy of `apps.operations.statuses.api.serializers.
    BulkStatusCreateSerializer`'s `override`/`override_reason` fields
    (10.2a). No `default=` deliberately (same rationale as that
    serializer): openapi-typescript treats a `default=`'d field as
    always-present in the generated TS type, `required=False` reads as
    optional — matches the field actually being optional here."""

    override = serializers.BooleanField(required=False)
    override_reason = serializers.CharField(required=False, allow_blank=True)


class AmendAssignmentSpecSerializer(serializers.Serializer):
    """Story 17.7b: one row of `amend_assignment_version()`'s `assignments`
    list — mirrors the service's own dict-spec shape (17.4) exactly. Not a
    ModelSerializer: `PlacementAssignment` rows don't exist yet at request
    time, this is the client's PROPOSED full new composition."""

    employee_id = serializers.UUIDField()
    post = serializers.PrimaryKeyRelatedField(queryset=Post.objects.all())
    is_unplanned = serializers.BooleanField(required=False, default=False)
    source_division_id = serializers.UUIDField(required=False, allow_null=True)
    source_duty_shift_id = serializers.IntegerField(required=False, allow_null=True)


class AmendAssignmentVersionRequestSerializer(serializers.Serializer):
    """Story 17.7b: request body for `POST .../amend/` — thin pass-through
    to `amend_assignment_version()` (17.3); per-spec validation (post
    object-match, is_unplanned/source pairing) stays in the service, not
    duplicated here."""

    reason = serializers.CharField()
    sanction = serializers.CharField()
    assignments = AmendAssignmentSpecSerializer(many=True)


class ReplaceDepartedRequestSerializer(serializers.Serializer):
    """Story 17.7b: request body for `POST .../replace-departed/` — thin
    pass-through to `cascade_replace_departed()` (17.5)."""

    departed_employee_id = serializers.UUIDField()
    reason = serializers.CharField()
    sanction = serializers.CharField()
    manual_replacement_employee_id = serializers.UUIDField(
        required=False, allow_null=True
    )


class AssignmentVersionReturnResponseSerializer(AssignmentVersionDetailSerializer):
    """Story 16.8c: `AssignmentVersionDetailSerializer` (the returned/old
    version) plus `new_draft_version` — the actual response shape returned
    by `AssignmentVersionViewSet.return_`. Exists only so `@extend_schema`
    documents the injected `new_draft_version` key instead of silently
    omitting it (schema.yaml previously understated the real response)."""

    new_draft_version = AssignmentVersionSerializer(read_only=True)

    class Meta(AssignmentVersionDetailSerializer.Meta):
        fields = AssignmentVersionDetailSerializer.Meta.fields + ["new_draft_version"]
        read_only_fields = fields


class JournalEntrySerializer(serializers.ModelSerializer):
    """Story 17.7a: response shape for журнал штаба (17.1/17.2) rows —
    read-only, all fields, same convention as `PlacementAssignmentSerializer`
    (persisted state, not recomputed on GET)."""

    class Meta:
        model = JournalEntry
        fields = [
            "id",
            "event",
            "entry_type",
            "text",
            "post",
            "participant_ids",
            "photo_attachment_id",
            "created_by",
            "created_at",
        ]
        read_only_fields = fields


class JournalEntryCreateSerializer(serializers.Serializer):
    """Story 17.7a: write-only request body for `POST .../journal-entries/`
    — thin field-mapping over `create_journal_entry()` (17.1/17.2); the
    service itself owns all business validation (entry_type/post/actor/
    text guards, IN_PROGRESS lifecycle) — this serializer validates only
    field PRESENCE/TYPE, same division of labor as `ReturnVersionSerializer`
    (16.8c)."""

    entry_type = serializers.ChoiceField(choices=JournalEntry.EntryType.choices)
    text = serializers.CharField()
    post = serializers.PrimaryKeyRelatedField(
        queryset=Post.objects.all(), required=False, allow_null=True
    )
    participant_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False
    )
    photo_attachment_id = serializers.UUIDField(required=False, allow_null=True)


class SecurityEventClosureSummarySerializer(serializers.ModelSerializer):
    """Story 18.6a: response shape for итог направления (`SecurityEventClosureSummary`,
    18.1) — read-only, all fields, same convention as `JournalEntrySerializer`
    (persisted state, not recomputed on GET)."""

    class Meta:
        model = SecurityEventClosureSummary
        fields = ["id", "event", "sector", "summary", "created_at", "updated_at"]
        read_only_fields = fields


class SecurityEventSectorSummaryItemSerializer(serializers.Serializer):
    """Story 18.6a: one element of `SecurityEventCloseSerializer.summaries`
    — thin field-mapping, no business validation (that stays in
    `close_security_event()`, 18.1)."""

    sector = serializers.CharField()
    summary = serializers.CharField()


class SecurityEventCloseSerializer(serializers.Serializer):
    """Story 18.6a: write-only request body for `POST .../close/` — thin
    pass-through to `close_security_event()` (18.1); the service itself
    owns all business validation (sector coverage, duplicates, unknown
    sectors, IN_PROGRESS lifecycle) — this serializer validates only field
    PRESENCE/TYPE, same division of labor as `JournalEntryCreateSerializer`."""

    summaries = SecurityEventSectorSummaryItemSerializer(many=True)


class SecurityEventArchiveSerializer(serializers.Serializer):
    """Story 18.6a: response shape for `SecurityEventArchiveSelector.full_history()`
    (18.2) — a composite `Serializer` (not `ModelSerializer`, the selector
    returns a plain dict spanning several models, not one row) wrapping
    already-existing response serializers, same class of solution as
    `AssignmentVersionReturnResponseSerializer` (16.8c)."""

    event = SecurityEventSerializer()
    checklist_items = ChecklistItemSerializer(many=True)
    sector_posts = SectorPostSerializer(many=True)
    staffing_demands = StaffingDemandSerializer(many=True)
    journal_entries = JournalEntrySerializer(many=True)
    closure_summaries = SecurityEventClosureSummarySerializer(many=True)
    current_assignment_version = AssignmentVersionDetailSerializer(allow_null=True)
