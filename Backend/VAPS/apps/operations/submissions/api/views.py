"""Story 5.8a — day-submission write API (POST /api/operations/daily-submissions/).

First write endpoint over a DomainError-raising service. The view stays thin
(layer contract, architecture.md#L442-452): coarse permission gate
(RequirePermissionMixin — the resolver is division-free) → input form →
division-scope guard (ensure_division_scope, the service-layer check behind
the «scope в сервисе» AC) → submit_day → 201 projection. Errors flow through
the unified handler (no try/except, no manual error Response): the service's
own 400/404/409/422 pass as-is, and the duplicate-race IntegrityError backstop
is already mapped to 409 DAY_ALREADY_SUBMITTED by CONSTRAINT_ERROR_MAP.
create-only: list/detail arrive with 5.8c, amend with 5.8b.
"""

from rest_framework import status, viewsets
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.operations.submissions.api.serializers import (
    DailySubmissionCreateSerializer,
    DailySubmissionSerializer,
)
from apps.operations.submissions.services import ensure_division_scope, submit_day

# One source for both gates — the coarse mixin check and the scope re-check
# must never drift onto different permission codes.
_SUBMIT_PERMISSION = "daily_report.mark_update"


class DailySubmissionViewSet(RequirePermissionMixin, viewsets.ViewSet):
    # Methods outside the map fall through the mixin's early return to DRF → 405.
    permission_map = {"create": _SUBMIT_PERMISSION}
    http_method_names = ["post", "options"]

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
