"""Authenticated private normative files and global reference management."""
import io

from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin, require_global_permission, resolve_actor_id
from organization_management.apps.ops import legal_documents


class OpsLegalDocumentsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_value_regex = r"\d+"
    permission_map = {
        "list": ("catalog.view", "legal.manage"),
        "files": ("catalog.view", "legal.manage"),
        "download": ("catalog.view", "legal.manage"),
        "create": "legal.manage", "partial_update": "legal.manage",
    }

    def list(self, request):
        return Response({"results": legal_documents.list_documents(),
                         "canManage": legal_documents.can_manage(resolve_actor_id(request)),
                         "maxFileSizeBytes": legal_documents.MAX_FILE_SIZE_BYTES})

    def create(self, request):
        require_global_permission(request, "legal.manage")
        return Response(legal_documents.create_document(request.data, actor=resolve_actor_id(request)), status=201)

    def partial_update(self, request, pk=None):
        require_global_permission(request, "legal.manage")
        return Response(legal_documents.update_document(pk, request.data, actor=resolve_actor_id(request)))

    @action(detail=True, methods=["get"])
    def files(self, request, pk=None):
        return Response({"results": legal_documents.list_files(pk)})

    @action(detail=True, methods=["get"], url_path=r"files/(?P<file_id>\d+)/download")
    def download(self, request, pk=None, file_id=None):
        record, content = legal_documents.prepare_download(pk, file_id)
        response = FileResponse(io.BytesIO(content), as_attachment=True, filename=record.original_name, content_type=record.content_type)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
