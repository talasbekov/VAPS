"""Authenticated local OM assistant: plans, durable results and staff handoff."""
from django.db import transaction
from django.core.paginator import Paginator
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import RequirePermissionMixin, effective_permissions, resolve_actor_id
from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.ops.assistant import access, execution, planning, provider, dialogue


CAPABILITIES = ("event.create", "event.manage", "event.bulletin", "forces.command")


class OpsAssistantTaskViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {name: CAPABILITIES for name in ("list", "retrieve", "create", "continue_work", "configuration", "catalogs", "messages", "retry")}
    http_method_names = ["get", "post", "options"]

    def list(self, request):
        requested_page = request.query_params.get("page", "1")
        if not requested_page.isascii() or not requested_page.isdigit() or len(requested_page) > 9 or int(requested_page) < 1:
            execution.invalid("Номер страницы должен быть целым положительным числом.", "page")
        pages = Paginator(access.visible_tasks(request).order_by("-updated_at", "-id"), 25)
        page = pages.get_page(int(requested_page))
        return Response({"results": [execution.serialize_task(request, task) for task in page], "isHeadquarters": access.is_headquarters(request),
                         "page": page.number, "pageCount": pages.num_pages, "total": pages.count,
                         "nextPage": page.next_page_number() if page.has_next() else None,
                         "previousPage": page.previous_page_number() if page.has_previous() else None})

    def retrieve(self, request, pk=None):
        try:
            return Response(execution.serialize_task(request, access.get_task(request, pk)))
        except execution.ManualActionFailed as error:
            return error.response

    def create(self, request):
        data = request.data
        if not isinstance(data, dict) or set(data) - {"requestKey", "message", "fields", "interpret"}:
            execution.invalid("Неизвестные поля задачи.")
        if "interpret" in data and type(data["interpret"]) is not bool:
            execution.invalid("Признак понимания текста должен быть логическим.")
        key = data.get("requestKey")
        message = data.get("message", "")
        if not isinstance(key, str) or not key.strip() or len(key) > 80:
            execution.invalid("Укажите ключ новой задачи.", "requestKey")
        if not isinstance(message, str) or len(message) > 4000:
            execution.invalid("Опишите задачу текстом длиной до4000 знаков.", "message")
        patch = execution.validate_fields(data.get("fields", {}))
        actor = resolve_actor_id(request)
        request_hash = execution.digest(data)
        existing = OpsAssistantTask.objects.filter(initiated_by=actor, request_key=key).first()
        if existing:
            if existing.request_hash != request_hash:
                execution.conflict()
            try:
                return Response(execution.serialize_task(request, existing))
            except execution.ManualActionFailed as error:
                return error.response
        interpret = data.get("interpret", not data.get("fields"))
        if interpret and not message.strip():
            execution.invalid("Опишите задачу текстом.", "message")
        plan = execution.make_plan({}, patch, actor_id=actor)
        # get_or_create's unique actor/key constraint arbitrates concurrent retries.
        with transaction.atomic():
            task, created = OpsAssistantTask.objects.get_or_create(
                initiated_by=actor, request_key=key,
                defaults={"request_hash": request_hash, "message": message, "plan": plan, "created_by": actor},
            )
            if task.request_hash != request_hash:
                execution.conflict()
            if created:
                dialogue.ensure_initial_message(task)
                if interpret:
                    dialogue.queue_task(task, patch=patch)
        try:
            if created and not interpret:
                task = execution.continue_task(request, task.pk)
            task.refresh_from_db()
            return Response(execution.serialize_task(request, task), status=201 if created else 200)
        except execution.ManualActionFailed as error:
            return error.response

    @action(detail=True, methods=["post"], url_path="continue")
    def continue_work(self, request, pk=None):
        data = request.data if request.data is not None else {}
        if not isinstance(data, dict) or set(data) - {"fields", "revision"}:
            execution.invalid("Неизвестные поля продолжения задачи.")
        if "fields" in data:
            execution.validate_fields(data["fields"])
        try:
            task = execution.continue_task(request, pk, fields=data.get("fields"), revision=data.get("revision"))
            return Response(execution.serialize_task(request, task))
        except execution.ManualActionFailed as error:
            return error.response

    @action(detail=True, methods=["post"], url_path="messages")
    def messages(self, request, pk=None):
        task, created = dialogue.add_message(request, pk, request.data)
        task.refresh_from_db()
        return Response(execution.serialize_task(request, task), status=202 if created else 200)

    @action(detail=True, methods=["post"], url_path="retry")
    def retry(self, request, pk=None):
        task, created = dialogue.retry_task(request, pk, request.data)
        task.refresh_from_db()
        return Response(execution.serialize_task(request, task), status=202 if created else 200)

    @action(detail=False, methods=["get"], url_path="configuration")
    def configuration(self, request):
        return Response({**provider.provider_configuration(), "isHeadquarters": access.is_headquarters(request)})

    @action(detail=False, methods=["get"], url_path="catalogs")
    def catalogs(self, request):
        perms = effective_permissions(request)
        objects = OpsSecurityObject.objects.order_by("name") if perms & {"*", "event.create", "event.manage", "gvo.manage"} else OpsSecurityObject.objects.none()
        return Response({
            "objects": [{"id": str(obj.pk), "name": obj.name} for obj in objects],
            "departments": [{"id": str(row.pk), "name": row.name} for row in Division.objects.filter(division_type=Division.DivisionType.DEPARTMENT, is_active=True).order_by("name")],
        })
