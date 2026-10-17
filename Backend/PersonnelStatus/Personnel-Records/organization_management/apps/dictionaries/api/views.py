from django.db import transaction
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.dictionaries import lifecycle
from organization_management.apps.dictionaries.models import (
    Position,
    Rank
)
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
    resolve_actor_id,
)
from .serializers import (
    PositionSerializer,
    RankSerializer,
    StatusTypeListSerializer
)

#: Право на правку кадровых справочников. ТО ЖЕ, что у значений справочников
#: раздела ОМ — решение заказчика 28.08.2026 (Plane №274 Ш-1): «Открыть под
#: тем же правом, что и ОМ». С UC-REF-001 это отдельное право на значения,
#: `dictionary.manage` мутаций больше не даёт. Одно правило на все справочники.
_MANAGE = "dictionary_value.manage"
_VIEW = "dictionary.view"


class _StaffDictionaryViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    """Кадровый справочник с чтением всем и правкой по праву.

    ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ. До 28.08.2026 здесь стояло `http_method_names =
    ['get', 'head', 'options']` с подписью «Только GET для API»: должности и
    звания — основание всей штатки (на стенде 442 штатные единицы ссылаются на
    них), и запись была закрыта наглухо. Заказчик просил у модуля
    «Справочники» все три действия и подтвердил, что правка идёт под тем же
    правом, что и у справочников ОМ.

    УДАЛЕНИЕ ИДЁТ ПО СВЯЗЯМ (UC-REF-001, подпроект 2). Раньше строка со
    ссылками не удалялась вовсе — 400 с числом. Теперь правило то же, что у
    значений ОМ: связей нет — физическое удаление (204); связи есть — строка
    деактивируется с датой неактуальности (200 с исходом), потому что молча
    оборвать штатное расписание нельзя, а держать в выборе значение, которым
    больше не пользуются, незачем. Прежняя запись с преемником не удаляется
    и не активируется — она уже история (409).
    """

    permission_classes = [permissions.IsAuthenticated]
    permission_map = {
        "list": _VIEW,
        "retrieve": _VIEW,
        "create": _MANAGE,
        "update": _MANAGE,
        "partial_update": _MANAGE,
        "destroy": _MANAGE,
        "set_active": _MANAGE,
        "supersede": _MANAGE,
    }
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def list(self, request, *args, **kwargs):
        from organization_management.apps.dictionaries.review import add_replacement_families
        rows = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data
        rows = add_replacement_families(rows, predecessor_key="supersedes", active_key="is_active")
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(page) if page is not None else Response(rows)

    @transaction.atomic
    def perform_create(self, serializer):
        from organization_management.apps.dictionaries.review import require_similarity_confirmation
        confirmed = serializer.validated_data.pop("confirmSimilar", False)
        require_similarity_confirmation(
            self.get_serializer(self.get_queryset(), many=True).data,
            (serializer.validated_data.get("name"), serializer.validated_data.get("name_kk")), confirmed,
        )
        instance = serializer.save()
        lifecycle.record_created(instance, actor=resolve_actor_id(self.request))

    @transaction.atomic
    def perform_update(self, serializer):
        serializer.validated_data.pop("confirmSimilar", None)
        serializer.instance = lifecycle._locked(serializer.instance)
        if not serializer.instance.is_active:
            from organization_management.apps.operations.exceptions import DomainError
            raise DomainError("DICTIONARY_ENTRY_INACTIVE", 409, message="Корректировать можно только активное значение.")
        old = lifecycle._snapshot(serializer.instance)
        instance = serializer.save()
        lifecycle.record_updated(instance, actor=resolve_actor_id(self.request), old=old)

    def destroy(self, request, *args, **kwargs):
        result, instance = lifecycle.remove(self.get_object(), actor=resolve_actor_id(request))
        if result == "deleted":
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"result": "deactivated", "row": self.get_serializer(instance).data})

    @action(detail=True, methods=["post"], url_path="set-active")
    def set_active(self, request, pk=None):
        instance = lifecycle.set_active(
            self.get_object(), is_active=(request.data or {}).get("is_active"),
            actor=resolve_actor_id(request),
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def supersede(self, request, pk=None):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.validated_data.pop("confirmSimilar", None)
        successor = lifecycle.supersede(
            self.get_object(), data=serializer.validated_data, actor=resolve_actor_id(request),
        )
        return Response(self.get_serializer(successor).data, status=status.HTTP_201_CREATED)


class PositionViewSet(_StaffDictionaryViewSet):
    """Справочник должностей: чтение всем, правка по `dictionary_value.manage`."""
    # Преемник предзагружается: `superseded_by` читает каждая строка ответа.
    queryset = Position.objects.prefetch_related("superseded_by")
    serializer_class = PositionSerializer


class RankViewSet(_StaffDictionaryViewSet):
    """Справочник званий: чтение всем, правка по `dictionary_value.manage`."""
    queryset = Rank.objects.prefetch_related("superseded_by")
    serializer_class = RankSerializer

class StatusTypeViewSet(viewsets.ViewSet):
    """ViewSet для справочника типов статусов (только GET)"""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StatusTypeListSerializer

    def list(self, request):
        """Возвращает список всех доступных типов статусов"""
        serializer = StatusTypeListSerializer({})
        return Response(serializer.data)


from organization_management.apps.operations.models_geo import OpsCountry, OpsCity
from .serializers import CountrySerializer, CitySerializer


class _GeoDictionaryViewSet(_StaffDictionaryViewSet):
    pagination_class = None

    @transaction.atomic
    def perform_update(self, serializer):
        super().perform_update(serializer)
        from organization_management.apps.operations.models_event import OpsSecurityEvent
        from organization_management.apps.ops.event_location import compose_location
        instance = serializer.instance
        field = "country_id" if isinstance(instance, OpsCountry) else "city_id"
        for event in OpsSecurityEvent.objects.filter(**{field: instance.pk}).select_related("country", "city"):
            location = compose_location(event.country, event.city, event.address)
            OpsSecurityEvent.objects.filter(pk=event.pk).update(location=location)


class CountryViewSet(_GeoDictionaryViewSet):
    queryset = OpsCountry.objects.prefetch_related("superseded_by")
    serializer_class = CountrySerializer


class CityViewSet(_GeoDictionaryViewSet):
    queryset = OpsCity.objects.select_related("country").prefetch_related("superseded_by")
    serializer_class = CitySerializer
