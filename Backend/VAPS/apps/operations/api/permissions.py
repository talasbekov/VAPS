from rest_framework.exceptions import PermissionDenied

from apps.operations.api.identity import get_user_id
from apps.operations.services import PermissionService


def require_permission(request, permission_code, division_id=None):
    """Raise 403 PERMISSION_DENIED unless the caller holds permission_code."""
    user_id = get_user_id(request)
    if not user_id:
        raise PermissionDenied("PERMISSION_DENIED")
    if not PermissionService.has_permission(user_id, permission_code, division_id=division_id):
        raise PermissionDenied("PERMISSION_DENIED")
    return user_id
