"""Identity-эндпоинт раздела «Охранные мероприятия» (/security-ops/* фронта).

Первый живой кусок api-режима нативного порта: фронт в
NEXT_PUBLIC_OPS_DATA_SOURCE=api берёт права отсюда, а не из host-MSW.
Контракт зафиксирован фронтом (hooks/use-ops-permissions.ts): плоский список
кодов, wildcard "*" — администратор. Остальные /api/ops/*-эндпоинты бэкенда
пока не существуют — фронт показывает честные HTTP-ошибки.
"""
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView


class MyOperationsPermissionsView(APIView):
    """GET /api/operations/my-permissions/ — права текущего пользователя.

    Источник — общая RBAC-модель (Role.get_permissions с кешем): отдельного
    реестра прав у раздела ОМ нет, коды едины для всей системы.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.is_superuser:
            return Response({"permissions": ["*"]})
        role_info = getattr(request.user, "role_info", None)
        if role_info is None:
            # Пользователь без роли — авторизован, но прав раздела нет.
            return Response({"permissions": []})
        return Response({"permissions": role_info.role.get_permissions()})
