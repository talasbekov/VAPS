"""Read-only administration diagnostics. No network probes or secret reads."""
import os
import re

from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from organization_management.apps.operations.api.permissions import require_global_permission
from organization_management.apps.operations.clock import _local_tz
from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.ops.assistant.connection import environment_configuration
from organization_management.apps.ops import system_diagnostics


class DiagnosticsPermission:
    def has_permission(self, request, view):
        require_global_permission(request, "settings.manage")
        return True


class OpsSystemDiagnosticsView(APIView):
    permission_classes = [DiagnosticsPermission]
    http_method_names = ["get", "head", "options"]

    def get(self, request):
        now = timezone.now()
        row = OpsAssistantConnection.objects.only("provider", "model", "updated_at", "revision").filter(pk=1).first()
        fallback = environment_configuration() if row is None else None
        provider = row.provider if row else fallback["provider"]
        model = row.model if row else fallback["model"]
        latest = MigrationRecorder.Migration.objects.filter(app="operations").order_by("-applied", "-name").values("name", "applied").first()
        revision = os.environ.get("SMART_RELEASE_REVISION", "")
        if re.fullmatch(r"[0-9a-f]{40}", revision) is None:
            revision = None
        response = Response({
            "checked_at": now.isoformat(), "time_zone": str(_local_tz()),
            "application": {"state": "available"},
            "database": {"state": "available", "last_recorded_migration": latest["name"] if latest else None,
                         "migration_recorded_at": latest["applied"].isoformat() if latest else None},
            "ai": {"state": "disabled" if provider == "disabled" else "configured", "provider": provider,
                   "model": model, "updated_at": row.updated_at.isoformat() if row else None,
                   "connectivity": "not_checked", "last_check": system_diagnostics.connection_check(str(row.revision) if row else None)},
            "ai_queue": system_diagnostics.assistant_queue(request, now=now),
            "digital_twin": system_diagnostics.digital_twin_evidence(),
            "backup": {"state": "unknown", "last_verified_at": None},
            "release": {"state": "declared" if revision else "unknown", "revision": revision, "installation_verified": False},
        })
        response["Cache-Control"] = "private, no-store"
        return response

