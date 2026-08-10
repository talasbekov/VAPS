"""Вьюхи раздела «Охранные мероприятия».

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations, core и
documents: заводить второй механизм прав ради нового префикса значило бы
защищать одни и те же сведения по-разному в зависимости от того, каким адресом
их спросили.
"""
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)
from organization_management.apps.ops.api.serializers import (
    SecurityObjectSerializer,
)
from organization_management.apps.ops import passport as passport_service
from organization_management.apps.operations.api.permissions import (
    resolve_actor_id,
)
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError

# Реестр объектов открывается СВОИМ правом, а не оргструктурным. Подразделение
# — это форма службы, а охраняемый объект вместе с адресом и видом говорит,
# что и где охраняется: сведения другого рода, и уравнивать их нельзя.
# Существующее `object.manage` сюда не годится по обратному доводу — это право
# управления, и требовать его на чтение значило бы закрыть реестр от всех, кто
# его только смотрит.
_READ_OBJECT_PERMISSION = "object.view"
# Паспорт правит и публикует управляющий объектами — право, уже существующее
# в каталоге RBAC; заводить третье «паспортное» право значило бы разрезать
# одно решение («кто отвечает за объект») на два кода без разных владельцев.
_MANAGE_OBJECT_PERMISSION = "object.manage"


class SecurityObjectViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/ops/objects/ — реестр охраняемых объектов.

    Только чтение. Заведение и правка объекта, редактирование паспорта и
    публикация версии — свои срезы со своими проверками; открывать запись
    раньше, чем появились секторы, посты и версии, значило бы дать править
    объект, у которого паспорта ещё нет как понятия.
    """

    serializer_class = SecurityObjectSerializer
    # Конверт списка не пагинируется: freshness/kpi считаются по ВСЕМУ
    # реестру, и страница, у которой агрегаты про другой набор строк, чем
    # таблица, хуже отсутствия пагинации. Реестр объектов мал по природе
    # (единицы—десятки строк).
    pagination_class = None
    permission_map = {
        "list": _READ_OBJECT_PERMISSION,
        "retrieve": _READ_OBJECT_PERMISSION,
        "passport": _MANAGE_OBJECT_PERMISSION,
        "passport_versions": _MANAGE_OBJECT_PERMISSION,
    }

    def get_queryset(self):
        # Порядок задаёт Meta.ordering модели, и владелец у него ОДИН.
        # Повторить order_by здесь значило бы завести второй источник правды:
        # проба, ломающая один из них, оставалась бы зелёной за счёт второго,
        # и порядок оказался бы не проверен ни там, ни тут.
        return OpsSecurityObject.objects.prefetch_related(
            "sectors__posts", "passport_versions"
        )

    def list(self, request, *args, **kwargs):
        """Конверт клиента: {results, freshness, kpi, freshnessPolicy,
        unavailableKpi} — агрегаты и свежесть приходят С СЕРВЕРА вместе со
        списком одним ответом (KPI по другому снимку реестра, чем таблица,
        хуже отсутствующего)."""
        objects = list(self.get_queryset())
        policy = passport_service.read_policy()
        business_date = Clock.today_local()
        freshness = [
            passport_service.resolve_freshness(obj, policy, business_date)
            for obj in objects
        ]
        return Response(
            {
                "results": self.get_serializer(objects, many=True).data,
                "freshness": freshness,
                "kpi": passport_service.build_kpi(objects, freshness),
                "freshnessPolicy": {
                    "version": policy.version,
                    "verificationIntervalDays": (
                        policy.verification_interval_days
                    ),
                    "dueSoonPercent": policy.due_soon_percent,
                },
                "unavailableKpi": passport_service.UNAVAILABLE_KPI,
            }
        )

    def _get_object_or_domain_404(self, pk):
        # Свой 404 вместо Http404 дженерика: чужие ошибки уходят штатным
        # путём DRF без error_code, а клиент раздела различает исходы только
        # по конверту (parseOpsErrorResponse).
        found = (
            self.get_queryset().filter(pk=pk).first()
            if str(pk).isdigit()
            else None
        )
        if found is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"id": str(pk)},
                message="Объект не найден.",
            )
        return found

    @action(detail=True, methods=["patch"], url_path="passport")
    def passport(self, request, pk=None):
        """PATCH /objects/{id}/passport/ — заменить черновик паспорта."""
        obj = self._get_object_or_domain_404(pk)
        sectors = (request.data or {}).get("sectors")
        passport_service.update_passport(obj, sectors)
        obj = self._get_object_or_domain_404(pk)  # свежие prefetch-строки
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"], url_path="passport/versions")
    def passport_versions(self, request, pk=None):
        """POST /objects/{id}/passport/versions/ — опубликовать версию."""
        obj = self._get_object_or_domain_404(pk)
        data = request.data or {}
        passport_service.publish_version(
            obj,
            effective_from=data.get("effectiveFrom"),
            note=data.get("note"),
            actor=resolve_actor_id(request),
        )
        obj = self._get_object_or_domain_404(pk)
        return Response(self.get_serializer(obj).data, status=201)
