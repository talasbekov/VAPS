"""Story 4.5 — read-only audit journal API (FR-36).

``GET /api/audit/logs/`` (list + retrieve) under the ``audit.view`` permission.
Lives inside ``apps/audit`` so it may read ``AuditLog`` directly — the AST write-
boundary ban targets writes from OTHER apps (4.3 AC-4). Write verbs are absent
(``http_method_names`` is GET-only → DRF returns 405), matching the append-only
DB invariant (ARCH-SEC-032). Filtering + deterministic ordering live in
``AuditLogSelector``; this view is thin: gate → validate filters → selector →
paginate → serialize. Errors flow through the unified handler (no manual
Response): bad filters → 400, missing perm → 403, unknown id → 404.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import viewsets
from rest_framework.exceptions import NotFound
from rest_framework.pagination import LimitOffsetPagination

from apps.audit.api.serializers import AuditLogFilterSerializer, AuditLogSerializer
from apps.audit.models import AuditLog
from apps.audit.selectors import AuditLogSelector
from apps.core.api.permissions import RequirePermissionMixin


class AuditLogPagination(LimitOffsetPagination):
    """limit/offset envelope {count, next, previous, results} — the project
    canon (architecture.md#L427); default 50, hard cap 200."""

    default_limit = 50
    max_limit = 200


class AuditLogViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    pagination_class = AuditLogPagination
    # GET-only: write verbs fall outside http_method_names → the gate mixin
    # early-returns and DRF answers 405 (not a misleading 403).
    http_method_names = ["get", "head", "options"]
    permission_map = {"list": "audit.view", "retrieve": "audit.view"}

    def get_queryset(self):
        filters = AuditLogFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        return AuditLogSelector.list(
            getattr(self.request, "actor_id", None),
            entity_type=data.get("entity_type"),
            entity_id=data.get("entity_id"),
            actor_user_id=data.get("actor"),
            action=data.get("action"),
            created_from=data.get("created_from"),
            created_to=data.get("created_to"),
        )

    def get_object(self):
        # retrieve via the selector's .get (architecture.md#L451 — the single
        # read channel), not DRF's get_object_or_404 in the view. Missing row →
        # 404 ENTITY_NOT_FOUND through the unified handler.
        try:
            return AuditLogSelector.get(
                getattr(self.request, "actor_id", None), self.kwargs["pk"]
            )
        except (AuditLog.DoesNotExist, DjangoValidationError, ValueError):
            # Missing OR malformed pk → 404, never a 500. The id column is a
            # UUIDField, and DefaultRouter's "[^/.]+" lets a non-UUID segment
            # (e.g. /logs/0/) reach the ORM, where coercion raises Django's
            # ValidationError/ValueError — not DoesNotExist. NotFound() (no arg)
            # keeps a human-readable message; the handler still maps 404 →
            # ENTITY_NOT_FOUND.
            raise NotFound()
