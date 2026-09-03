"""Выпуски информационного бюллетеня (`[МД-01]`, `[БЛН-04]`, Plane №420).

`GET  /api/ops/bulletin-issues/`            — список выпусков, новые сверху.
`POST /api/ops/bulletin-issues/ {asOf}`     — выпустить на срез: строки и PDF
                                              замораживаются.
`GET  /api/ops/bulletin-issues/{id}/file/`  — байты выпуска тем же конвертом,
                                              что у `event-documents/render/`
                                              (JSON с base64: токен идёт
                                              заголовком, прямой ссылки нет).

Право — то же, что у выгрузки документов: выпуск показывает ровно то, что
показывает реестр, и защищать это иначе, чем сам реестр, было бы второй
меркой на одни сведения.
"""
import base64

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
    resolve_actor_id,
)
from organization_management.apps.ops import bulletin_issues, documents_registry

_READ_EVENT_PERMISSION = "event.view"


class OpsBulletinIssuesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {
        "list": _READ_EVENT_PERMISSION,
        "create": _READ_EVENT_PERMISSION,
        "file": _READ_EVENT_PERMISSION,
    }

    def list(self, request):
        return Response({"results": bulletin_issues.list_issues()})

    def create(self, request):
        data = request.data or {}
        issue = bulletin_issues.issue_bulletin(
            as_of=data.get("asOf"),
            actor=str(resolve_actor_id(request) or request.user),
        )
        return Response(issue, status=201)

    @action(detail=True, methods=["get"], url_path="file")
    def file(self, request, pk=None):
        name, payload = bulletin_issues.issue_file(pk)
        return Response(
            {
                "fileName": name,
                "contentBase64": base64.b64encode(payload).decode("ascii"),
                "contentType": documents_registry.content_type("pdf"),
            }
        )
