"""Task ownership never impersonates its initiator or widens a scoped grant."""
from django.db.models import Q
from rest_framework.exceptions import NotFound
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.services import PermissionService


def is_headquarters(request):
    permissions = PermissionService.unscoped_permissions(resolve_actor_id(request))
    return bool(permissions & {"*", "forces.command"})


def visible_tasks(request):
    condition = Q(initiated_by=resolve_actor_id(request))
    if is_headquarters(request):
        condition |= Q(delegated=True)
    return OpsAssistantTask.objects.filter(condition)


def _task_by_id(query, pk):
    import uuid
    try:
        key = uuid.UUID(str(pk))
    except (ValueError, TypeError, AttributeError):
        raise NotFound()
    task = query.filter(pk=key).first()
    if task is None:
        raise NotFound()
    return task


def get_task(request, pk):
    return _task_by_id(visible_tasks(request), pk)


def lock_task(request, pk):
    """Lock until the caller commits; continue_task owns the transaction."""
    return _task_by_id(visible_tasks(request).select_for_update(), pk)
