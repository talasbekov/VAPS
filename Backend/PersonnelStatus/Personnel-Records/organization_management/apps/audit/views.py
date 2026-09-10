"""
API views for the audit app.

Provides a read‑only viewset for ``AuditLog`` objects with support for
filtering and ordering.  See ``audit/filters.py`` for available
filters.
"""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from .domain.models import AuditLog
from .serializers import AuditLogSerializer
from .filters import AuditLogFilter


class AuditLogViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """Legacy HTTP audit: full feed, restricted to auditors/admins.

    Like the domain audit APIs, this log is intentionally flat after the
    gate: its heterogeneous targets do not share a reliable division field.
    """

    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    permission_map = {"list": "audit.view", "retrieve": "audit.view"}
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    ordering_fields = ["timestamp", "user", "action_type"]
    ordering = ["-timestamp"]
