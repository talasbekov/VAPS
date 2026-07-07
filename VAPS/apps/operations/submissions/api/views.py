"""Stories 5.8a/b/c — day-submission API (/api/operations/daily-submissions/).

Write and read endpoints over DomainError-raising services and selectors.
The views stay thin (layer contract, architecture.md#L442-452): coarse
permission gate (RequirePermissionMixin — the resolver is division-free) →
input form → division-scope guard (ensure_division_scope) or actor-scoped
selector (canon L451: the LIST selector narrows visibility itself, the view
never filters by rights) → domain service / projection. Errors flow through
the unified handler (no try/except, no manual error Response): the services'
own 400/404/409/422 pass as-is, and the version-race IntegrityError backstop
is already mapped to 409 DAY_ALREADY_SUBMITTED by CONSTRAINT_ERROR_MAP. The
permission gates live ONLY here — amend_day itself stays gate-free because
the 5.4b enforcement hook calls it with no HTTP actor (Ловушка №1).
"""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.exceptions import DomainError
from apps.operations.submissions.api.serializers import (
    DailySubmissionAmendSerializer,
    DailySubmissionCreateSerializer,
    DailySubmissionDetailSerializer,
    DailySubmissionFilterSerializer,
    DailySubmissionSerializer,
)
from apps.operations.submissions.selectors import (
    READ_PERMISSION,
    DailySubmissionSelector,
)
from apps.operations.submissions.services import (
    amend_day,
    ensure_division_scope,
    submit_day,
)

# One source for both gates — the coarse mixin check and the scope re-check
# must never drift onto different permission codes. The READ code is imported
# from the selector module: the list selector's visibility and the view's
# read gate share it the same way (reads = mark_update, epics 2026-07-02).
_SUBMIT_PERMISSION = "daily_report.mark_update"
_AMEND_PERMISSION = "daily_report.correct"


class DailySubmissionPagination(LimitOffsetPagination):
    """{count, next, previous, results} envelope — architecture.md#L427:
    default 50, max 200. Per-API subclass (the project sets no global
    DEFAULT_PAGINATION_CLASS), mirror of AuditLogPagination (4.5)."""

    default_limit = 50
    max_limit = 200


class DailySubmissionViewSet(RequirePermissionMixin, viewsets.ViewSet):
    # Methods outside the map fall through the mixin's early return to DRF → 405.
    permission_map = {
        "create": _SUBMIT_PERMISSION,
        "amend": _AMEND_PERMISSION,
        "list": READ_PERMISSION,
        "retrieve": READ_PERMISSION,
    }
    # No "head": HEAD stays 405 everywhere (the 5.8a/b minimal surface).
    http_method_names = ["get", "post", "options"]

    def list(self, request, *args, **kwargs):
        filters = DailySubmissionFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        # validated_data holds only the params actually provided — absent
        # optional filters simply don't reach the selector.
        qs = DailySubmissionSelector.list(request.actor_id, **filters.validated_data)
        paginator = DailySubmissionPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(
            DailySubmissionSerializer(page, many=True).data
        )

    def retrieve(self, request, pk=None, *args, **kwargs):
        # A point read: the REQUESTED version, stale or current — never the
        # chain head (deliberate contrast with amend's Д1 chain semantics).
        submission = DailySubmissionSelector.by_id(pk)
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        # Same order and trade-off as amend (accepted at the 5.8b review):
        # pk resolves first, the 403 carries the server-resolved division_id.
        ensure_division_scope(request.actor_id, READ_PERMISSION, submission.division_id)
        return Response(DailySubmissionDetailSerializer(submission).data)

    def create(self, request, *args, **kwargs):
        form = DailySubmissionCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        # The mixin gate can't see the division (request.effective_permissions
        # is resolved without one); re-check the same code against the
        # payload's division subtree → 403 on someone else's division.
        ensure_division_scope(request.actor_id, _SUBMIT_PERMISSION, division_id)
        submission = submit_day(
            division_id=division_id,
            business_date=form.validated_data["business_date"],
            # ARCH-SEC-030: identity from the auth contract, never the payload.
            actor=request.actor_id,
        )
        return Response(
            DailySubmissionSerializer(submission).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def amend(self, request, pk=None, *args, **kwargs):
        form = DailySubmissionAmendSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # {pk} identifies the chain (Д1): amend_day re-resolves the head via
        # latest_for itself, so a stale-version pk amends the same chain.
        submission = DailySubmissionSelector.by_id(pk)
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        # Scope re-check against the RESOLVED submission's division — the pk
        # resolves first, so a phantom pk is 404 to any holder (existence by
        # integer pk is enumerable; a conscious REST trade-off, cf. tests).
        ensure_division_scope(
            request.actor_id, _AMEND_PERMISSION, submission.division_id
        )
        new_version = amend_day(
            division_id=submission.division_id,
            business_date=submission.business_date,
            # ARCH-SEC-030: identity from the auth contract, never the payload.
            actor=request.actor_id,
            reason=form.validated_data["reason"],
            sanction=form.validated_data["sanction"],
            # triggered_by_status_id stays None — it is the 5.4b hook's
            # provenance ref, never a client-writable field (Ловушка №4).
        )
        return Response(
            DailySubmissionSerializer(new_version).data,
            status=status.HTTP_201_CREATED,
        )
