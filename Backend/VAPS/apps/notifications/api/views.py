"""Story 5.7c — read-only notifications API (GET /api/notifications/?since=), FR-13.

Personal feed: any authenticated actor reads ONLY their own notifications
(``recipient == request.actor_id``). Access is gated on authentication alone —
NOT an RBAC permission code (реш. 5.7c: any-auth + self-scope, mirroring
``MyPermissionsViewSet``); the recipient filter in ``NotificationSelector`` is
the access control. List-only + GET-only (write verbs → 405). Filtering +
ordering live in the selector; this view stays thin: gate → validate filter →
selector → paginate → serialize. Errors flow through the unified handler
(bad ``since`` → 400, no actor_id → 403).
"""

from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import LimitOffsetPagination

from apps.notifications.api.serializers import (
    NotificationFilterSerializer,
    NotificationSerializer,
)
from apps.notifications.selectors import NotificationSelector


class NotificationPagination(LimitOffsetPagination):
    """limit/offset envelope {count, next, previous, results} — the project canon
    (architecture.md#L427); default 50, hard cap 200."""

    default_limit = 50
    max_limit = 200


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    pagination_class = NotificationPagination
    # List-only, GET-only: no retrieve route (out of 5.7c scope); write verbs
    # fall outside http_method_names / the action map → DRF answers 405.
    http_method_names = ["get", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Gate = authentication, no RBAC code (mirror MyPermissionsViewSet): no
        # actor_id → 403. Let OPTIONS metadata / CORS preflight through instead
        # of fail-closing it into a misleading 403.
        if request.method.lower() not in self.http_method_names:
            return
        if self.action == "metadata":
            return
        if not getattr(request, "actor_id", None):
            raise PermissionDenied("PERMISSION_DENIED")

    def get_queryset(self):
        filters = NotificationFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        return NotificationSelector.list(
            getattr(self.request, "actor_id", None),
            since=filters.validated_data.get("since"),
        )
