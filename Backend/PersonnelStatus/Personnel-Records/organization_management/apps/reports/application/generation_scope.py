"""Authorization shared by the legacy report API and its asynchronous worker."""
from rest_framework.exceptions import PermissionDenied

from organization_management.apps.common.rbac import _scope_division_ids
from organization_management.apps.common.services.permissions import PermissionService


GENERATION_SCOPE_FILTER = '_generation_scope'


def require_generation_scope(user, division_id):
    # The legacy expense contract deliberately uses orgstructure.view. A null
    # division means the entire service, not the caller's visible divisions.
    if user is None or not user.is_active:
        raise PermissionDenied('Нет зоны ответственности')
    if user.is_superuser:
        return
    visible = _scope_division_ids(user, PermissionService.SCOPE_PERMISSION)
    if visible is None:
        return
    if not visible:
        raise PermissionDenied('Нет зоны ответственности')
    if division_id is None or division_id not in visible:
        raise PermissionDenied('Подразделение вне зоны ответственности')
