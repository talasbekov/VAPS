from django.db.models import ProtectedError
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from organization_management.apps.dictionaries.models import (
    Position,
    Rank
)
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from .serializers import (
    PositionSerializer,
    RankSerializer,
    StatusTypeListSerializer
)

#: Право на правку кадровых справочников. ТО ЖЕ, что у справочников раздела ОМ
#: — решение заказчика 28.08.2026 (Plane №274 Ш-1): «Открыть под тем же правом,
#: что и ОМ». Одно правило на все справочники вместо второй сущности.
_MANAGE = "dictionary.manage"
_VIEW = "dictionary.view"


class _StaffDictionaryViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    """Кадровый справочник с чтением всем и правкой по праву.

    ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ. До 28.08.2026 здесь стояло `http_method_names =
    ['get', 'head', 'options']` с подписью «Только GET для API»: должности и
    звания — основание всей штатки (на стенде 442 штатные единицы ссылаются на
    них), и запись была закрыта наглухо. Заказчик просил у модуля
    «Справочники» все три действия и подтвердил, что правка идёт под тем же
    правом, что и у справочников ОМ.

    УДАЛЕНИЕ ЗАЩИЩЕНО ССЫЛКАМИ. Строка, на которую ссылается хоть одна штатная
    единица, не удаляется: отказ называет число. Иначе удаление должности
    молча оборвало бы штатное расписание — а это ровно тот класс молчаливой
    потери, который чинился в №269.
    """

    permission_classes = [permissions.IsAuthenticated]
    permission_map = {
        "list": _VIEW,
        "retrieve": _VIEW,
        "create": _MANAGE,
        "update": _MANAGE,
        "partial_update": _MANAGE,
        "destroy": _MANAGE,
    }
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    #: Имя обратной связи от штатной единицы к строке справочника.
    usage_related_name = ""
    #: Как назвать строку в отказе.
    usage_label = "значение"

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        used = self._usage_count(instance)
        if used > 0:
            raise ValidationError(
                {
                    "detail": (
                        f"{self.usage_label} используется в штатном расписании "
                        f"({used}) — сначала снимите эти назначения."
                    )
                }
            )
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            # Вторая линия: связь, о которой счётчик не знает. Отказ вместо 500.
            raise ValidationError(
                {"detail": f"{self.usage_label} используется — удалить нельзя."}
            )

    def _usage_count(self, instance):
        if self.usage_related_name == "":
            return 0
        related = getattr(instance, self.usage_related_name, None)
        return related.count() if related is not None else 0


class PositionViewSet(_StaffDictionaryViewSet):
    """Справочник должностей: чтение всем, правка по `dictionary.manage`."""
    queryset = Position.objects.all()
    serializer_class = PositionSerializer
    usage_related_name = "staff_units"
    usage_label = "Должность"


class RankViewSet(_StaffDictionaryViewSet):
    """Справочник званий: чтение всем, правка по `dictionary.manage`."""
    queryset = Rank.objects.all()
    serializer_class = RankSerializer
    usage_related_name = "employee_set"  # у Rank нет related_name — обратное имя по умолчанию
    usage_label = "Звание"

class StatusTypeViewSet(viewsets.ViewSet):
    """ViewSet для справочника типов статусов (только GET)"""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StatusTypeListSerializer

    def list(self, request):
        """Возвращает список всех доступных типов статусов"""
        serializer = StatusTypeListSerializer({})
        return Response(serializer.data)
