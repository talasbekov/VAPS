"""Гейт API раздела ОМ (порт apps/core/api/permissions.py из Backend/VAPS).

Отличие от источника: там идентичность ставит цепочка External-Auth
(request.actor_id) и отдельный authz-шов наполняет
request.effective_permissions; здесь идентичность — SimpleJWT старого
проекта, поэтому резолюция прав выполняется лениво прямо в require_permission
(с кешем на request). Старую систему прав (common.rbac) это не трогает —
две системы сосуществуют, целевая — эта.
"""
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied

from organization_management.apps.operations.services import (
    LegacyRoleSync,
    PermissionService,
)


def resolve_actor_id(request) -> str | None:
    """user_id RBAC текущего запроса; None — аноним."""
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return None
    return LegacyRoleSync.actor_id_for_user(user)


def effective_permissions(request) -> set:
    """Эффективные права запроса с кешем на объекте request: один резолв на
    запрос, сколько бы действий его ни спрашивало."""
    cached = getattr(request, "_ops_effective_permissions", None)
    if cached is not None:
        return cached
    actor_id = resolve_actor_id(request)
    perms = PermissionService.effective_permissions(actor_id) if actor_id else set()
    request._ops_effective_permissions = perms
    return perms


def require_permission(request, permission_code):
    """Гейт действия на код права нового RBAC. Wildcard `*` — ADMIN."""
    if resolve_actor_id(request) is None:
        raise PermissionDenied("PERMISSION_DENIED")
    perms = effective_permissions(request)
    if "*" not in perms and permission_code not in perms:
        raise PermissionDenied("PERMISSION_DENIED")


class RequirePermissionMixin:
    """ViewSet-миксин: каждое действие гейтится кодом права нового RBAC.

    Подклассы задают permission_map = {action: permission_code}. Гейт
    выполняется в initial() ПОСЛЕ super().initial() — после аутентификации
    DRF. Действие вне карты запрещено (fail-closed). Миксин ставить ПЕРВЫМ
    в MRO: class FooViewSet(RequirePermissionMixin, viewsets.ModelViewSet).
    """

    permission_map: dict = {}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Методы, которые ViewSet не обслуживает (→405), и OPTIONS-метаданные
        # (→200) не должны фейл-клоузиться в дезориентирующий 403.
        if request.method.lower() not in self.http_method_names:
            return
        if self.action == "metadata":
            return
        # Метод, который ViewSet обслуживает глобально, но ЭТОТ маршрут не
        # мапит (GET на post-only @action-URL), резолвится в action=None —
        # это промах поверхности метода: 405 здесь, не проваливаться дальше.
        if self.action is None:
            raise MethodNotAllowed(request.method)
        code = self.permission_map.get(self.action)
        if code is None:
            raise PermissionDenied("PERMISSION_DENIED")
        require_permission(request, code)
