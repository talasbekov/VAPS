"""Daily combat duty API; all reads and writes keep the grant's department scope."""
from datetime import timedelta
from django.db.models import Q

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.api.permissions import RequirePermissionMixin, resolve_actor_id
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.ops import combat_access as access, combat_catalogs as catalogs, combat_lifecycle as lifecycle, combat_planning as planning


class CombatCatalogViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {"list": access.READ, "create": access.CATALOG, "partial_update": access.CATALOG}
    fixed_kind = None

    def _kind(self, request):
        return self.fixed_kind or request.query_params.get("kind", request.data.get("kind", "groups") if isinstance(request.data, dict) else "groups")

    def list(self, request):
        kind = self._kind(request)
        rows = catalogs.rows(resolve_actor_id(request), kind, request.query_params.get("division_id"))
        return Response({"results": [catalogs.serialize(kind, row) for row in rows]})

    def create(self, request):
        return Response(catalogs.save(resolve_actor_id(request), self._kind(request), request.data), status=201)

    def partial_update(self, request, pk=None):
        return Response(catalogs.save(resolve_actor_id(request), self._kind(request), request.data, pk))


class CombatGroupViewSet(CombatCatalogViewSet):
    fixed_kind = "groups"


class CombatDayViewSet(RequirePermissionMixin, viewsets.ViewSet):
    permission_map = {
        "list": access.READ, "retrieve": (*access.READ, "profile.view"), "create": access.ROSTER,
        "choices": access.READ, "week": access.READ, "review": access.REVIEW, "cancel": access.ROSTER,
        "resubmit": access.ROSTER, "replace": access.ROSTER,
        "acknowledge": (*access.READ, "profile.view"), "check_in": (*access.READ, "profile.view"),
        "handover": (*access.READ, "profile.view"), "complete": (*access.READ, "profile.view"),
        "mine": (*access.READ, "profile.view"),
    }

    def permission_override(self, request):
        # Personal actions are protected by Employee.user and the roster itself,
        # just like the existing personal-duty endpoint, including plain EMPLOYEE.
        return self.action in {"mine", "retrieve", "acknowledge", "check_in", "handover", "complete"} and request.user.is_authenticated

    def _day(self, request):
        return access.business_date(request.query_params.get("date", Clock.today_local().isoformat()))

    def list(self, request):
        return Response(planning.board(resolve_actor_id(request), self._day(request), request.query_params.get("division_id")))

    def retrieve(self, request, pk=None):
        return Response(planning.serialize(planning.get_shift(resolve_actor_id(request), pk, user_id=request.user.pk, allow_self=True)))

    def create(self, request):
        return Response(planning.serialize(planning.form(resolve_actor_id(request), request.data)), status=201)

    @action(detail=False, methods=["get"])
    def choices(self, request):
        actor, selected, day = resolve_actor_id(request), request.query_params.get("division_id"), self._day(request)
        ids = access.division_ids(actor, selected)
        result = {kind: [catalogs.serialize(kind, row) for row in catalogs.rows(actor, kind, selected).filter(is_active=True)] for kind in catalogs.MODELS}
        result["divisions"] = [{"id": str(d.pk), "name": d.name, "parentId": str(d.parent_id) if d.parent_id else None} for d in access.divisions(actor).order_by("tree_id", "lft")]
        roster_scope = access.scope(actor, access.ROSTER)
        result["events"] = [{"id": str(e.pk), "title": e.title, "businessDate": e.business_date.isoformat()} for e in access.event_choices(actor, day, selected)] if roster_scope is None or bool(roster_scope & ids) else []
        from organization_management.apps.operations.models_object import OpsSecurityObject
        from organization_management.apps.operations.services import PermissionService
        result["objectChoices"] = [{"id": str(o.pk), "name": o.name} for o in OpsSecurityObject.objects.filter(object_state="ACTIVE").order_by("name")] if PermissionService.has_permission(actor, "object.view") and access.scope(actor, access.CATALOG) != set() else []
        permissions = {}
        for name, codes in [("roster", access.ROSTER), ("manageCatalogs", access.CATALOG), ("review", access.REVIEW)]:
            granted = access.scope(actor, codes)
            permitted = None if granted is None else sorted(ids & granted)
            permissions[name] = permitted is None or (int(selected) in permitted if selected else bool(permitted))
            permissions[name + "DivisionIds"] = None if permitted is None else [str(pk) for pk in permitted]
        result["permissions"] = permissions
        return Response(result)

    @action(detail=False, methods=["get"])
    def week(self, request):
        first = access.business_date(request.query_params.get("from", self._day(request).isoformat()))
        last = access.business_date(request.query_params.get("to", (first + timedelta(days=min(6, (first.max - first).days - 1))).isoformat()))
        if last < first or (last - first).days > 30:
            access.fail(message="Укажите период не длиннее 31 дня.")
        return Response({"results": [{"businessDate": (first + timedelta(days=i)).isoformat(), **planning.board(resolve_actor_id(request), first + timedelta(days=i), request.query_params.get("division_id"))["summary"]} for i in range((last - first).days + 1)]})

    @action(detail=False, methods=["get"])
    def mine(self, request):
        person = Employee.objects.filter(user_id=request.user.pk, is_active=True).first()
        if person is None:
            return Response({"results": []})
        rows = OpsCombatDutyShift.objects.filter(group__isnull=False, cancelled_at__isnull=True, members__employee=person).filter(Q(business_date__gte=Clock.today_local()) | Q(state_code="ACCEPTED", submission__execution__stateCode__in=["PENDING_ACKNOWLEDGEMENT", "READY", "ACTIVE"])).select_related("group", "division", "duty_type").prefetch_related("members").order_by("business_date", "pk")[:30]
        return Response({"results": [planning.serialize(row) for row in rows]})

    def _perform(self, request, pk, name):
        return Response(planning.serialize(lifecycle.perform(resolve_actor_id(request), pk, name, request.data, user_id=request.user.pk)))

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        return self._perform(request, pk, "review")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._perform(request, pk, "cancel")

    @action(detail=True, methods=["post"])
    def resubmit(self, request, pk=None):
        return self._perform(request, pk, "resubmit")

    @action(detail=True, methods=["post"])
    def replace(self, request, pk=None):
        return self._perform(request, pk, "replace")

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        return self._perform(request, pk, "acknowledge")

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        return self._perform(request, pk, "check_in")

    @action(detail=True, methods=["post"])
    def handover(self, request, pk=None):
        return self._perform(request, pk, "handover")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._perform(request, pk, "complete")
