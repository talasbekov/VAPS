from rest_framework.authentication import BaseAuthentication

from apps.operations.services import PermissionService


class EffectivePermissionsResolver(BaseAuthentication):
    """Attach ``request.effective_permissions`` (in-house RBAC) post-identity.

    Registered in ``DEFAULT_AUTHENTICATION_CLASSES`` AFTER
    ``XUserIdAuthentication`` — that class sets ``request.actor_id`` and returns
    ``None``, so DRF does not stop the chain and runs this resolver next. We
    read ``request.actor_id`` only — the identity header itself is parsed
    solely in ``core/auth`` (ARCH-SEC-030) — and resolve the effective
    permission set via the in-house ``PermissionService``.

    Returns ``None``: this class enriches the request, it does not claim
    identity. The seam lets the core API gate (``apps/core/api/permissions.py``)
    authorize without importing operations — honouring ARCH#L585 «core ↛ all».
    ``config`` is the composition root, so referencing this class by string in
    settings is legal; core itself imports nothing from operations.
    """

    def authenticate(self, request):
        actor_id = getattr(request, "actor_id", None)
        request.effective_permissions = (
            PermissionService.effective_permissions(actor_id)
            if actor_id
            else set()
        )
        return None
