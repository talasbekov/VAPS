from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from organization_management.apps.operations.api.permissions import RequirePermissionMixin
from organization_management.apps.ops import duty_templates
from organization_management.apps.ops.duty_record_access import REGISTER_PERMISSIONS, WRITE_PERMISSIONS


class DutyTemplateViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": REGISTER_PERMISSIONS, "retrieve": REGISTER_PERMISSIONS,
                      "create": WRITE_PERMISSIONS, "update": WRITE_PERMISSIONS,
                      "destroy": WRITE_PERMISSIONS, "remove": WRITE_PERMISSIONS}
    http_method_names = ["get", "post", "put", "delete", "head", "options"]

    def list(self, request):
        return Response(duty_templates.listing(request))

    def retrieve(self, request, pk=None):
        return Response(duty_templates.retrieve(request, pk))

    def create(self, request):
        row, created = duty_templates.save(request, request.data)
        return Response(row, status=201 if created else 200)

    def update(self, request, pk=None):
        row, _ = duty_templates.save(request, request.data, pk=pk)
        return Response(row)

    def destroy(self, request, pk=None):
        duty_templates.remove(request, pk, request.data)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        duty_templates.remove(request, pk, request.data)
        return Response({"removed": True})

