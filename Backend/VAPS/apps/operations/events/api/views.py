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
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from django.db import transaction

from apps.audit.services import record
from apps.operations.api.permissions import require_permission
from apps.operations.events.api.serializers import (
    ChecklistItemSerializer,
    SecurityEventCreateSerializer,
    SecurityEventSerializer,
    SectorPostSerializer,
)
from apps.operations.events.models import SecurityEvent
from apps.operations.events.services import (
    issue_bulletin,
    replace_checklist_items,
    replace_sector_posts,
)

_PERMISSION = "event.manage"


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
    pagination_class = SecurityEventPagination

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
