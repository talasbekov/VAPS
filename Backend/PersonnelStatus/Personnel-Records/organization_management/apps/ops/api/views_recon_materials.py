from io import BytesIO

from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import RequirePermissionMixin
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import recon_materials


class ReconMaterialsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": "event.view", "download": "event.view", "create": "event.stage_override", "destroy": "event.stage_override"}

    def permission_override(self, request):
        if self.action not in {"create", "destroy"}:
            return False
        try:
            event, visit = recon_materials.target(self.kwargs.get("event_id"), self.kwargs.get("visit_object_id"))
        except DomainError:
            return False
        return recon_materials.may_manage(request, event, visit)

    def list(self, request, event_id=None, visit_object_id=None):
        return Response(recon_materials.list_materials(request, event_id, visit_object_id))

    def create(self, request, event_id=None, visit_object_id=None):
        return Response(recon_materials.create_material(request, event_id, visit_object_id, request.FILES.get("file"), request.data.get("checklistItemId")), status=201)

    def destroy(self, request, event_id=None, visit_object_id=None, material_id=None):
        recon_materials.remove_material(request, event_id, visit_object_id, material_id)
        return Response(status=204)

    def download(self, request, event_id=None, visit_object_id=None, material_id=None):
        row, content = recon_materials.download_material(request, event_id, visit_object_id, material_id)
        response = FileResponse(BytesIO(content), as_attachment=True, filename=row.original_name, content_type=row.content_type)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
