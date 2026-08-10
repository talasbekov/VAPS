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


# ── Охранные мероприятия ────────────────────────────────────────────────────

from organization_management.apps.ops import security_events as event_service
from organization_management.apps.ops.api.serializers import (
    serialize_security_event,
)

_READ_EVENT_PERMISSION = "event.view"
_MANAGE_EVENT_PERMISSION = "event.manage"


class SecurityEventViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/security-events/ — реестр и жизненный цикл ОМ.

    ViewSet без дженериков: список несёт свой конверт с фильтрами и
    постраничкой контракта (page/page_size, next/previous — НОМЕРА страниц,
    не URL), а вся бизнес-логика стадий живёт в security_events.py — вьюха
    только разбирает вход и переводит агрегат в форму контракта.
    """

    permission_map = {
        "list": _READ_EVENT_PERMISSION,
        "retrieve": _READ_EVENT_PERMISSION,
        "create": _MANAGE_EVENT_PERMISSION,
        "bindable_objects": _MANAGE_EVENT_PERMISSION,
        "bulletin": _MANAGE_EVENT_PERMISSION,
        "bulletin_complete": _MANAGE_EVENT_PERMISSION,
        "recon": _MANAGE_EVENT_PERMISSION,
        "recon_import": _MANAGE_EVENT_PERMISSION,
        "recon_complete": _MANAGE_EVENT_PERMISSION,
        "demand_approve": _MANAGE_EVENT_PERMISSION,
        "force_allocation": _MANAGE_EVENT_PERMISSION,
        "forces_complete": _MANAGE_EVENT_PERMISSION,
        "placement_assign": _MANAGE_EVENT_PERMISSION,
        "placement_unassign": _MANAGE_EVENT_PERMISSION,
        "placement_complete": _MANAGE_EVENT_PERMISSION,
        "approval_approve": _MANAGE_EVENT_PERMISSION,
        "approval_return": _MANAGE_EVENT_PERMISSION,
        "acknowledge": _MANAGE_EVENT_PERMISSION,
        "acknowledgement_complete": _MANAGE_EVENT_PERMISSION,
        "journal": _MANAGE_EVENT_PERMISSION,
        "conduct_replace": _MANAGE_EVENT_PERMISSION,
        "close": _MANAGE_EVENT_PERMISSION,
    }
    http_method_names = ["get", "post", "patch", "delete", "options"]

    def _event_response(self, event, status=200):
        return Response(serialize_security_event(event), status=status)

    def list(self, request):
        from organization_management.apps.operations.models_event import (
            OpsSecurityEvent,
        )

        search = (request.query_params.get("search") or "").strip().lower()
        stage = request.query_params.get("stage") or None
        try:
            page = max(int(request.query_params.get("page", "1")), 1)
        except ValueError:
            page = 1
        try:
            page_size = max(int(request.query_params.get("page_size", "20")), 1)
        except ValueError:
            page_size = 20

        rows = list(OpsSecurityEvent.objects.all())
        if stage:
            rows = [e for e in rows if e.stage == stage]
        if search:
            rows = [
                e
                for e in rows
                if search
                in f"{e.title} {e.code} {e.object_name} {e.owner_name}".lower()
            ]
        start = (page - 1) * page_size
        return Response(
            {
                "count": len(rows),
                "next": str(page + 1) if start + page_size < len(rows) else None,
                "previous": str(page - 1) if page > 1 else None,
                "results": [
                    serialize_security_event(e)
                    for e in rows[start : start + page_size]
                ],
            }
        )

    def retrieve(self, request, pk=None):
        from organization_management.apps.operations.models_event import (
            OpsSecurityEvent,
        )

        event = (
            OpsSecurityEvent.objects.filter(pk=pk).first()
            if str(pk).isdigit()
            else None
        )
        if event is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"id": str(pk)},
                message="Мероприятие не найдено.",
            )
        return self._event_response(event)

    def create(self, request):
        data = request.data or {}
        event = event_service.create_event(
            title=data.get("title"),
            object_id=data.get("objectId"),
            business_date=data.get("businessDate"),
            actor=resolve_actor_id(request),
        )
        return self._event_response(event, status=201)

    # bindable-objects раньше детали в роутере не нужен: у DRF detail-роут
    # матчит только числовые pk не раньше list-экшенов.
    @action(detail=False, methods=["get"], url_path="bindable-objects")
    def bindable_objects(self, request):
        results = [
            {
                "id": str(o.pk),
                "name": o.name,
                "code": o.code,
                "publishedVersionCount": o.passport_versions.count(),
            }
            for o in OpsSecurityObject.objects.prefetch_related(
                "passport_versions"
            )
        ]
        return Response({"results": results})

    # ── Стадии ──────────────────────────────────────────────────────────

    @action(detail=True, methods=["patch"], url_path="bulletin")
    def bulletin(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.update_bulletin(
                pk,
                brief_description=data.get("briefDescription"),
                initial_tasks=data.get("initialTasks"),
            )
        )

    @action(detail=True, methods=["post"], url_path="bulletin/complete")
    def bulletin_complete(self, request, pk=None):
        return self._event_response(event_service.complete_bulletin(pk))

    @action(detail=True, methods=["patch"], url_path="recon")
    def recon(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.update_recon(
                pk,
                checklist=data.get("checklist"),
                sector_posts=data.get("sectorPosts"),
            )
        )

    @action(detail=True, methods=["post"], url_path="recon/import-from-passport")
    def recon_import(self, request, pk=None):
        return self._event_response(event_service.import_recon_from_passport(pk))

    @action(detail=True, methods=["post"], url_path="recon/complete")
    def recon_complete(self, request, pk=None):
        return self._event_response(event_service.complete_recon(pk))

    @action(detail=True, methods=["post"], url_path="demand/approve")
    def demand_approve(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.approve_demand(pk, rows=data.get("rows"))
        )

    @action(
        detail=True,
        methods=["patch"],
        # lookahead: слово complete — не id запроса; порядок регистрации extra-
        # actions у DRF алфавитный, и без него forces/complete/ съедался бы
        # этим маршрутом (ровно та же ловушка, что у path-to-regexp в моке).
        url_path=r"forces/(?P<request_id>(?!complete/)[^/]+)",
    )
    def force_allocation(self, request, pk=None, request_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.update_force_allocation(
                pk,
                request_id,
                allocated_count=data.get("allocatedCount", 0),
                comment=data.get("comment"),
            )
        )

    @action(detail=True, methods=["post"], url_path="forces/complete")
    def forces_complete(self, request, pk=None):
        return self._event_response(event_service.complete_forces(pk))

    @action(detail=True, methods=["post"], url_path="placement/assign")
    def placement_assign(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.assign_placement(
                pk,
                post_id=data.get("postId"),
                employee_id=data.get("employeeId"),
                override=data.get("override"),
                override_reason=data.get("override_reason"),
            )
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"placement/(?P<assignment_id>(?!assign/|complete/)[^/]+)",
    )
    def placement_unassign(self, request, pk=None, assignment_id=None):
        return self._event_response(
            event_service.unassign_placement(pk, assignment_id)
        )

    @action(detail=True, methods=["post"], url_path="placement/complete")
    def placement_complete(self, request, pk=None):
        return self._event_response(event_service.complete_placement(pk))

    @action(detail=True, methods=["post"], url_path="approval/approve")
    def approval_approve(self, request, pk=None):
        return self._event_response(event_service.approve_placement(pk))

    @action(detail=True, methods=["post"], url_path="approval/return")
    def approval_return(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.return_placement(pk, comment=data.get("comment"))
        )

    # Раздельные сегменты acknowledge/… и acknowledgement/complete — контракт
    # клиента (у мока это защита от жадного матчинга; форма пути сохранена).
    @action(
        detail=True,
        methods=["post"],
        url_path=r"acknowledge/(?P<assignment_id>[^/]+)",
    )
    def acknowledge(self, request, pk=None, assignment_id=None):
        return self._event_response(
            event_service.acknowledge_assignment(pk, assignment_id)
        )

    @action(detail=True, methods=["post"], url_path="acknowledgement/complete")
    def acknowledgement_complete(self, request, pk=None):
        return self._event_response(event_service.complete_acknowledgement(pk))

    @action(detail=True, methods=["post"], url_path="journal")
    def journal(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.add_journal_entry(
                pk,
                entry_type=data.get("type"),
                title=data.get("title"),
                description=data.get("description"),
            )
        )

    @action(detail=True, methods=["post"], url_path="conduct/replace")
    def conduct_replace(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.replace_assignment(
                pk,
                assignment_id=data.get("assignmentId"),
                incoming_employee_id=data.get("incomingEmployeeId"),
                reason_code=data.get("reasonCode"),
            )
        )

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.close_event(
                pk,
                direction_summaries=data.get("directionSummaries"),
                actor=resolve_actor_id(request),
            )
        )


class OpsPersonnelViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/personnel/ — read-only кадровый снимок для подбора
    кандидатов на расстановку: {id, name, rankLabel, unit}. Источник — живые
    кадровые записи (Employee + звание + подразделение штатной единицы), а не
    своя таблица: раздел ОМ кадры не ведёт, он их читает."""

    permission_map = {"list": _MANAGE_EVENT_PERMISSION}

    def list(self, request):
        from organization_management.apps.employees.models import Employee
        from organization_management.apps.ops.security_events import (
            personnel_display_name,
        )

        employees = (
            Employee.objects.filter(is_active=True)
            .select_related("rank", "staff_unit__division")
            .order_by("last_name", "first_name", "id")
        )
        results = []
        for employee in employees:
            # обратный OneToOne без строки бросает RelatedObjectDoesNotExist
            try:
                staff_unit = employee.staff_unit
            except Employee.staff_unit.RelatedObjectDoesNotExist:
                staff_unit = None
            unit = (
                staff_unit.division.name
                if staff_unit is not None and staff_unit.division is not None
                else ""
            )
            results.append(
                {
                    "id": str(employee.pk),
                    "name": personnel_display_name(employee),
                    "rankLabel": employee.rank.name if employee.rank else "",
                    "unit": unit,
                }
            )
        return Response({"results": results})
