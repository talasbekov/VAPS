"""`/api/ops/approval-route/` — маршрут согласования в настройках (`[СОГ-05]`, Plane №429).

GET — шаги по порядку; PUT — заменить целиком (право `settings.manage`, как у
остальных настроек раздела). Отдельный префикс, а не действие `settings/…`:
у `settings` детальный маршрут ловит любой сегмент как код настройки.
"""
from rest_framework import viewsets
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
    resolve_actor_id,
)
from organization_management.apps.ops import approval_route


class OpsApprovalRouteViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": "settings.view", "replace": "settings.manage"}

    def list(self, request):
        return Response({"results": approval_route.list_steps()})

    # PUT на коллекцию: маршрут заменяется целиком — порядок и есть смысл.
    def replace(self, request):
        data = request.data or {}
        steps = approval_route.replace_steps(
            data.get("steps"), actor=str(resolve_actor_id(request) or request.user)
        )
        return Response({"results": steps})
