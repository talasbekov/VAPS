"""REST-поверхность статусов (/api/operations/statuses/).

Story 10.1a — POST bulk. Тонкая вьюха поверх готового сервиса 3.8
(bulk_create_statuses): сериализатор → резолв scope из RBAC → вызов сервиса →
201 {created}. Никакой бизнес-логики/конфликт-детекта здесь (всё в 3.8).
DomainError сервиса (400/403/404/409/422) течёт через unified handler
(§36-envelope) — вьюха НЕ ловит и НЕ фильтрует по правам вручную (layer
contract, зеркало DailySubmissionViewSet 5.8). Грубый гейт права —
RequirePermissionMixin; тонкий per-строчный scope энфорсит сервис по
allowed_division_ids, которое вьюха резолвит из RBAC актора (Решение №2 3.8 —
фронту не доверяем).

Story 10.1b — GET списка на дату (префилл «вчера»). Здесь scope энфорсит САМА
вьюха: `division_id` обязателен, и чужой обязан дать 403, а не пустой список —
пустой ответ потребитель прочитал бы как «отклонений не было» и предзаполнил бы
весь дивизион «В строю». Готовый хелпер `ensure_division_scope` живёт в
submissions и импорту НЕ подлежит (test_statuses_does_not_import_submissions;
поток подобластей односторонний вниз, architecture.md#L587), поэтому проверка
написана на месте зеркалом его семантики.

Story 10.1d — GET каталога статус-типов (`/statuses/types/`) для combobox
грида. Экшеном на ЭТОМ ViewSet, а не отдельным роутом: отдельный ViewSet
потребовал бы правки `api/urls.py` и вывел бы стори за потолок в 5 файлов
(гейт декомпозиции проекта), а дробить нечего — разрез по слоям дал бы
стори-селектор без потребителя. Путь `/statuses/types/` читается как «типы
статусов», и контракт ещё никем не потреблён. Ни scope-гейта, ни параметров:
справочник глобален.
"""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.services import PermissionService
from apps.operations.statuses.api.serializers import (
    BulkStatusCreateSerializer,
    EmployeeStatusListResponseSerializer,
    EmployeeStatusRowSerializer,
    StatusListFilterSerializer,
    StatusTypeSerializer,
)
from apps.operations.statuses.selectors import (
    EmployeeStatusSelector,
    StatusTypeSelector,
)
from apps.operations.statuses.services import bulk_create_statuses

_BULK_PERMISSION = "status.manage"
# Чтение — существующий код прав, новых не заводим (реестр прав — закрытый
# список). Тот же код гейтит светофор-дерево 10.3a.
_READ_PERMISSION = "status.view"


class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST bulk — создание; GET list — статусы на дату; GET types — каталог."""

    permission_map = {
        "bulk": _BULK_PERMISSION,
        "list": _READ_PERMISSION,
        "types": _READ_PERMISSION,
    }
    # Экшен вне карты — 403 (миксин fail-closed), а не открытый роут.
    http_method_names = ["get", "post", "options"]

    @extend_schema(
        parameters=[StatusListFilterSerializer],
        responses={200: EmployeeStatusListResponseSerializer},
        description=(
            "Живые статусные записи подразделения на дату — источник "
            "предзаполнения грида. Отдаёт ТОЛЬКО реальные записи: сотрудник "
            "без строки трактуется потребителем как derived «В строю». "
            "400 нет/невалидны business_date|division_id; 403 нет права "
            "status.view / дивизион вне scope; 404 дивизион не существует."
        ),
    )
    def list(self, request, *args, **kwargs):
        form = StatusListFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        business_date = form.validated_data["business_date"]
        division_id = form.validated_data["division_id"]
        # Порядок гейтов: право (миксин) → scope (403) → существование (404).
        # Обратный порядок сделал бы 404 оракулом существования дивизионов для
        # скоупнутого чужака.
        if not PermissionService.has_permission(
            request.actor_id, _READ_PERMISSION, division_id=division_id
        ):
            # message не передаём — буквальное зеркало ensure_division_scope,
            # иначе 403-конверт разъедется между двумя реализациями.
            raise DomainError(
                "PERMISSION_DENIED", 403, detail={"division_id": str(division_id)}
            )
        if not CoreDivisionTreeSelector.exists(division_id):
            raise DomainError(
                "ENTITY_NOT_FOUND", 404, detail={"division_id": str(division_id)}
            )
        rows = EmployeeStatusSelector.for_division_on(business_date, division_id)
        return Response(
            {
                "business_date": business_date.isoformat(),
                "division_id": str(division_id),
                "rows": EmployeeStatusRowSerializer(rows, many=True).data,
            }
        )

    @extend_schema(
        # many=True объявляется РУКАМИ: drf-spectacular решает «список ли это»
        # по имени экшена (action == "list"), а здесь оно "types" — эвристика
        # молчит, и без override схема объявила бы 200 одиночным объектом при
        # массиве в рантайме. Случай ЗЕРКАЛЬНЫЙ ловушке 10.1b — не переносить
        # сюда extend_schema_serializer(many=False) соседа по аналогии.
        responses={200: StatusTypeSerializer(many=True)},
        description=(
            "Справочник статус-типов для выбора в гриде: активные типы в "
            "порядке (priority, code), плоский массив без пагинации. "
            "Деактивированные типы НЕ отдаются — предложить оператору тип, "
            "который отвергнет создание, значит поставить тихую ловушку "
            "(историческая подпись деактивированного типа резолвится не "
            "здесь, а в снапшоте сдачи). 403 нет права status.view."
        ),
    )
    @action(detail=False, methods=["get"], url_path="types", url_name="types")
    def types(self, request, *args, **kwargs):
        return Response(
            StatusTypeSerializer(StatusTypeSelector.catalog(), many=True).data
        )

    @extend_schema(
        request=BulkStatusCreateSerializer,
        responses={
            201: inline_serializer(
                name="BulkStatusCreateResponse",
                fields={"created": serializers.IntegerField()},
            )
        },
        description=(
            "Массовое создание статусов-отклонений одним вызовом (FR-12). "
            "403 нет права status.manage / сотрудник вне scope оператора; "
            "400 структурная ошибка payload (дубль/пропуск ключа/пустой/тип/"
            "cap); 409 soft-пересечение (details.rows[]); 422 hard-пересечение "
            "/ интервал / уволен (details.rows[]). Успех → {created: N}."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk", url_name="bulk")
    def bulk(self, request, *args, **kwargs):
        form = BulkStatusCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # Scope — множество разрешённых дивизионов из RBAC актора (НЕ одна
        # division: bulk охватывает разные подразделения, сервис 3.8 энфорсит
        # per-row). None = безскоуповый/wildcard грант → все дивизионы (сервис
        # ждёт множество, None уронил бы TypeError). ARCH-003: читаем core через
        # селектор, не Division.objects из operations.
        allowed = PermissionService.visible_division_ids(
            request.actor_id, _BULK_PERMISSION
        )
        if allowed is None:
            allowed = set(CoreDivisionTreeSelector.divisions_map().keys())
        created = bulk_create_statuses(
            form.validated_data["rows"],
            # ARCH-SEC-030: actor из auth-контракта, не из payload.
            actor=request.actor_id,
            business_date=form.validated_data["business_date"],
            allowed_division_ids=allowed,
        )
        return Response({"created": len(created)}, status=status.HTTP_201_CREATED)
