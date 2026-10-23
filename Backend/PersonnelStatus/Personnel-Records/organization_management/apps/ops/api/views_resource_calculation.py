from io import BytesIO

from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.renderers import JSONRenderer
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin
from organization_management.apps.ops import resource_calculation as service
from organization_management.apps.ops.resource_calculation_documents import docx_document, json_document


class CalculationNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        renderer = renderers[0]
        return renderer, renderer.media_type


class ResourceCalculationViewSet(RequirePermissionMixin, viewsets.ViewSet):
    renderer_classes = [JSONRenderer]
    content_negotiation_class = CalculationNegotiation
    permission_map = {"retrieve": ("resource_calculation.view", "resource_calculation.manage"), "replace": "resource_calculation.manage", "export": ("resource_calculation.view", "resource_calculation.manage"), "list": ("resource_calculation.view", "resource_calculation.manage")}
    # `format` is an explicit business query, rather than DRF's renderer override.
    def get_format_suffix(self, **kwargs):
        return None

    def handle_exception(self, exc):
        if isinstance(exc, ValidationError):
            detail = exc.detail
            if isinstance(detail, list):
                return Response({"detail": " ".join(str(item) for item in detail)}, status=400)
            if isinstance(detail, dict) and "message" in detail:
                return Response({"detail": str(detail["message"]), "issues": detail.get("issues", [])}, status=400)
        return super().handle_exception(exc)

    def retrieve(self, request, event_id=None):
        return Response(service.retrieve(request, event_id))

    def replace(self, request, event_id=None):
        return Response(service.replace(request, event_id, request.data))

    def list(self, request):
        paginator = PageNumberPagination()
        paginator.page_size = 25
        page = paginator.paginate_queryset(service.list_saved(request), request, view=self)
        results = [{"eventId": str(c.event_id), "title": c.snapshot["title"], "dateFrom": c.snapshot["dateFrom"], "dateTo": c.snapshot["dateTo"], "stage": c.event.stage, "ownerDivisionName": c.owner_division.name, "version": c.version, "updatedAt": c.updated_at.isoformat(), "routeCount": len(c.document["routes"])} for c in page]
        return paginator.get_paginated_response(results)

    def export(self, request, event_id=None):
        format = request.query_params.get("format", "docx")
        calculation = service.saved_export(request, event_id, format)
        content = docx_document(calculation) if format == "docx" else json_document(calculation)
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if format == "docx" else "application/json; charset=utf-8"
        response = FileResponse(BytesIO(content), as_attachment=True, filename=f"resource-calculation-{calculation.event_id}-v{calculation.version}.{format}", content_type=mime)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
