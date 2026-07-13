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

from drf_spectacular.utils import (
    extend_schema,
    extend_schema_serializer,
    inline_serializer,
)
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.documents.models import EXPENSE_DOC_TYPE
from apps.documents.selectors import IssuedDocumentSelector
from apps.operations.submissions.api.serializers import (
    DailySubmissionAmendSerializer,
    DailySubmissionCreateSerializer,
    DailySubmissionDetailSerializer,
    DailySubmissionFilterSerializer,
    DailySubmissionSerializer,
    ExpensePeriodFilterSerializer,
    ExpenseReportByDateFilterSerializer,
    ExpenseReportIssueSerializer,
    IssuedExpenseReportSerializer,
    TomorrowBlockOverrideSerializer,
)
from apps.operations.submissions.selectors import (
    READ_PERMISSION,
    DailySubmissionSelector,
)
from apps.operations.submissions.services import (
    amend_day,
    assert_report_date_has_data,
    assert_tomorrow_not_blocked,
    derive_period,
    ensure_division_scope,
    issue_expense_document,
    override_tomorrow_block,
    submit_day,
)

# Расход read/issue endpoints gate on the (already-seeded) generation right
# (Story 6.10a Д2: management reads what it issues; daily_report.view does not
# exist — decided 2026-07-02).
_EXPENSE_PERMISSION = "daily_report.generate"
# Legal bypass of the «на завтра» block — its own permission (Story 6.10b),
# distinct from generation (issuing ≠ overriding a control gate).
_OVERRIDE_PERMISSION = "daily_report.override_block"

# One source for both gates — the coarse mixin check and the scope re-check
# must never drift onto different permission codes. The READ code is imported
# from the selector module: the list selector's visibility and the view's
# read gate share it the same way (reads = mark_update, epics 2026-07-02).
_SUBMIT_PERMISSION = "daily_report.mark_update"
_AMEND_PERMISSION = "daily_report.correct"


def _ensure_division_exists(division_id):
    """404 for a valid-but-phantom division UUID (review 2026-07-13).

    Called AFTER the scope guard — a scoped stranger still gets 403 first,
    never an existence oracle. Without this, a global-scope actor (scope NULL
    matches anything) gets 200-with-zero-pages from /period/ and a misleading
    409 «нет сдачи» from POST for a division that does not exist.
    """
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )


# Single-object projection for OpenAPI: the list-action heuristic would wrap
# the by-date point lookup into an array otherwise (canon: rbac views 2.9).
_SingleIssuedExpenseReport = extend_schema_serializer(many=False)(
    IssuedExpenseReportSerializer
)


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


class ExpenseReportViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Story 6.10a — расход HTTP surface: POST issue (single date) + GET by date
    + GET period (read-only page-per-date, no number). Thin views over the
    existing issue/derive services; errors flow through the unified handler.
    «На завтра»-блокировка и override — Story 6.10b.
    """

    permission_map = {
        "create": _EXPENSE_PERMISSION,
        "list": _EXPENSE_PERMISSION,
        "period": _EXPENSE_PERMISSION,
        "override_block": _OVERRIDE_PERMISSION,
    }
    # No "head": HEAD stays 405 everywhere (mirror of the 5.8a/b minimal
    # surface above — a deliberate project-wide canon, not an omission).
    http_method_names = ["get", "post", "options"]

    @extend_schema(
        request=ExpenseReportIssueSerializer,
        responses={201: _SingleIssuedExpenseReport},
        description="Выпуск суточного расхода за дату (нумерованный "
        "юр-артефакт). 403 чужой scope; 404 нет подразделения; 409 нет "
        "сдачи / уже выпущен; 422 дата до начала данных / несходимость / "
        "TOMORROW_BLOCKED.",
    )
    def create(self, request, *args, **kwargs):
        form = ExpenseReportIssueSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        business_date = form.validated_data["business_date"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        # «На завтра»-блок (6.10b): only future dates; 422 TOMORROW_BLOCKED with
        # laggards, before the service's own 409 not-ready would fire.
        assert_tomorrow_not_blocked(
            business_date=business_date, today=Clock.today_local()
        )
        # Date-before-data (422) is checked BEFORE issuance so it wins over the
        # service's own 409 REPORT_NOT_READY_FOR_DATE (AC-4).
        assert_report_date_has_data(business_date=business_date)
        issued = issue_expense_document(
            division_id=division_id,
            business_date=business_date,
            actor=request.actor_id,
        )
        return Response(
            IssuedExpenseReportSerializer(issued).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        parameters=[ExpenseReportByDateFilterSerializer],
        responses={200: _SingleIssuedExpenseReport},
        description="Метаданные выпущенного расхода за дату (point lookup). "
        "Будущая дата НЕ блокируется намеренно: легально выпущенный через "
        "override «на завтра»-документ (6.10b) должен читаться. 404 не "
        "выпущен / нет подразделения.",
    )
    def list(self, request, *args, **kwargs):
        form = ExpenseReportByDateFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        business_date = form.validated_data["business_date"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        issued = IssuedDocumentSelector.current_issued(
            doc_type=EXPENSE_DOC_TYPE,
            division_id=division_id,
            business_date=business_date,
        )
        if issued is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={
                    "division_id": str(division_id),
                    "business_date": business_date.isoformat(),
                },
                message="Расход за дату не выпущен.",
            )
        return Response(IssuedExpenseReportSerializer(issued).data)

    @extend_schema(
        parameters=[ExpensePeriodFilterSerializer],
        responses={
            200: inline_serializer(
                name="ExpensePeriodResponse",
                fields={
                    "pages": serializers.ListField(
                        child=serializers.DictField(),
                        help_text="Страница-на-дату: {business_date, totals, "
                        "rows} — read-only derive, без номера документа.",
                    )
                },
            )
        },
        description="Read-only расход за период (страница на дату, без "
        "выпуска). 400 инверсия/длина>62/будущее; 404 нет подразделения; "
        "422 дата до начала данных.",
    )
    @action(detail=False, methods=["get"])
    def period(self, request, *args, **kwargs):
        form = ExpensePeriodFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        date_to = form.validated_data["date_to"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        # Period pages are derived on the fly — a future range would fabricate
        # official-looking numbers from today's roster (review D2 2026-07-13).
        # The by-date GET above is deliberately NOT future-blocked: it only
        # reads ISSUED documents, and a legal «на завтра» issue exists (6.10b).
        today = Clock.today_local()
        if date_to > today:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"date_to": date_to.isoformat(), "today": today.isoformat()},
                message="Период не может уходить в будущее.",
            )
        pages = derive_period(
            division_id=division_id,
            date_from=form.validated_data["date_from"],
            date_to=date_to,
        )
        return Response({"pages": pages})

    @action(
        detail=False,
        methods=["post"],
        url_path="override-tomorrow-block",
        url_name="override-tomorrow-block",
    )
    def override_block(self, request, *args, **kwargs):
        """Story 6.10b — legally lift the «на завтра» block for a future date."""
        form = TomorrowBlockOverrideSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        business_date = form.validated_data["business_date"]
        # Only a FUTURE date has a block to lift (FR-18: past/today never
        # blocked); overriding a non-future date is a no-op mistake → 400.
        if business_date <= Clock.today_local():
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"business_date": business_date.isoformat()},
                message="Обойти можно только блокировку будущей даты.",
            )
        try:
            override = override_tomorrow_block(
                business_date=business_date,
                actor=request.actor_id,
                reason=form.validated_data["reason"],
            )
        except ValueError as exc:
            # Bad input and a duplicate active override both surface as ValueError
            # (5.6b) — indistinguishable by type, both map to 400 (Story 6.10b Д2).
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"business_date": business_date.isoformat()},
                message=str(exc),
            ) from exc
        return Response(
            {
                "business_date": business_date.isoformat(),
                "overridden_by": override.overridden_by,
                "reason": override.reason,
            },
            status=status.HTTP_201_CREATED,
        )
