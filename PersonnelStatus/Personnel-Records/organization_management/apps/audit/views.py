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
from .domain.models import AuditLog
from .serializers import AuditLogSerializer
from .filters import AuditLogFilter


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint that allows audit logs to be viewed."""

    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    ordering_fields = ["timestamp", "user", "action_type"]
    ordering = ["-timestamp"]