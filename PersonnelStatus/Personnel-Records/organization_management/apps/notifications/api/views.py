from typing import Optional
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes

from organization_management.apps.notifications.models import Notification
from .serializers import MarkAllReadSerializer, NotificationSerializer


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet для управления уведомлениями текущего пользователя.

    Предоставляет доступ только к уведомлениям текущего пользователя.
    Поддерживает пометку уведомлений как прочитанных.
    """
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Возвращает список всех уведомлений для текущего пользователя.
        """
        return Notification.objects.filter(recipient=self.request.user)

    @extend_schema(
        summary="Получить непрочитанные уведомления",
        description="Возвращает список всех непрочитанных уведомлений текущего пользователя"
    )
    @action(detail=False, methods=['get'])
    def unread(self, request: Request) -> Response:
        """
        Получение списка непрочитанных уведомлений.
        """
        queryset = self.get_queryset().filter(is_read=False)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @extend_schema(
        summary="Пометить уведомление как прочитанное",
        description="Помечает указанное уведомление как прочитанное",
        parameters=[
            OpenApiParameter(
                name='id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID уведомления'
            )
        ]
    )
    @action(detail=True, methods=['post'])
    def mark_read(self, request: Request, pk: Optional[int] = None) -> Response:
        """
        Пометить уведомление как прочитанное.

        Args:
            request: HTTP запрос
            pk: ID уведомления

        Returns:
            Response с кодом 204 при успехе
        """
        notification = self.get_object()
        notification.is_read = True
        notification.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        summary="Пометить все уведомления как прочитанные",
        description=(
            "Помечает уведомления текущего пользователя прочитанными. "
            "Необязательное поле `until` — верхняя граница по времени "
            "появления, ВКЛЮЧИТЕЛЬНО: клиент отмечает «всё, что я вижу», и "
            "без границы уведомление, прилетевшее между открытием панели и "
            "нажатием, оказалось бы прочитанным, ни разу не показавшись. "
            "Граница обязана нести часовой пояс."
        ),
        request=MarkAllReadSerializer,
    )
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request: Request) -> Response:
        """Пометить прочитанными свои уведомления — до границы, если она подана.

        🔴 ГРАНИЦА `until` (Plane №784). Здесь стояло безусловное
        `update(is_read=True)`, и «Прочитать все» отмечало ВСЮ ленту, а не
        показанное. Уведомление, прилетевшее между открытием панели и нажатием,
        помечалось прочитанным, не будучи показанным, — и человек не узнавал о
        нём НИКОГДА: непрочитанным оно больше не считается. №566 закрыл ровно
        половину кнопки: у ленты раздела ОМ граница уже была, у этой нет.

        ТРОГАЮТСЯ ТОЛЬКО НЕПРОЧИТАННЫЕ — тем же доводом, что в ленте ОМ:
        безусловное обновление переписало бы и уже прочитанные строки.

        Возвращается 204 без тела, как и прежде: клиент этой ленты числа
        отмеченных не читает, и менять контракт ради него незачем.
        """
        form = MarkAllReadSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        until = form.validated_data.get("until")
        queryset = self.get_queryset().filter(is_read=False)
        if until is not None:
            queryset = queryset.filter(created_at__lte=until)
        queryset.update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)
