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
from organization_management.apps.ops import analytics as analytics_service
from organization_management.apps.ops import ratings as ratings_service
from organization_management.apps.ops import reports as reports_service
from organization_management.apps.operations.api.permissions import (
    effective_permissions,
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


# ── План дежурств ───────────────────────────────────────────────────────────

from organization_management.apps.ops import duties as duty_service

_READ_DUTY_PERMISSION = "duty.view"
_MANAGE_DUTY_PERMISSION = "duty.manage"
_APPROVE_DUTY_PERMISSION = "duty.approve_plan"


def _duty_rights(request):
    perms = effective_permissions(request)
    return {
        "canManage": "*" in perms or _MANAGE_DUTY_PERMISSION in perms,
        "canApprove": "*" in perms or _APPROVE_DUTY_PERMISSION in perms,
    }


class DutyTypeViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/duty-types/ — реестр видов + действующая политика."""

    permission_map = {"list": _READ_DUTY_PERMISSION}

    def list(self, request):
        from organization_management.apps.operations.models_duty import (
            OpsDutyType,
        )

        return Response(
            {
                "results": [
                    duty_service.serialize_duty_type(t)
                    for t in OpsDutyType.objects.all()
                ],
                "conflictPolicy": duty_service.read_conflict_policy(),
            }
        )


class DutyMonthlyPlanViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/duty-monthly-plan/ — месячный план одним ответом + lifecycle.

    Права шапки — настоящие: список действий строится по RBAC актора, и
    причина недоступной кнопки называет недостающее право.
    """

    permission_map = {
        "list": _READ_DUTY_PERMISSION,
        "draft": _MANAGE_DUTY_PERMISSION,
        "check": _MANAGE_DUTY_PERMISSION,
        "approve": _APPROVE_DUTY_PERMISSION,
        "reopen": _APPROVE_DUTY_PERMISSION,
    }

    def list(self, request):
        month = (
            request.query_params.get("month")
            or Clock.today_local().isoformat()[:7]
        )
        return Response(
            duty_service.monthly_plan_response(month, _duty_rights(request))
        )

    @action(detail=False, methods=["post"], url_path="draft")
    def draft(self, request):
        record = duty_service.create_draft((request.data or {}).get("month"))
        return Response(duty_service.serialize_plan(record), status=201)

    @action(detail=False, methods=["post"], url_path="check")
    def check(self, request):
        record = duty_service.check_plan((request.data or {}).get("month"))
        return Response(duty_service.serialize_plan(record))

    @action(detail=False, methods=["post"], url_path="approve")
    def approve(self, request):
        record = duty_service.approve_plan(
            (request.data or {}).get("month"),
            actor=resolve_actor_id(request),
        )
        return Response(duty_service.serialize_plan(record))

    @action(detail=False, methods=["post"], url_path="reopen")
    def reopen(self, request):
        record = duty_service.reopen_plan((request.data or {}).get("month"))
        return Response(duty_service.serialize_plan(record))


class DutyShiftViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/duty-shifts/ — смены и линейный цикл исполнения."""

    permission_map = {
        "list": _READ_DUTY_PERMISSION,
        "retrieve": _READ_DUTY_PERMISSION,
        "create": _MANAGE_DUTY_PERMISSION,
        "cancel": _MANAGE_DUTY_PERMISSION,
        # Отметки исполнения — не планирование: ими живёт дежурная смена.
        "acknowledge": _MANAGE_DUTY_PERMISSION,
        "clock_in": _MANAGE_DUTY_PERMISSION,
        "clock_out": _MANAGE_DUTY_PERMISSION,
    }

    def list(self, request):
        from organization_management.apps.operations.models_duty import (
            OpsDutyShift,
        )

        shifts = list(OpsDutyShift.objects.all())
        return Response(
            {
                "results": [duty_service.serialize_shift(s) for s in shifts],
                "passportStatuses": [
                    duty_service.passport_status_of(s) for s in shifts
                ],
            }
        )

    def retrieve(self, request, pk=None):
        return Response(duty_service.shift_detail(pk))

    def create(self, request):
        data = request.data or {}
        shift = duty_service.create_shift(
            business_date=data.get("businessDate"),
            duty_type_code=data.get("dutyTypeCode"),
            object_id=data.get("objectId"),
            sector_id=data.get("sectorId"),
            post_id=data.get("postId"),
            employee_id=data.get("employeeId"),
            note=data.get("note"),
            override=data.get("override"),
            override_reason=data.get("override_reason"),
            actor=resolve_actor_id(request),
        )
        return Response(duty_service.serialize_shift(shift), status=201)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        shift = duty_service.cancel_shift(
            pk,
            reason=(request.data or {}).get("reason"),
            actor=resolve_actor_id(request),
        )
        return Response(duty_service.serialize_shift(shift))

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request, pk=None):
        return Response(
            duty_service.serialize_shift(duty_service.acknowledge_shift(pk))
        )

    @action(detail=True, methods=["post"], url_path="clock-in")
    def clock_in(self, request, pk=None):
        return Response(
            duty_service.serialize_shift(duty_service.clock_in_shift(pk))
        )

    @action(detail=True, methods=["post"], url_path="clock-out")
    def clock_out(self, request, pk=None):
        return Response(
            duty_service.serialize_shift(duty_service.clock_out_shift(pk))
        )


class DutyPlanObjectsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/duty-plan-objects/?date= — объекты формы создания,
    уже разрешённые на дату (посты — из действующей версии паспорта)."""

    permission_map = {"list": _MANAGE_DUTY_PERMISSION}

    def list(self, request):
        date = _parse_business_date(request.query_params.get("date"))
        return Response(
            {
                "businessDate": date.isoformat(),
                "results": duty_service.plan_objects(date),
            }
        )


class DutyCandidatesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/duty-candidates/?date= — кандидаты с признаком занятости."""

    permission_map = {"list": _MANAGE_DUTY_PERMISSION}

    def list(self, request):
        date = _parse_business_date(request.query_params.get("date"))
        return Response(
            {
                "businessDate": date.isoformat(),
                "results": duty_service.duty_candidates(date),
            }
        )


def _parse_business_date(raw):
    import datetime as _dt

    if not raw:
        return Clock.today_local()
    try:
        return _dt.date.fromisoformat(raw)
    except ValueError:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"date": ["Укажите дату в формате ГГГГ-ММ-ДД."]},
            message="Проверьте параметры запроса.",
        )


# ── Боевые группы на Трассе ────────────────────────────────────────────────

from organization_management.apps.ops import combat as combat_service


class CombatDutyTypeViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": _READ_DUTY_PERMISSION}

    def list(self, request):
        from organization_management.apps.operations.models_combat import (
            OpsCombatDutyType,
        )

        return Response(
            {
                "results": [
                    {
                        "dutyTypeCode": t.duty_type_code,
                        "safeLabel": t.safe_label,
                        "supportsMultipleRoutes": t.supports_multiple_routes,
                    }
                    for t in OpsCombatDutyType.objects.all()
                ]
            }
        )


class CombatRouteViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": _READ_DUTY_PERMISSION}

    def list(self, request):
        from organization_management.apps.operations.models_combat import (
            OpsCombatRoute,
        )

        return Response(
            {
                "results": [
                    {"routeId": r.route_code, "safeLabel": r.safe_label}
                    for r in OpsCombatRoute.objects.all()
                ]
            }
        )


class CombatRosterCandidatesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Кандидаты в состав — из живых кадровых записей (просмотр — часть
    подачи §24.6, потому право управления, не чтения)."""

    permission_map = {"list": _MANAGE_DUTY_PERMISSION}

    def list(self, request):
        from organization_management.apps.employees.models import Employee
        from organization_management.apps.ops.security_events import (
            personnel_display_name,
        )

        results = []
        for employee in (
            Employee.objects.filter(is_active=True)
            .select_related("staff_unit__division")
            .order_by("last_name", "first_name", "id")
        ):
            try:
                staff_unit = employee.staff_unit
            except Employee.staff_unit.RelatedObjectDoesNotExist:
                staff_unit = None
            results.append(
                {
                    "employeeName": personnel_display_name(employee),
                    "unitName": (
                        staff_unit.division.name
                        if staff_unit is not None and staff_unit.division
                        else ""
                    ),
                }
            )
        return Response({"results": results})


class CombatDutyShiftViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/combat-duty-shifts/ — смены боевых групп, процесс §24.1."""

    permission_map = {
        "list": _READ_DUTY_PERMISSION,
        "create": _MANAGE_DUTY_PERMISSION,
        "submit": _MANAGE_DUTY_PERMISSION,
        "review": _MANAGE_DUTY_PERMISSION,
        "acknowledge": _MANAGE_DUTY_PERMISSION,
        "check_in": _MANAGE_DUTY_PERMISSION,
        "handover": _MANAGE_DUTY_PERMISSION,
        "complete": _MANAGE_DUTY_PERMISSION,
        "replace": _MANAGE_DUTY_PERMISSION,
    }

    def _response(self, shift, status=200):
        return Response(
            combat_service.serialize_combat_shift(shift), status=status
        )

    def list(self, request):
        from organization_management.apps.operations.models_combat import (
            OpsCombatDutyShift,
        )

        return Response(
            {
                "results": [
                    combat_service.serialize_combat_shift(s)
                    for s in OpsCombatDutyShift.objects.all()
                ]
            }
        )

    def create(self, request):
        data = request.data or {}
        shift = combat_service.create_shift(
            business_date=data.get("businessDate"),
            duty_type_code=data.get("dutyTypeCode"),
            route_ids=data.get("routeIds"),
            coverage_mode=data.get("coverageMode"),
            required_employees=data.get("requiredEmployees"),
        )
        return self._response(shift, status=201)

    def _actor_unit(self, request):
        """Подразделение подающего — из живой кадровой записи актора."""
        from organization_management.apps.employees.models import Employee

        user = getattr(request, "user", None)
        employee = (
            Employee.objects.filter(user=user)
            .select_related("staff_unit__division")
            .first()
            if user is not None and user.is_authenticated
            else None
        )
        if employee is None:
            return ""
        try:
            staff_unit = employee.staff_unit
        except Employee.staff_unit.RelatedObjectDoesNotExist:
            return ""
        return (
            staff_unit.division.name
            if staff_unit is not None and staff_unit.division
            else ""
        )

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.submit_roster(
                pk,
                group_leader=data.get("groupLeaderEmployeeName"),
                members=data.get("memberEmployeeNames"),
                reserve=data.get("reserveEmployeeNames"),
                submitted_by_unit=self._actor_unit(request),
            )
        )

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.review_roster(
                pk,
                decision=data.get("decision"),
                return_reason=data.get("returnReason"),
            )
        )

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.acknowledge(
                pk, employee_name=data.get("employeeName")
            )
        )

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        return self._response(combat_service.check_in(pk))

    @action(detail=True, methods=["post"], url_path="handover")
    def handover(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.submit_handover(
                pk,
                unresolved_incidents=data.get("unresolvedIncidents"),
                remarks=data.get("remarks"),
                confirmed_by=data.get("confirmedByEmployeeName"),
            )
        )

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.complete(
                pk, actual_member_names=data.get("actualMemberNames")
            )
        )

    @action(detail=True, methods=["post"], url_path="replace")
    def replace(self, request, pk=None):
        data = request.data or {}
        return self._response(
            combat_service.replace_member(
                pk,
                outgoing=data.get("outgoingEmployeeName"),
                incoming=data.get("incomingEmployeeName"),
                reason_code=data.get("reasonCode"),
                safe_comment=data.get("safeComment"),
            )
        )


# ── Настройки, справочники и аудит раздела ОМ ──────────────────────────────

from organization_management.apps.ops import dictionaries as dict_service
from organization_management.apps.ops import settings_service


class OpsSettingsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/settings/ — настройки-политики; право правки решает сервер
    по-записно (замок правила vs нехватка права — разные причины)."""

    permission_map = {
        "list": "settings.view",
        "partial_update": "settings.manage",
    }
    lookup_value_regex = r"[^/]+"

    def _can_manage(self, request):
        perms = effective_permissions(request)
        return "*" in perms or "settings.manage" in perms

    def list(self, request):
        from organization_management.apps.operations.models_settings import (
            OpsPolicySetting,
        )

        can_manage = self._can_manage(request)
        return Response(
            {
                "results": [
                    settings_service.serialize_setting(
                        s, can_manage=can_manage
                    )
                    for s in OpsPolicySetting.objects.all()
                ],
                "sectionVersions": settings_service.section_versions(),
            }
        )

    def partial_update(self, request, pk=None):
        data = request.data or {}
        setting, _, event = settings_service.update_setting(
            pk,
            value=data.get("value"),
            reason=data.get("reason"),
            actor=resolve_actor_id(request),
        )
        return Response(
            {
                "setting": settings_service.serialize_setting(
                    setting, can_manage=True
                ),
                "sectionVersions": settings_service.section_versions(),
                "event": settings_service.serialize_event(event),
            }
        )


class OpsSettingChangesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/setting-changes/ — журнал изменений настроек (готовые
    подписи значений, версия политики после изменения)."""

    permission_map = {"list": "settings.view"}

    def list(self, request):
        from organization_management.apps.operations.models_settings import (
            OpsSettingChangeEvent,
        )

        return Response(
            {
                "results": [
                    settings_service.serialize_event(e)
                    for e in OpsSettingChangeEvent.objects.all()[:200]
                ]
            }
        )


class OpsDictionariesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/dictionaries/ — generic-реестр значений справочников."""

    permission_map = {
        "list": "dictionary.view",
        "entries": "dictionary.view",
        "create_entry": "dictionary.manage",
        "set_active": "dictionary.manage",
        "delete_entry": "dictionary.manage",
    }

    def list(self, request):
        return Response({"results": dict_service.definitions_with_counts()})

    @action(
        detail=False,
        methods=["get", "post"],
        url_path=r"(?P<code>[A-Z_]+)/entries",
    )
    def entries(self, request, code=None):
        if request.method == "GET":
            return Response({"results": dict_service.list_entries(code)})
        # POST — заведение значения: гейт правки строже гейта чтения, и его
        # держит карта прав через отдельное имя действия ниже.
        return self.create_entry(request, code=code)

    def create_entry(self, request, code=None):
        # RequirePermissionMixin гейтит по self.action="entries" (см. выше),
        # поэтому право правки проверяется здесь явно.
        perms = effective_permissions(request)
        if "*" not in perms and "dictionary.manage" not in perms:
            raise DomainError(
                "PERMISSION_DENIED", 403,
                message="Нужно право управления справочниками.",
            )
        data = request.data or {}
        entry = dict_service.create_entry(
            code,
            code=data.get("code"),
            label=data.get("label"),
            description=data.get("description"),
            group_code=data.get("groupCode"),
            actor=resolve_actor_id(request),
        )
        return Response(dict_service.serialize_entry(entry), status=201)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"entries/(?P<entry_id>[^/]+)/set-active",
    )
    def set_active(self, request, entry_id=None):
        entry = dict_service.set_entry_active(
            entry_id,
            is_active=(request.data or {}).get("isActive"),
            actor=resolve_actor_id(request),
        )
        return Response(dict_service.serialize_entry(entry))

    @action(
        detail=False,
        methods=["delete"],
        url_path=r"entries/(?P<entry_id>[^/]+)",
    )
    def delete_entry(self, request, entry_id=None):
        dict_service.delete_entry(
            entry_id, actor=resolve_actor_id(request)
        )
        return Response(status=204)


class OpsAuditLogViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/audit-logs/ — read-only журнал действий раздела в форме
    контракта клиента; свежие сверху, последние 200 (экран — лента, полная
    выборка живёт в /api/operations/audit-logs/ с пагинацией)."""

    permission_map = {"list": "audit.view"}

    def list(self, request):
        from organization_management.apps.operations.models_audit import (
            OpsAuditLog,
        )

        rows = OpsAuditLog.objects.order_by("-created_at", "-id")[:200]
        return Response(
            {
                "results": [
                    {
                        "id": str(row.pk),
                        "actorUserId": row.actor_user_id,
                        "action": row.action,
                        "entityType": row.entity_type,
                        "entityId": str(row.entity_id),
                        "oldValue": row.old_value,
                        "newValue": row.new_value,
                        "reason": row.reason,
                        "createdAt": row.created_at.isoformat(),
                    }
                    for row in rows
                ]
            }
        )


# ── Оперативный рейтинг (§19, §22.16-22.17) ─────────────────────────────────


class OperationalRatingsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/operational-ratings/ — сводка агрегатов (§19.19)."""

    permission_map = {"list": ratings_service.VIEW_AGGREGATE_PERMISSION}

    def list(self, request):
        return Response(ratings_service.list_operational_ratings())


class OperationalRatingDynamicsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/operational-rating-dynamics/?employee= — ряд точек
    (§19.20). Право то же, что у сводки: динамика — это агрегаты."""

    permission_map = {"list": ratings_service.VIEW_AGGREGATE_PERMISSION}

    def list(self, request):
        return Response(
            ratings_service.rating_dynamics(
                request.query_params.get("employee")
            )
        )


class OperationalRatingEmployeeViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/operational-rating-employee/?employee= — карточка при
    праве только на агрегат (§19.17): без единого закрытого поля."""

    permission_map = {"list": ratings_service.VIEW_AGGREGATE_PERMISSION}

    def list(self, request):
        return Response(
            ratings_service.rating_employee_detail(
                request.query_params.get("employee")
            )
        )


class RatingAnalyticsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/rating-analytics/ — отчёт §22.16. Право РАЗДЕЛА
    АНАЛИТИКИ, а не право сводки: доступ к отчёту решает аналитика."""

    permission_map = {"list": ratings_service.VIEW_ANALYTICS_PERMISSION}

    def list(self, request):
        return Response(ratings_service.rating_analytics())


class EvaluationWorkspaceViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/evaluation-workspace/?event= — очередь оценщика
    (§19.14). Очередь отбирается по актору на сервере."""

    permission_map = {"list": ratings_service.EVALUATE_PERMISSION}

    def list(self, request):
        return Response(
            ratings_service.evaluation_workspace(
                resolve_actor_id(request),
                effective_permissions(request),
                request.query_params.get("event"),
            )
        )


class EvaluationWorkItemViewSet(viewsets.ViewSet):
    """Строка задания: /api/ops/evaluation-work-items/{id}/submit|correct|
    detail/.

    БЕЗ RequirePermissionMixin осознанно: §19.27 требует фиксировать в
    журнале оценивания и ЗАПРЕЩЁННЫЕ попытки (отказ по праву, чужая запись),
    а гейт миксина отвечал бы раньше, чем сервис успел бы записать отказ.
    Право проверяет сервис — первым действием, до любых данных.
    """

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        return Response(
            ratings_service.submit_evaluation(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                request.data,
            ),
            status=201,
        )

    @action(detail=True, methods=["post"], url_path="correct")
    def correct(self, request, pk=None):
        return Response(
            ratings_service.correct_evaluation(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                request.data,
            ),
            status=201,
        )

    @action(detail=True, methods=["get"], url_path="detail")
    def detail_view(self, request, pk=None):
        return Response(
            ratings_service.submitted_evaluation_detail(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )


class EvaluationRegistryViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/evaluation-registry/ — реестр итоговых оценок
    (§19.15-19.16): строки без закрытых величин, отбор и страница на
    сервере."""

    permission_map = {"list": ratings_service.VIEW_AGGREGATE_PERMISSION}

    def list(self, request):
        params = request.query_params
        try:
            page = int(params.get("page", "1"))
        except (TypeError, ValueError):
            page = 1
        return Response(
            ratings_service.evaluation_registry({
                "from": params.get("from"),
                "to": params.get("to"),
                "event": params.get("event"),
                "unit": params.get("unit"),
                "employee": params.get("employee"),
                "direction": params.get("direction"),
                "method": params.get("method"),
                "correctedOnly": params.get("corrected") == "true",
                "search": params.get("search") or "",
                "page": page,
            })
        )


class RatingAuditViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/rating-audit/?page= — журнал оценивания (§19.27).
    Право СВОЁ: контроль над действиями людей — не то же, что участие."""

    permission_map = {"list": ratings_service.VIEW_AUDIT_PERMISSION}

    def list(self, request):
        try:
            page = int(request.query_params.get("page", "1"))
        except (TypeError, ValueError):
            page = 1
        return Response(ratings_service.rating_audit(page))


class RatingNotificationsViewSet(viewsets.ViewSet):
    """GET /api/ops/rating-notifications/ — только СВОИ (§19.28). Права
    нет намеренно: отбор по адресату — и есть право прочитать."""

    def list(self, request):
        return Response(
            ratings_service.rating_notifications(resolve_actor_id(request))
        )


class RatingExportsViewSet(viewsets.ViewSet):
    """/api/ops/rating-exports/ (GET+POST) и {id}/cancel/ (§19.29).

    Без миксина по той же причине, что у заданий: отказ по праву на заказ
    выгрузки — событие журнала оценивания, и писать его должен сервис.
    """

    def list(self, request):
        return Response(
            ratings_service.list_rating_exports(
                resolve_actor_id(request), effective_permissions(request)
            )
        )

    def create(self, request):
        return Response(
            ratings_service.create_rating_export(
                resolve_actor_id(request),
                effective_permissions(request),
                request.data,
            ),
            status=201,
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        return Response(
            ratings_service.cancel_rating_export(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )


class RatingExportArtifactsViewSet(viewsets.ViewSet):
    """POST /api/ops/rating-export-artifacts/{id}/download/ — выдача файла
    (§19.29): отдельная операция, повторно проверяющая право и состояние."""

    @action(detail=True, methods=["post"], url_path="download")
    def download(self, request, pk=None):
        return Response(
            ratings_service.download_rating_export(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )


# ── Аналитика службы и мероприятий (§22) ────────────────────────────────────


class ServiceAnalyticsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/service-analytics/ — снимок показателей §22.4/§22.7."""

    permission_map = {"list": analytics_service.VIEW_PERMISSION}

    def list(self, request):
        params = request.query_params
        return Response(
            analytics_service.service_analytics(
                effective_permissions(request),
                {
                    # Пустая строка и отсутствующий параметр — одно и то же:
                    # ?preset= появляется при сбросе фильтра.
                    "presetCode": params.get("preset") or None,
                    "from": params.get("from") or "",
                    "to": params.get("to") or "",
                },
            )
        )


class ServiceAnalyticsPresetsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/service-analytics-presets/ — пресеты §22.5 и предел
    произвольного периода из «Настроек»."""

    permission_map = {"list": analytics_service.VIEW_PERMISSION}

    def list(self, request):
        return Response(analytics_service.list_presets())


class ServiceAnalyticsDrilldownViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/service-analytics-drilldown/ — выборка §22.12. Право
    drill-down проверяет сервис ВТОРЫМ: переход со своего же дашборда доступа
    не подтверждает."""

    permission_map = {"list": analytics_service.VIEW_PERMISSION}

    def list(self, request):
        params = request.query_params
        return Response(
            analytics_service.drilldown(
                effective_permissions(request),
                {
                    "snapshotId": params.get("snapshot_id") or "",
                    "metricCode": params.get("metric_code") or "",
                    "presetCode": params.get("preset") or None,
                    "from": params.get("from") or "",
                    "to": params.get("to") or "",
                    "cursor": params.get("cursor") or None,
                },
            )
        )


class ServiceAnalyticsAttentionViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/service-analytics-attention/ — блок §22.11: свои
    детекторы, политика из «Настроек», свой policyVersion."""

    permission_map = {"list": analytics_service.VIEW_PERMISSION}

    def list(self, request):
        params = request.query_params
        return Response(
            analytics_service.attention({
                "presetCode": params.get("preset") or None,
                "from": params.get("from") or "",
                "to": params.get("to") or "",
            })
        )


class LoadAnalyticsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/load-analytics/ — нагрузка §22.9: план и факт разными
    полями, состояние красится только по плану, пороги из LOAD_POLICY."""

    permission_map = {"list": analytics_service.VIEW_PERMISSION}

    def list(self, request):
        return Response(analytics_service.load_analytics())


class OperationsAnalyticsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/operations-analytics/ — уровни §22.15 и воронка §22.14.
    Право СВОЁ: §22.26 перечисляет аналитику службы и аналитику ОМ разными
    пунктами."""

    permission_map = {"list": analytics_service.OPS_VIEW_PERMISSION}

    def list(self, request):
        params = request.query_params
        return Response(
            analytics_service.operations_analytics({
                "level": params.get("level") or "ALL",
                "objectId": params.get("object_id"),
                "eventId": params.get("event_id"),
                "directionId": params.get("direction_id"),
                "postId": params.get("post_id"),
            })
        )


# ── Служебные отчёты (§22.18-22.28) ─────────────────────────────────────────


class ServiceReportTypesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/service-report-types/ — каталог типов с пределами из
    «Настроек» и политикой маскирования (§22.19/§22.24)."""

    permission_map = {"list": reports_service.GENERATE_PERMISSION}

    def list(self, request):
        return Response(
            reports_service.list_report_types(effective_permissions(request))
        )


class ServiceReportJobsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/service-report-jobs/ — реестр работ, создание, карточка,
    повтор и новая редакция (§22.21/§22.25/§22.27).

    Все действия под правом запуска отчётов; sensitive-право и право на
    параметры чужого запуска проверяет сервис по-записно.
    """

    permission_map = {
        "list": reports_service.GENERATE_PERMISSION,
        "retrieve": reports_service.GENERATE_PERMISSION,
        "create": reports_service.GENERATE_PERMISSION,
        "retry": reports_service.GENERATE_PERMISSION,
        "new_revision": reports_service.GENERATE_PERMISSION,
    }

    def list(self, request):
        params = request.query_params
        return Response(
            reports_service.list_report_jobs(
                resolve_actor_id(request),
                effective_permissions(request),
                {
                    "state": params.get("state") or None,
                    "mine": params.get("mine") == "true",
                },
            )
        )

    def retrieve(self, request, pk=None):
        return Response(
            reports_service.get_report_job(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )

    def create(self, request):
        return Response(
            reports_service.create_report_job(
                resolve_actor_id(request),
                effective_permissions(request),
                request.data,
            )
        )

    @action(detail=True, methods=["post"], url_path="retry")
    def retry(self, request, pk=None):
        return Response(
            reports_service.rerun_report_job(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                "RETRY",
            )
        )

    @action(detail=True, methods=["post"], url_path="new-revision")
    def new_revision(self, request, pk=None):
        return Response(
            reports_service.rerun_report_job(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                "NEW_REVISION",
            )
        )


class ServiceReportArtifactsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST /api/ops/service-report-artifacts/{id}/download/ — выдача файла
    (§22.23): отдельная операция с повторной проверкой прав и срока."""

    permission_map = {"download": reports_service.GENERATE_PERMISSION}

    @action(detail=True, methods=["post"], url_path="download")
    def download(self, request, pk=None):
        return Response(
            reports_service.download_artifact(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )
