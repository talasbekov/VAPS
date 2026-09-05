"""Выпуски информационного бюллетеня (`[МД-01]`, `[БЛН-04]`, Plane №420).

`GET  /api/ops/bulletin-issues/`            — список выпусков, новые сверху.
`POST /api/ops/bulletin-issues/ {asOf}`     — выпустить на срез: строки и PDF
                                              замораживаются.
`GET  /api/ops/bulletin-issues/{id}/file/`  — байты выпуска тем же конвертом,
                                              что у `event-documents/render/`
                                              (JSON с base64: токен идёт
                                              заголовком, прямой ссылки нет).

ПРАВА РАЗНЫЕ У ЧТЕНИЯ И У ВЫПУСКА (Plane №625). Список и выдача байтов —
`event.view`: выпуск показывает ровно то, что показывает реестр, и защищать это
иначе, чем сам реестр, было бы второй меркой на одни сведения. А ВЫПУСК —
`event.bulletin` («Заполнение бюллетеня мероприятия»), потому что это не
чтение: он пишет постоянную строку в базу и PDF в приватное хранилище, а
внешний ключ стоит `on_delete=PROTECT` — удалить выпущенное средствами продукта
нельзя ничем. Под правом на чтение любой наблюдатель мог крутить POST-ы и
забивать том неудаляемыми записями: ни дедупликации, ни троттлинга, ни проверки
«этот срез уже выпущен» здесь нет.
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
# Выпуск — действие, а не чтение (Plane №625). Право уже есть в каталоге и
# роздано тем, кто ведёт бюллетень: EVENT_OFFICER, EMPLOYEE_OPS_D2,
# HEAD_OPS_UNIT (`seed_operations`), — заводить новое незачем.
_ISSUE_PERMISSION = "event.bulletin"


class OpsBulletinIssuesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {
        "list": _READ_EVENT_PERMISSION,
        "create": _ISSUE_PERMISSION,
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
        name, payload = bulletin_issues.issue_file(
            pk, actor=str(resolve_actor_id(request) or request.user)
        )
        return Response(
            {
                "fileName": name,
                "contentBase64": base64.b64encode(payload).decode("ascii"),
                "contentType": documents_registry.content_type("pdf"),
            }
        )
