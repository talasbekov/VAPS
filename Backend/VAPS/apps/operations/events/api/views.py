"""Story 15.2a: `POST|GET /api/operations/security-events` (FR-21 — создание
ОМ + назначение Старшего объекта).

Плоский `viewsets.ViewSet` + free `require_permission()`, буквальный образец
`apps.operations.duties.api.views.DutyPlanViewSet` (14.11a/14.12a) — create
has no service function of its own (plain one-line ORM create), so
`record()` lives here, wrapped in the same `transaction.atomic()` block as
the create itself (14.12a's review-fix rationale applies identically: a
`record()` failure must roll back the create, not leave an unaudited row).

Reuses the existing `event.manage` permission code (`seed_operations.py`) —
role-binding stays flexible/admin-configurable, no per-story hardcoding
(14.12a's Scope Decision, same reasoning).
"""

import uuid

from django.http import Http404
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from django.db import transaction

from apps.audit.services import record
from apps.core.selectors import CoreEmployeeSelector
from apps.operations.api.permissions import require_permission
from apps.operations.events.api.serializers import (
    AllocateForceRequestSerializer,
    ApproveVersionSerializer,
    AssignmentVersionDetailSerializer,
    AssignmentVersionReturnResponseSerializer,
    AssignmentVersionSerializer,
    ChecklistItemSerializer,
    DirectAssignmentSerializer,
    GenerateForceRequestsResponseSerializer,
    GroupForceRequestSerializer,
    GroupSerializer,
    JournalEntryCreateSerializer,
    JournalEntrySerializer,
    PlacementAssignmentSerializer,
    ReturnVersionSerializer,
    SecurityEventCreateSerializer,
    SecurityEventSerializer,
    SectorPostSerializer,
    StaffingDemandSerializer,
)
from apps.operations.events.models import (
    AssignmentVersion,
    Group,
    GroupForceRequest,
    JournalEntry,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventDirectAssignment,
)
from apps.operations.events.services import (
    acknowledge_placement_assignment,
    allocate_force_request,
    approve_assignment_version,
    approve_staffing_demand,
    confirm_recon,
    create_journal_entry,
    detect_placement_conflicts,
    form_draft_placement,
    generate_force_requests,
    issue_bulletin,
    replace_checklist_items,
    replace_sector_posts,
    replace_staffing_demand,
    return_assignment_version,
    submit_assignment_version,
)
from apps.operations.facilities.api.serializers import (
    ObjectPassportSerializer,
    ObjectPassportUpdateSerializer,
)
from apps.operations.facilities.services import update_passport_for_event
from apps.operations.services import PermissionService

_PERMISSION = "event.manage"
# Story 15.4: passport mutations are Object-level, gated on the existing
# object.manage code, not event.manage (which only covers SecurityEvent
# mutations) — same separation-of-concerns choice as 14.x's per-domain
# permission codes.
_PASSPORT_PERMISSION = "object.manage"

# Story 16.8a: no dedicated assignment.view code exists (unlike duty-plans,
# where read/write share duty.manage) — reading a Placement version is
# gated on holding ANY of the codes that participate in its lifecycle
# (OMD/SENIOR_COORDINATOR create+submit, APPROVER return+approve), not a
# new code invented for this story.
_ASSIGNMENT_READ_PERMISSIONS = (
    "assignment.create",
    "assignment.submit",
    "assignment.return",
    "assignment.approve",
)


def _require_any_permission(request, codes):
    """Story 16.8a: `require_permission()`'s single-code contract has no
    "any of" variant — this is the local helper for it, same 403
    PERMISSION_DENIED shape, checked directly via `PermissionService`
    (not by calling `require_permission()` in a loop and swallowing N-1
    exceptions, which would mask a genuine non-permission error from a
    later code)."""
    user_id = getattr(request, "actor_id", None)
    if not user_id:
        raise PermissionDenied("PERMISSION_DENIED")
    if not any(PermissionService.has_permission(user_id, code) for code in codes):
        raise PermissionDenied("PERMISSION_DENIED")
    return user_id


class SecurityEventPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200


def _get_event_or_404(pk):
    if not (pk or "").isdigit():
        raise Http404("ОМ не найден.")
    return get_object_or_404(SecurityEvent, pk=pk)


class SecurityEventViewSet(viewsets.ViewSet):
    """Story 15.2a: create/list security events (ОМ)."""

    http_method_names = ["get", "post", "put", "options"]
    _pagination_class = SecurityEventPagination

    @property
    def pagination_class(self):
        # Review (Acceptance Auditor, 15.7b): drf-spectacular's
        # `_is_list_view()` triggers on ANY `many=True` response serializer
        # (checked BEFORE it looks at `self.action`), so a class-level
        # `pagination_class` leaks a `Paginated...List` wrapper + limit/
        # offset params onto the `force_requests` action's schema even
        # though that action never calls `self.paginate_queryset()` and
        # genuinely returns a bare array — a real schema/behavior
        # mismatch, not cosmetic. Scoping pagination to the `list` action
        # only (the one action that actually paginates) fixes the
        # generated schema without touching runtime behavior of either
        # action.
        if self.action == "list":
            return self._pagination_class
        return None

    @extend_schema(
        operation_id="security_events_create",
        request=SecurityEventCreateSerializer,
        responses={201: SecurityEventSerializer},
        description="Создать ОМ (DRAFT). Требует event.manage.",
    )
    def create(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        form = SecurityEventCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        with transaction.atomic():
            event = SecurityEvent.objects.create(**form.validated_data)
            record(
                actor=request.actor_id,
                action="SECURITY_EVENT_CREATED",
                entity_type="security_event",
                entity_id=uuid.UUID(int=event.pk),
                new_value={
                    "event_id": event.pk,
                    "object_id": event.object_id,
                    "title": event.title,
                    "senior_employee_id": str(event.senior_employee_id)
                    if event.senior_employee_id
                    else None,
                },
            )
        return Response(
            SecurityEventSerializer(event).data, status=http_status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="security_events_list",
        responses={200: SecurityEventSerializer(many=True)},
        description="Список ОМ. Требует event.manage. limit/offset-пагинация "
        "(дефолт 50, потолок 200). Опциональный фильтр по object.",
    )
    def list(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        events = SecurityEvent.objects.order_by("-created_at")
        object_id = request.query_params.get("object")
        if object_id:
            if not object_id.isdigit():
                raise ValidationError({"object": "Ожидается числовой id объекта."})
            events = events.filter(object_id=object_id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(events, request)
        return paginator.get_paginated_response(
            SecurityEventSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="security_event_bulletin",
        responses={200: SecurityEventSerializer},
        description="Выпустить бюллетень (DRAFT->BULLETIN). Требует "
        "event.manage. Идемпотентно на уже-BULLETIN; 422 из любого другого "
        "статуса.",
    )
    @action(detail=True, methods=["post"], url_path="bulletin")
    def bulletin(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        # Review (Edge Case Hunter, 15.2b): the router's default lookup
        # regex accepts non-numeric pk — SecurityEvent's PK is a plain
        # integer, and get_object_or_404() only catches DoesNotExist, not
        # the ValueError Django raises casting a malformed string to an int
        # field lookup (same bug class as 14.11d's shift_id fix). Guard so
        # bad input is a clean 404, not a bare 500. Story 15.3b extracted
        # this into `_get_event_or_404()` for its own two new actions.
        event = _get_event_or_404(pk)
        event = issue_bulletin(event, actor=request.actor_id)
        return Response(SecurityEventSerializer(event).data)

    @extend_schema(
        operation_id="security_event_checklist_replace",
        request=ChecklistItemSerializer(many=True),
        responses={200: ChecklistItemSerializer(many=True)},
        description="Заменить чек-лист рекогносцировки целиком (FR-22). "
        "Требует event.manage. Пустой массив допустим (сброс чек-листа).",
    )
    @action(detail=True, methods=["put"], url_path="checklist")
    def checklist(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        form = ChecklistItemSerializer(data=request.data, many=True)
        form.is_valid(raise_exception=True)
        items = replace_checklist_items(event, form.validated_data)
        return Response(ChecklistItemSerializer(items, many=True).data)

    @extend_schema(
        operation_id="security_event_sector_posts_replace",
        request=SectorPostSerializer(many=True),
        responses={200: SectorPostSerializer(many=True)},
        description="Заменить строки пересчёта постов/секторов целиком "
        "(FR-22). Требует event.manage. Пустой массив допустим.",
    )
    @action(detail=True, methods=["put"], url_path="sector-posts")
    def sector_posts(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        form = SectorPostSerializer(data=request.data, many=True)
        form.is_valid(raise_exception=True)
        posts = replace_sector_posts(event, form.validated_data)
        return Response(SectorPostSerializer(posts, many=True).data)

    @extend_schema(
        operation_id="security_event_recon_confirm",
        responses={200: SecurityEventSerializer, 202: SecurityEventSerializer},
        description="Двойной контроль: подтвердить рекогносцировку "
        "(BULLETIN->RECON, FR-22). Первый вызов → 202 (принято, ждёт "
        "второго ДРУГОГО актора). Второй вызов другим актором → 200, "
        "переход завершён. Тот же актор дважды → 422. Идемпотентно на "
        "уже-RECON. Требует event.manage.",
    )
    @action(detail=True, methods=["post"], url_path="recon/confirm")
    def recon_confirm(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        event, pending = confirm_recon(event, actor=request.actor_id)
        code = http_status.HTTP_202_ACCEPTED if pending else http_status.HTTP_200_OK
        return Response(SecurityEventSerializer(event).data, status=code)

    @extend_schema(
        operation_id="security_event_passport_update",
        request=ObjectPassportUpdateSerializer,
        responses={200: ObjectPassportSerializer},
        description="Обновить Паспорт объекта этого ОМ (FR-22). Требует "
        "object.manage. Доступно ТОЛЬКО пока ОМ в статусе RECON (422 иначе). "
        "Partial-update — непереданные поля не затираются. Создаёт паспорт, "
        "если его ещё нет.",
    )
    @action(detail=True, methods=["put"], url_path="passport")
    def passport(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PASSPORT_PERMISSION)
        event = _get_event_or_404(pk)
        form = ObjectPassportUpdateSerializer(data=request.data, partial=True)
        form.is_valid(raise_exception=True)
        updated = update_passport_for_event(
            event, actor=request.actor_id, fields=form.validated_data
        )
        return Response(ObjectPassportSerializer(updated).data)

    @extend_schema(
        operation_id="security_event_staffing_demand_replace",
        request=StaffingDemandSerializer(many=True),
        responses={200: StaffingDemandSerializer(many=True)},
        description="Заменить строки потребности в силах целиком (FR-23). "
        "Требует event.manage. Пустой массив допустим (сброс).",
    )
    @action(detail=True, methods=["put"], url_path="staffing-demand")
    def staffing_demand(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        form = StaffingDemandSerializer(data=request.data, many=True)
        form.is_valid(raise_exception=True)
        demands = replace_staffing_demand(event, form.validated_data)
        return Response(StaffingDemandSerializer(demands, many=True).data)

    @extend_schema(
        operation_id="security_event_staffing_demand_approve",
        responses={200: SecurityEventSerializer},
        description="Утвердить Потребность (RECON->DEMAND, FR-23). Требует "
        "event.manage. Идемпотентно на уже-DEMAND; 422 из любого другого "
        "статуса.",
    )
    @action(detail=True, methods=["post"], url_path="staffing-demand/approve")
    def staffing_demand_approve(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        event = approve_staffing_demand(event, actor=request.actor_id)
        return Response(SecurityEventSerializer(event).data)

    @extend_schema(
        operation_id="security_event_force_requests_generate",
        responses={200: GenerateForceRequestsResponseSerializer},
        description="Сгенерировать и отправить запросы Группам (FR-24). "
        "Требует event.manage. Доступно только из статуса DEMAND. "
        "Идемпотентно (regenerate обновляет requested_count, не сбрасывает "
        "уже начатое выделение). Несматченные Группы — в unmatched_groups, "
        "не молча теряются.",
    )
    @action(detail=True, methods=["post"], url_path="force-requests/generate")
    def force_requests_generate(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        requests, unmatched_groups, stale_groups = generate_force_requests(
            event, actor=request.actor_id
        )
        return Response(
            GenerateForceRequestsResponseSerializer(
                {
                    "force_requests": requests,
                    "unmatched_groups": unmatched_groups,
                    "stale_groups": stale_groups,
                }
            ).data
        )

    @extend_schema(
        operation_id="security_event_force_requests_list",
        responses={200: GroupForceRequestSerializer(many=True)},
        description="Список запросов Группам для этого ОМ. Требует event.manage.",
    )
    @action(detail=True, methods=["get"], url_path="force-requests")
    def force_requests(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        requests = event.force_requests.select_related("group").all()
        return Response(GroupForceRequestSerializer(requests, many=True).data)

    @extend_schema(
        operation_id="security_event_direct_assignments",
        methods=["GET"],
        responses={200: DirectAssignmentSerializer(many=True)},
        description="Список физнарядов (прямых назначений ОМД) для этого "
        "ОМ. Требует event.manage.",
    )
    @extend_schema(
        operation_id="security_event_direct_assignment_create",
        methods=["POST"],
        request=DirectAssignmentSerializer,
        responses={201: DirectAssignmentSerializer},
        description="Создать физнаряд — прямое назначение сотрудника на "
        "пост, минуя запрос Группе/брокеридж (FR-24). Требует "
        "event.manage. Система пассивна: НЕТ проверки двойного "
        "назначения — разрешение «спора за человека» вне системы.",
    )
    @action(detail=True, methods=["get", "post"], url_path="direct-assignments")
    def direct_assignments(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        event = _get_event_or_404(pk)
        if request.method == "GET":
            assignments = event.direct_assignments.all()
            return Response(DirectAssignmentSerializer(assignments, many=True).data)
        form = DirectAssignmentSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        sector_post = form.validated_data["sector_post"]
        if sector_post.event_id != event.pk:
            raise ValidationError({"sector_post": "Пост принадлежит другому ОМ."})
        with transaction.atomic():
            assignment = SecurityEventDirectAssignment.objects.create(
                event=event, **form.validated_data
            )
            record(
                actor=request.actor_id,
                action="SECURITY_EVENT_DIRECT_ASSIGNMENT_CREATED",
                entity_type="security_event_direct_assignment",
                entity_id=uuid.UUID(int=assignment.pk),
                new_value={
                    "event_id": event.pk,
                    "sector_post_id": assignment.sector_post_id,
                    "employee_id": str(assignment.employee_id),
                },
            )
        return Response(
            DirectAssignmentSerializer(assignment).data,
            status=http_status.HTTP_201_CREATED,
        )

    @extend_schema(
        operation_id="security_event_placement_draft",
        request=None,
        responses={201: AssignmentVersionDetailSerializer},
        description="Сформировать черновик Расстановки из физнарядов "
        "(FR-26). Требует assignment.create. 409 "
        "PLACEMENT_DRAFT_ALREADY_EXISTS, если у события уже есть текущая "
        "версия.",
    )
    @action(
        detail=True,
        methods=["post"],
        url_path="placement/draft",
        url_name="placement-draft",
    )
    def placement_draft(self, request, pk=None, *args, **kwargs):
        require_permission(request, "assignment.create")
        event = _get_event_or_404(pk)
        version, _created_assignments, _unmatched = form_draft_placement(
            event, actor=request.actor_id
        )
        return Response(
            AssignmentVersionDetailSerializer(version).data,
            status=http_status.HTTP_201_CREATED,
        )

    @extend_schema(
        operation_id="security_event_journal_entries_list",
        methods=["GET"],
        responses={200: JournalEntrySerializer(many=True)},
        description="Журнал штаба события (17.1/17.2) — все записи, "
        "хронологически. Требует event.journal.view. Опц. "
        "?entry_type=BRIEFING|DIRECTIVE|INCIDENT фильтрует по типу.",
    )
    @extend_schema(
        operation_id="security_event_journal_entries_create",
        methods=["POST"],
        request=JournalEntryCreateSerializer,
        responses={201: JournalEntrySerializer},
        description="Записать в журнал штаба (17.1/17.2) — требует "
        "event.journal.create и event.status_code == IN_PROGRESS. "
        "entry_type=INCIDENT требует post; 400 VALIDATION_ERROR/422 "
        "INVALID_LIFECYCLE_TRANSITION из сервиса.",
    )
    @action(detail=True, methods=["get", "post"], url_path="journal-entries")
    def journal_entries(self, request, pk=None, *args, **kwargs):
        # review-прецедент (RBAC-матрица): permission-гейт ДО 404-lookup —
        # анонимный/безправый actor обязан получить 403, не 404
        # (тот же порядок, что все остальные @action'ы этого ViewSet).
        if request.method == "GET":
            require_permission(request, "event.journal.view")
        else:
            require_permission(request, "event.journal.create")
        event = _get_event_or_404(pk)
        if request.method == "GET":
            entries = event.journal_entries.all()
            entry_type = request.query_params.get("entry_type")
            if entry_type:
                entries = entries.filter(entry_type=entry_type)
            return Response(JournalEntrySerializer(entries, many=True).data)
        form = JournalEntryCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        entry = create_journal_entry(
            event, actor=request.actor_id, **form.validated_data
        )
        return Response(
            JournalEntrySerializer(entry).data, status=http_status.HTTP_201_CREATED
        )


class JournalEntryViewSet(viewsets.ViewSet):
    """Story 17.7a: `GET /api/operations/journal-entries/{id}` — detail
    read for a journal entry by its own id (not nested under the event —
    the id is globally unique). Буквальный образец `AssignmentVersionViewSet`'s
    `retrieve`-only shape before it grew lifecycle `@action`s."""

    http_method_names = ["get", "options"]

    def retrieve(self, request, pk=None, *args, **kwargs):
        require_permission(request, "event.journal.view")
        entry = get_object_or_404(JournalEntry, pk=pk)
        return Response(JournalEntrySerializer(entry).data)


class GroupViewSet(viewsets.ViewSet):
    """Story 15.6: `GET /api/operations/groups` — справочник Групп (FR-39).
    Read-only, буквальный образец `StatusTypeViewSet`
    (apps.operations.statuses.api.views) — только `list`, только активные
    записи, отсортировано по `sort_order`."""

    http_method_names = ["get", "options"]

    @extend_schema(
        operation_id="groups_list",
        responses={200: GroupSerializer(many=True)},
        description="Активный справочник Групп (is_active=True), "
        "отсортирован по sort_order. Требует event.manage.",
    )
    def list(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        groups = Group.objects.filter(is_active=True)
        return Response(GroupSerializer(groups, many=True).data)


def _get_force_request_or_404(pk):
    if not (pk or "").isdigit():
        raise Http404("Запрос на Группу не найден.")
    return get_object_or_404(GroupForceRequest, pk=pk)


class GroupForceRequestViewSet(viewsets.ViewSet):
    """Story 15.8: `PATCH /api/operations/force-requests/{id}/allocate` —
    выделение брокером. Отдельный ViewSet (не вложен в
    `SecurityEventViewSet`) — мутирует КОНКРЕТНУЮ `GroupForceRequest`-
    строку по её собственному id, не event-scoped список."""

    http_method_names = ["patch", "options"]
    _BROKERAGE_PERMISSION = "brokerage.manage"

    @extend_schema(
        operation_id="group_force_request_allocate",
        request=AllocateForceRequestSerializer,
        responses={200: GroupForceRequestSerializer},
        description="Выделить людей на запрос Группы (FR-24). Требует "
        "brokerage.manage. Статус выводится из allocated_count vs "
        "requested_count. allocated_count > requested_count → 400.",
    )
    @action(detail=True, methods=["patch"], url_path="allocate")
    def allocate(self, request, pk=None, *args, **kwargs):
        require_permission(request, self._BROKERAGE_PERMISSION)
        force_request = _get_force_request_or_404(pk)
        form = AllocateForceRequestSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        updated = allocate_force_request(
            force_request,
            actor=request.actor_id,
            allocated_count=form.validated_data["allocated_count"],
            comment=form.validated_data.get("comment"),
        )
        return Response(GroupForceRequestSerializer(updated).data)


def _get_direct_assignment_or_404(pk):
    if not (pk or "").isdigit():
        raise Http404("Физнаряд не найден.")
    return get_object_or_404(SecurityEventDirectAssignment, pk=pk)


class SecurityEventDirectAssignmentViewSet(viewsets.ViewSet):
    """Story 15.9: `DELETE /api/operations/direct-assignments/{id}` — снять
    физнаряд. Отдельный ViewSet (не вложен в `SecurityEventViewSet`) —
    мутирует КОНКРЕТНУЮ строку по её собственному id, тот же паттерн, что
    `GroupForceRequestViewSet` (15.8)."""

    http_method_names = ["delete", "options"]

    @extend_schema(
        operation_id="security_event_direct_assignment_delete",
        responses={204: None},
        description="Снять физнаряд (FR-24). Требует event.manage. "
        "Человеческое решение спора за человека — не статус-машина.",
    )
    def destroy(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        assignment = _get_direct_assignment_or_404(pk)
        with transaction.atomic():
            record(
                actor=request.actor_id,
                action="SECURITY_EVENT_DIRECT_ASSIGNMENT_DELETED",
                entity_type="security_event_direct_assignment",
                entity_id=uuid.UUID(int=assignment.pk),
                old_value={
                    "event_id": assignment.event_id,
                    "sector_post_id": assignment.sector_post_id,
                    "employee_id": str(assignment.employee_id),
                },
            )
            assignment.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


def _get_assignment_version_or_404(pk):
    if not (pk or "").isdigit():
        raise Http404("Версия Расстановки не найдена.")
    return get_object_or_404(AssignmentVersion, pk=pk)


class AssignmentVersionViewSet(viewsets.ViewSet):
    """Story 16.8a: `GET /api/operations/assignment-versions` (list) +
    `GET /api/operations/assignment-versions/{id}` (detail, with nested
    `PlacementAssignment` rows). `create` (`placement/draft`) is nested
    under `SecurityEventViewSet` instead (needs an `event`, not a raw
    `AssignmentVersion` id) — never lives here.

    Story 16.8b onward: lifecycle-transition `@action`s (`submit`, then
    `return`/`approve`/`acknowledge` in later stories) DO live on this
    ViewSet — each is a thin wrapper over an already-idempotent service
    function (16.4/16.6b), same shape as `DutyPlanViewSet.approve`
    (14.11c)."""

    http_method_names = ["get", "post", "options"]
    _pagination_class = SecurityEventPagination

    @property
    def pagination_class(self):
        if self.action == "list":
            return self._pagination_class
        return None

    @extend_schema(
        operation_id="assignment_versions_list",
        responses={200: AssignmentVersionSerializer(many=True)},
        description="Список версий Расстановки. Требует любой из "
        "assignment.create/.submit/.return/.approve. limit/offset-"
        "пагинация (дефолт 50, потолок 200). Опциональный фильтр по event.",
    )
    def list(self, request, *args, **kwargs):
        _require_any_permission(request, _ASSIGNMENT_READ_PERMISSIONS)
        versions = AssignmentVersion.objects.order_by("-created_at")
        event_id = request.query_params.get("event")
        if event_id:
            if not event_id.isdigit():
                raise ValidationError({"event": "Ожидается числовой id события."})
            versions = versions.filter(event_id=event_id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(versions, request)
        return paginator.get_paginated_response(
            AssignmentVersionSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="assignment_versions_retrieve",
        responses={200: AssignmentVersionDetailSerializer},
        description="Деталь версии Расстановки со вложенными назначениями "
        "(conflict_severity/conflict_codes/acknowledged_at/"
        "ack_escalated_at — персистентные значения, не пересчитываются на "
        "чтении). Требует любой из assignment.create/.submit/.return/"
        ".approve.",
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        _require_any_permission(request, _ASSIGNMENT_READ_PERMISSIONS)
        version = _get_assignment_version_or_404(pk)
        return Response(AssignmentVersionDetailSerializer(version).data)

    @extend_schema(
        operation_id="assignment_version_conflicts",
        responses={200: PlacementAssignmentSerializer(many=True)},
        description="Свежий (пересчитанный) список конфликтующих назначений "
        "версии — ТОЛЬКО строки с непустым conflict_severity (в отличие от "
        "retrieve's полного вложенного списка). Требует любой из "
        "assignment.create/.submit/.return/.approve. Пересчёт пишет "
        "conflict_severity/conflict_codes в БД на каждый вызов "
        "(detect_placement_conflicts()'s собственное поведение, 16.3b-d) — "
        "не аудируется (read+recompute, тот же класс, что validate-"
        "эндпоинты).",
    )
    @action(detail=True, methods=["get"], url_path="conflicts")
    def conflicts(self, request, pk=None, *args, **kwargs):
        _require_any_permission(request, _ASSIGNMENT_READ_PERMISSIONS)
        version = _get_assignment_version_or_404(pk)
        touched = detect_placement_conflicts(version)
        conflicted = [a for a in touched if a.conflict_severity]
        return Response(PlacementAssignmentSerializer(conflicted, many=True).data)

    @extend_schema(
        operation_id="assignment_version_submit",
        request=None,
        responses={200: AssignmentVersionDetailSerializer},
        description="Подать Расстановку на согласование (DRAFT->SUBMITTED, "
        "FR-26). Требует assignment.submit. Идемпотентно на уже-SUBMITTED "
        "(чистый 200, не ошибка); 422 INVALID_LIFECYCLE_TRANSITION из "
        "любого другого статуса.",
    )
    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None, *args, **kwargs):
        require_permission(request, "assignment.submit")
        version = _get_assignment_version_or_404(pk)
        version = submit_assignment_version(version, actor=request.actor_id)
        return Response(AssignmentVersionDetailSerializer(version).data)

    @extend_schema(
        operation_id="assignment_version_return",
        request=ReturnVersionSerializer,
        responses={200: AssignmentVersionReturnResponseSerializer},
        description="Вернуть Расстановку на доработку (SUBMITTED->RETURNED "
        "+ новая DRAFT-версия, FR-26). Требует assignment.return и "
        "непустой reason в теле. НЕ идемпотентно — 422 "
        "INVALID_LIFECYCLE_TRANSITION из любого статуса, кроме SUBMITTED "
        "(включая повторный вызов на уже-RETURNED).",
    )
    @action(detail=True, methods=["post"], url_path="return", url_name="return")
    def return_(self, request, pk=None, *args, **kwargs):
        # Story 16.8c: "return" is a reserved Python keyword — the method
        # can't literally be named `return`, hence `return_` + explicit
        # `url_path`/`url_name="return"` so the route/reverse-name stay
        # `ops-assignment-version-return`, unaffected by the Python-side
        # workaround.
        require_permission(request, "assignment.return")
        form = ReturnVersionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        version = _get_assignment_version_or_404(pk)
        returned_version, new_version = return_assignment_version(
            version, actor=request.actor_id, reason=form.validated_data["reason"]
        )
        data = AssignmentVersionDetailSerializer(returned_version).data
        data["new_draft_version"] = AssignmentVersionSerializer(new_version).data
        return Response(data)

    @extend_schema(
        operation_id="assignment_version_approve",
        request=ApproveVersionSerializer,
        responses={200: AssignmentVersionDetailSerializer},
        description="Утвердить Расстановку (SUBMITTED->APPROVED, FR-26). "
        "Требует assignment.approve. Идемпотентно на уже-APPROVED (чистый "
        "200, не ошибка); 422 INVALID_LIFECYCLE_TRANSITION из любого "
        "другого статуса; 409 SOFT_CONFLICT_DETECTED (overridable) при "
        "непросмотренных конфликтах без override=true+override_reason.",
    )
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None, *args, **kwargs):
        require_permission(request, "assignment.approve")
        form = ApproveVersionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        version = _get_assignment_version_or_404(pk)
        version = approve_assignment_version(
            version,
            actor=request.actor_id,
            override=form.validated_data.get("override", False),
            override_reason=form.validated_data.get("override_reason", ""),
        )
        return Response(AssignmentVersionDetailSerializer(version).data)


def _get_placement_assignment_or_404(pk):
    if not (pk or "").isdigit():
        raise Http404("Назначение не найдено.")
    return get_object_or_404(PlacementAssignment, pk=pk)


class PlacementAssignmentViewSet(viewsets.ViewSet):
    """Story 16.8e: `POST /api/operations/placement-assignments/{id}/
    acknowledge` — separate resource from `AssignmentVersionViewSet`
    (acts on `PlacementAssignment`, not `AssignmentVersion`). Any-auth +
    self-scope, NOT an RBAC permission code — literal mirror of
    `apps.notifications.api.views.NotificationViewSet`'s "any
    authenticated actor acts only on their own row" gate (5.7c/11.4a):
    there `recipient == request.actor_id` directly; here `employee_id`
    is a UUID (not the flat actor_id string), so the identity check goes
    through `CoreEmployeeSelector.employee_id_for()` (ARCH-003 forbids
    importing `UserEmployeeBinding` from `apps.core.models` directly in
    this app)."""

    http_method_names = ["post", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Same carve-out as NotificationViewSet.initial(): `self.action is
        # None` when the route doesn't serve the current verb (405, not a
        # misleading 403); `"metadata"` is the OPTIONS preflight action —
        # let it through instead of demanding actor_id for a CORS/schema
        # probe (review, Edge Case Hunter).
        if self.action is None or self.action == "metadata":
            return
        if not getattr(request, "actor_id", None):
            raise PermissionDenied("PERMISSION_DENIED")

    @extend_schema(
        operation_id="placement_assignment_acknowledge",
        request=None,
        responses={200: PlacementAssignmentSerializer},
        description="Отметить ознакомление со своим назначением (FR-27). "
        "Любой аутентифицированный actor — НЕ RBAC-право, а самообслуживание: "
        "403, если actor не привязан к employee_id этого назначения. "
        "Идемпотентно на уже-отмеченном (чистый 200, acknowledged_at не "
        "меняется); 422 INVALID_LIFECYCLE_TRANSITION, если версия не APPROVED.",
    )
    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request, pk=None, *args, **kwargs):
        assignment = _get_placement_assignment_or_404(pk)
        actor_employee_id = CoreEmployeeSelector.employee_id_for(request.actor_id)
        if actor_employee_id != assignment.employee_id:
            raise PermissionDenied("PERMISSION_DENIED")
        assignment = acknowledge_placement_assignment(
            assignment, actor=request.actor_id
        )
        return Response(PlacementAssignmentSerializer(assignment).data)
