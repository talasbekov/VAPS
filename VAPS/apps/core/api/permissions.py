from rest_framework.exceptions import PermissionDenied


def require_permission(request, permission_code):
    """Gate a core API action on an in-house RBAC permission code.

    Mirror of ``apps/operations/api/permissions.py`` but resolves nothing
    itself: it reads ``request.effective_permissions`` (a set populated by the
    operations authz seam registered in ``DEFAULT_AUTHENTICATION_CLASSES``).
    This keeps core free of any ``apps.operations`` import — ARCH#L585
    «core ↛ all». The ``*`` wildcard short-circuit mirrors
    ``PermissionService.has_permission`` (ADMIN holds ``*``).
    """
    if not getattr(request, "actor_id", None):
        raise PermissionDenied("PERMISSION_DENIED")
    perms = getattr(request, "effective_permissions", set())
    if "*" not in perms and permission_code not in perms:
        raise PermissionDenied("PERMISSION_DENIED")


class RequirePermissionMixin:
    """ViewSet mixin: gate each action on an in-house RBAC permission code.

    Subclasses set ``permission_map = {action_name: permission_code}`` (action
    name = the ViewSet method, e.g. ``list``/``create``/``partial_update`` or a
    custom ``@action`` method like ``archive``/``assign_employee``). The gate
    runs in ``initial()`` AFTER ``super().initial()`` — i.e. after DRF
    authentication, so the operations seam has populated
    ``request.effective_permissions`` (story 2.13). An action absent from the
    map is denied (fail-closed); the rbac-matrix completeness test guarantees
    every served action is mapped, so a gap surfaces at test time, not in prod.

    MRO: list the mixin FIRST (``class FooViewSet(RequirePermissionMixin,
    viewsets.ModelViewSet)``) so its ``initial`` wraps the DRF chain. core never
    imports operations — the gate reads only request attributes (ARCH#L585).
    """

    permission_map: dict = {}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Let DRF handle methods this ViewSet does not serve (→ 405) and OPTIONS
        # metadata / CORS preflight (→ self-documenting 200) instead of
        # fail-closing them into a misleading 403.
        if request.method.lower() not in self.http_method_names:
            return
        if self.action == "metadata":
            return
        code = self.permission_map.get(self.action)
        if code is None:
            raise PermissionDenied("PERMISSION_DENIED")
        require_permission(request, code)
