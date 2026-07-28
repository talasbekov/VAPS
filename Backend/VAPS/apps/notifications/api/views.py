"""Stories 5.7c/11.4a — notifications API (GET list, POST mark-read), FR-13.

Personal feed: any authenticated actor reads/mutates ONLY their own
notifications (``recipient == request.actor_id``). Access is gated on
authentication alone — NOT an RBAC permission code (реш. 5.7c: any-auth +
self-scope, mirroring ``MyPermissionsViewSet``); the recipient filter in
``NotificationSelector``/``mark_read`` is the access control. Filtering +
ordering live in the selector; this view stays thin: gate → validate filter →
selector/service → paginate/serialize. Errors flow through the unified
handler (bad ``since`` → 400, no actor_id → 403, foreign notification → 403,
unknown id → 404).
"""

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.notifications.api.serializers import (
    NotificationFilterSerializer,
    NotificationMarkReadResponseSerializer,
    NotificationSerializer,
)
from apps.notifications.selectors import NotificationSelector
from apps.notifications.services import mark_read


class NotificationPagination(LimitOffsetPagination):
    """limit/offset envelope {count, next, previous, results} — the project canon
    (architecture.md#L427); default 50, hard cap 200."""

    default_limit = 50
    max_limit = 200


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    pagination_class = NotificationPagination
    # List (GET) + mark-read (POST, story 11.4a); no retrieve/put/patch/delete.
    # "post" here only OPENS the door at the http_method_names layer — which
    # concrete (path, method) pairs actually resolve is still decided by each
    # path()'s own {"method": "action"} mapping in urls.py, so this does not
    # grant POST on the list route.
    http_method_names = ["get", "post", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Gate = authentication, no RBAC code (mirror MyPermissionsViewSet): no
        # actor_id → 403. Let OPTIONS metadata / CORS preflight through instead
        # of fail-closing it into a misleading 403.
        #
        # `self.action` (per-URL, from THIS path's own {"method": "name"}
        # mapping in urls.py), not the class-wide `http_method_names` — after
        # story 11.4a added "post" for mark-read, a class-wide check would
        # have started enforcing the auth gate for POST on the LIST route
        # too (which does not map "post" at all), turning its intended 405
        # into a misleading 403 for an anonymous caller. `self.action` is
        # None exactly when the CURRENT route doesn't serve the current verb
        # — regression caught by test_write_verbs_not_allowed_for_anonymous.
        if self.action is None:
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

    @extend_schema(responses={200: NotificationMarkReadResponseSerializer})
    def mark_read(self, request, pk=None, *args, **kwargs):
        """``POST /api/notifications/{id}/read/`` (story 11.4a).

        Not a router ``@action`` — this app deliberately routes via plain
        ``path()`` (urls.py's own docstring: a ``DefaultRouter`` with an empty
        prefix collides ``api-root`` with the list route). Wired explicitly as
        ``NotificationViewSet.as_view({"post": "mark_read"})`` on its own path,
        the same shape as the existing ``{"get": "list"}`` mapping.
        """
        notification = mark_read(notification_id=pk, actor_id=request.actor_id)
        return Response(
            NotificationMarkReadResponseSerializer(notification).data,
            status=status.HTTP_200_OK,
        )
