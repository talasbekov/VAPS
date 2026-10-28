"""Only global settings administrators can inspect or contact AI servers."""
from django.views.decorators.debug import sensitive_variables
from rest_framework.response import Response
from rest_framework.views import APIView

from organization_management.apps.operations.api.permissions import require_global_permission, resolve_actor_id
from organization_management.apps.operations.models_assistant_connection_check import OpsAssistantConnectionCheck
from organization_management.apps.ops.assistant import connection, provider


class AssistantSettingsPermission:
    def has_permission(self, request, view):
        require_global_permission(request, "settings.manage")
        return True


class OpsAssistantSettingsView(APIView):
    permission_classes = [AssistantSettingsPermission]
    http_method_names = ["get", "put", "options"]

    @sensitive_variables()
    def get(self, request):
        return Response(connection.public(connection.configuration(tolerate_unreadable=True)))

    @sensitive_variables()
    def put(self, request):
        return Response(connection.save(request.data, resolve_actor_id(request)))


class OpsAssistantSettingsCheckView(APIView):
    permission_classes = [AssistantSettingsPermission]
    http_method_names = ["post", "options"]

    @sensitive_variables()
    def post(self, request):
        current = connection.configuration(tolerate_unreadable=True)
        draft = connection.validate_draft(request.data, current)
        matches_saved = (current["revision"] != "0" and not current.get("keyError") and
                         all(draft[key] == current[key] for key in ("provider", "baseUrl", "model", "apiKey")))
        try:
            provider.check_connection(draft)
        except provider.ProviderUnavailable as error:
            succeeded, message = False, str(error)
        else:
            succeeded, message = True, "Подключение работает. Модель вернула корректный ответ JSON."
        OpsAssistantConnectionCheck.objects.create(
            succeeded=succeeded, provider=draft["provider"], model=draft["model"],
            checked_saved_revision=current["revision"] if matches_saved else None,
        )
        return Response({"ok": succeeded, "message": message})
