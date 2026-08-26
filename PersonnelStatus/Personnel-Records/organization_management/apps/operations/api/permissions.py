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


def require_scoped_permission(request, permission_code, division_id):
    """Гейт действия на право В ОБЛАСТИ подразделения (Plane №74).

    Отличие от `require_permission` — в вопросе, который задаётся правам:
    не «есть ли у человека это право вообще», а «есть ли оно у него ДЛЯ ЭТОГО
    подразделения». Роль, назначенная с областью «Департамент А»
    (`UserRole.scope_division_id`), проходит проверку для А и его управлений и
    НЕ проходит для департамента Б — ровно то разграничение, которое просил
    заказчик: «в своём департаменте, не в чужом».

    Область берётся из ДАННЫХ мероприятия (департамент строки раскладки,
    управление сотрудника), а не из тела запроса: присланная клиентом область
    была бы утверждением проверяемого о том, что он проверяет.

    `division_id is None` значит «область УСТАНОВИТЬ НЕ УДАЛОСЬ»: сотрудник без
    штатной единицы, строка раскладки без департамента, нечисловой
    идентификатор. Такой случай разбирается ПО ТИПУ ГРАНТА, а не одинаково для
    всех:

    * грант выдан БЕЗ области — пропускаем. Область его не сужает ни в одном
      подразделении, и отказ здесь запер бы ровно тех, кто ведёт цепочку
      сегодня, ничего не защитив;
    * все гранты этого права выданы С областью — ОТКАЗ. Сверить область не с
      чем, а пропустить значило бы отдать действие тому, чью границу мы не
      смогли проверить. Идентификатор сотрудника приходит ИЗ ТЕЛА ЗАПРОСА, и
      послабление здесь означало бы, что проверяемый сам подберёт «удобного»
      человека — без подразделения — и перешагнёт границу департамента.

    `effective_permissions(actor_id, None)` этот вопрос НЕ решает: при пустой
    области совпадает любой грант, и ответ у обеих ролей одинаковый. Поэтому
    спрашивается `unscoped_permissions`.

    Кеш `effective_permissions(request)` используется только для быстрого
    ответа «*»: он хранит ГЛОБАЛЬНЫЙ набор, и на вопрос про область ответ у
    него другой.
    """
    actor_id = resolve_actor_id(request)
    if actor_id is None:
        raise PermissionDenied("PERMISSION_DENIED")
    # «*» от подразделения не зависит — лишний обход дерева ни к чему.
    if "*" in effective_permissions(request):
        return
    if division_id is None:
        unscoped = PermissionService.unscoped_permissions(actor_id)
        if "*" in unscoped or permission_code in unscoped:
            return
        raise PermissionDenied("PERMISSION_DENIED")
    scoped = PermissionService.effective_permissions(actor_id, division_id)
    if "*" not in scoped and permission_code not in scoped:
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
        # Роль В ДАННЫХ может открыть действие человеку без кода права —
        # например, замещающий на объекте посещения правит расстановку своего
        # объекта, не имея общего `event.manage` (Plane «Реестр ОМ-24»).
        # Хук НЕ ослабляет карту: действие вне карты по-прежнему запрещено, а
        # исключение видно поимённо в том вьюсете, который его выдаёт.
        if self.permission_override(request):
            return
        require_permission(request, code)

    def permission_override(self, request):
        """Разрешено ли действие ролью в данных, а не кодом права.

        По умолчанию — нет: гейт остаётся fail-closed, и подмешать исключение
        можно только явным переопределением в конкретном вьюсете.
        """
        return False
