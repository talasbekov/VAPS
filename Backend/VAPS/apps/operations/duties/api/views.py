"""Story 14.11a/14.11b/14.11c/14.11d/14.11e: `POST|GET /api/operations/
duty-plans [/{id}/shifts] [/{id}/approve] [/{id}/shifts/{shift_id}/cancel]
[/{id}/shifts/{shift_id}/replan]` (API-OPS-012).

Deliberately a plain `viewsets.ViewSet` + the free `require_permission`
function (`apps.operations.api.permissions`), not `RequirePermissionMixin`:
two actions don't earn a `permission_map` declaration — mirrors
`apps.operations.bugreports.api.views.BugReportViewSet`, the most recent
precedent for this shape.

`duty.manage`'s RBAC role-binding row (which roles actually carry this
code) and HTTP audit logging are explicitly 14.12's territory — this story
only gates on the permission code, which already exists in the seed
(`apps/operations/management/commands/seed_operations.py`).

Duplicate-plan (409/422) and year/month-range (422) rejections are NOT
re-validated here: the existing DB-level `UniqueConstraint`/
`CheckConstraint` (Story 14.5) already reject them, and the project's
existing exception handler already maps the resulting `IntegrityError` to
a 4xx response (Story 3.3's "IntegrityError -> 422" backstop) — no new
validation logic duplicated in this layer.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.operations.api.permissions import require_permission
from apps.operations.duties.api.serializers import (
    DutyPlanConflictSerializer,
    DutyPlanCreateSerializer,
    DutyPlanSerializer,
    DutyShiftCancelSerializer,
    DutyShiftCreateSerializer,
    DutyShiftReplanSerializer,
    DutyShiftSerializer,
)
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.duties.services import (
    approve_duty_plan,
    cancel_duty_shift,
    replan_duty_shift,
    validate_duty_plan,
)

_PERMISSION = "duty.manage"


class DutyPlanPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200


class DutyPlanViewSet(viewsets.ViewSet):
    """Story 14.11a: create/list duty plans."""

    http_method_names = ["get", "post", "options"]
    pagination_class = DutyPlanPagination

    @extend_schema(
        operation_id="duty_plans_create",
        request=DutyPlanCreateSerializer,
        responses={201: DutyPlanSerializer},
        description="Создать план дежурств (DRAFT). Требует duty.manage.",
    )
    def create(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        form = DutyPlanCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        plan = DutyPlan.objects.create(**form.validated_data)
        return Response(
            DutyPlanSerializer(plan).data, status=http_status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="duty_plans_list",
        responses={200: DutyPlanSerializer(many=True)},
        description="Список планов дежурств. Требует duty.manage. "
        "limit/offset-пагинация (дефолт 50, потолок 200). Опциональный "
        "фильтр по object (query-параметр).",
    )
    def list(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        plans = DutyPlan.objects.order_by("-year", "-month")
        object_id = request.query_params.get("object")
        if object_id:
            # Review (Blind Hunter/Edge Case Hunter, independently confirmed):
            # Object's PK is a plain integer — filtering with a raw,
            # unvalidated query-param string raises a bare ValueError deep
            # inside the queryset (Postgres "invalid input syntax for type
            # integer"), which exception_handler.py doesn't map and falls
            # through to a bare 500. Validate/coerce here so bad input is a
            # clean 400, same as create's PrimaryKeyRelatedField already
            # gives for the request-body path.
            if not object_id.isdigit():
                raise ValidationError({"object": "Ожидается числовой id объекта."})
            plans = plans.filter(object_id=object_id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(plans, request)
        return paginator.get_paginated_response(
            DutyPlanSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="duty_plan_shifts_create",
        methods=["POST"],
        request=DutyShiftCreateSerializer,
        responses={201: DutyShiftSerializer},
        description="Создать смену в плане. Требует duty.manage.",
    )
    @extend_schema(
        operation_id="duty_plan_shifts_list",
        methods=["GET"],
        responses={200: DutyShiftSerializer(many=True)},
        description="Список смен плана. Требует duty.manage. "
        "limit/offset-пагинация (дефолт 50, потолок 200).",
    )
    @action(detail=True, methods=["get", "post"])
    def shifts(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        if request.method == "POST":
            return self._create_shift(request, plan)
        return self._list_shifts(request, plan)

    def _create_shift(self, request, plan):
        form = DutyShiftCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        shift = DutyShift(plan=plan, **form.validated_data)
        # Story 14.11b: DutyShift.clean()'s cross-FK guard (post/duty_type
        # must belong to plan.object) has NO DB-level backstop (a Postgres
        # CHECK can't compare columns across tables) — full_clean() is the
        # ONLY enforcement layer, and this is the first HTTP write path for
        # DutyShift. Django 4.1+'s full_clean() ALSO validates
        # ck_duty_shift_starts_before_ends up front (Model.
        # validate_constraints()) — empirically confirmed both raise
        # django.core.exceptions.ValidationError, which DRF's exception
        # handling does NOT auto-convert (a well-known DRF gotcha — it only
        # understands its own rest_framework.exceptions.ValidationError).
        # Converting explicitly here avoids a bare 500 for either case.
        try:
            shift.full_clean()
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict) from exc
        shift.save()
        return Response(
            DutyShiftSerializer(shift).data, status=http_status.HTTP_201_CREATED
        )

    def _list_shifts(self, request, plan):
        shifts = plan.shifts.order_by("starts_at")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(shifts, request)
        return paginator.get_paginated_response(
            DutyShiftSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="duty_plan_approve",
        request=None,
        responses={200: DutyPlanSerializer},
        description="Утвердить план дежурств (BR-017 — запускает проекцию "
        "DUTY/REST_AFTER_DUTY/BEFORE_DUTY). Требует duty.manage. "
        "Идемпотентно — повторный вызов на уже APPROVED-плане не ошибка.",
    )
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None, *args, **kwargs):
        # Story 14.11c: thin wrapper — approve_duty_plan() (14.6, review-
        # hardened in 14.11c with select_for_update()) is already idempotent
        # by design (status flip guarded, project_duty_shift()'s get_or_create
        # is idempotent by source_ref), so this action adds no state-machine
        # guard of its own. Uses the RETURNED plan (re-fetched under lock
        # inside the service), not the pre-lock instance from
        # get_object_or_404 above, which the lock doesn't mutate in place.
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        plan = approve_duty_plan(plan)
        return Response(DutyPlanSerializer(plan).data)

    @extend_schema(
        operation_id="duty_plan_cancel_shift",
        request=DutyShiftCancelSerializer,
        responses={200: DutyShiftSerializer},
        description="Отменить смену дежурства. Требует duty.manage.",
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"shifts/(?P<shift_id>[^/.]+)/cancel",
    )
    def cancel_shift(self, request, pk=None, shift_id=None, *args, **kwargs):
        # Story 14.11d: DutyShift has no top-level ViewSet of its own (it's
        # not a standalone resource, only ever reached through its plan,
        # 14.9a's design) — a plain @action(detail=True) only yields ONE
        # path param from the router, so a second ID (shift_id) is carried
        # via a custom url_path regex instead of a new ViewSet.
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        # Review (Blind Hunter, 14.11d): the custom url_path regex
        # ([^/.]+) accepts non-numeric shift_id — DutyShift's PK is a
        # plain integer, and get_object_or_404() only catches
        # DoesNotExist, not the ValueError Django raises casting a
        # malformed string to an int field lookup (same bug class as
        # 14.11a's ?object= query-param fix). Guard so bad input is a
        # clean 404, not a bare 500.
        if not shift_id.isdigit():
            raise Http404("Смена не найдена.")
        # get_object_or_404 against plan.shifts (not DutyShift.objects)
        # also enforces the shift actually belongs to THIS plan — a
        # cross-plan shift id in the URL 404s instead of silently
        # cancelling a shift in a different plan.
        shift = get_object_or_404(plan.shifts, pk=shift_id)
        form = DutyShiftCancelSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # actor is never taken from the request body (ARCH-SEC-030) — it
        # comes from the auth contract, same as every other actor-taking
        # call in this codebase.
        # Uses the RETURNED shift (re-fetched under lock inside the
        # service, 14.11d review fix), not the pre-lock instance above.
        shift = cancel_duty_shift(
            shift, actor=request.actor_id, reason=form.validated_data["reason"]
        )
        return Response(DutyShiftSerializer(shift).data)

    @extend_schema(
        operation_id="duty_plan_replan_shift",
        request=DutyShiftReplanSerializer,
        responses={201: DutyShiftSerializer},
        description="Перепланировать смену дежурства (отменяет старую, "
        "создаёт новую с изменёнными полями). Требует duty.manage. Поля "
        "кроме reason опциональны — отсутствующее поле наследуется от "
        "старой смены, явный null снимает пост/вид дежурства.",
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"shifts/(?P<shift_id>[^/.]+)/replan",
    )
    def replan_shift(self, request, pk=None, shift_id=None, *args, **kwargs):
        # Story 14.11e: mirrors cancel_shift's URL/guard pattern exactly
        # (14.11d) — same isdigit() guard on shift_id, same plan-scoped
        # lookup via plan.shifts.
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        if not shift_id.isdigit():
            raise Http404("Смена не найдена.")
        shift = get_object_or_404(plan.shifts, pk=shift_id)
        form = DutyShiftReplanSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        new_fields = dict(form.validated_data)
        reason = new_fields.pop("reason")
        # replan_duty_shift() calls new_shift.full_clean() internally and
        # does NOT catch django.core.exceptions.ValidationError itself
        # (same DRF-conversion gotcha as 14.11b's _create_shift) — convert
        # explicitly here so a cross-FK guard failure (post/duty_type not
        # belonging to the plan's object) is a clean 400, not a bare 500.
        try:
            new_shift = replan_duty_shift(
                shift, actor=request.actor_id, reason=reason, **new_fields
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict) from exc
        return Response(
            DutyShiftSerializer(new_shift).data, status=http_status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="duty_plan_validate",
        request=None,
        responses={200: DutyPlanConflictSerializer(many=True)},
        description="Проверить план дежурств на конфликты занятости сотрудников "
        "БЕЗ утверждения (dry-run, ничего не пишет в БД). Требует duty.manage. "
        "Пустой список — конфликтов нет.",
    )
    # Review (Blind Hunter): DutyPlanViewSet.pagination_class is a bare class
    # attribute — drf-spectacular's schema generation detects it on ANY
    # action whose response is declared `Serializer(many=True)` (a
    # ListSerializer), regardless of whether that action actually paginates.
    # Without pagination_class=None here, schema.yaml wrongly documented
    # this endpoint as returning a paginated envelope (limit/offset params +
    # PaginatedDutyPlanConflictList), while the real response is a bare
    # array — @action's kwargs override viewset-level *_classes per-route
    # (DRF's own documented mechanism), fixing both runtime (moot, this
    # action never paginates) and schema generation.
    @action(detail=True, methods=["post"], pagination_class=None)
    def validate(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        conflicts = validate_duty_plan(plan)
        return Response(DutyPlanConflictSerializer(conflicts, many=True).data)

    @extend_schema(
        operation_id="duty_plan_conflicts",
        responses={200: DutyPlanConflictSerializer(many=True)},
        description="Прочитать конфликты плана дежурств (то же вычисление, "
        "что validate, под GET). Требует duty.manage. Пустой список — "
        "конфликтов нет.",
    )
    @action(detail=True, methods=["get"], pagination_class=None)
    def conflicts(self, request, pk=None, *args, **kwargs):
        # Story 14.11g: donor treats validate (POST, "check now") and
        # conflicts (GET, "read what was found") as two distinct logical
        # endpoints even though nothing in the codebase persists conflicts
        # yet (no ops_duty_conflicts table) — both call the exact same
        # read-only validate_duty_plan(), no logic duplicated.
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        conflicts = validate_duty_plan(plan)
        return Response(DutyPlanConflictSerializer(conflicts, many=True).data)
