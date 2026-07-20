"""Stories 5.8a/b/c — day-submission API (/api/operations/daily-submissions/).

Write and read endpoints over DomainError-raising services and selectors.
The views stay thin (layer contract, architecture.md#L442-452): coarse
permission gate (RequirePermissionMixin — the resolver is division-free) →
input form → division-scope guard (ensure_division_scope) or actor-scoped
selector (canon L451: the LIST selector narrows visibility itself, the view
never filters by rights) → domain service / projection. Errors flow through
the unified handler (no try/except, no manual error Response): the services'
own 400/404/409/422 pass as-is, and the version-race IntegrityError backstop
is already mapped to 409 DAY_ALREADY_SUBMITTED by CONSTRAINT_ERROR_MAP. The
permission gates live ONLY here — amend_day itself stays gate-free because
the 5.4b enforcement hook calls it with no HTTP actor (Ловушка №1).
"""

import logging
from datetime import timedelta

from django.db import IntegrityError
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    extend_schema,
    extend_schema_serializer,
    inline_serializer,
)
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.documents.models import EXPENSE_DOC_TYPE
from apps.documents.selectors import IssuedDocumentSelector
from apps.operations.services import PermissionService
from apps.operations.submissions.api.serializers import (
    DailySubmissionAmendSerializer,
    DailySubmissionCreateSerializer,
    DailySubmissionDetailSerializer,
    DailySubmissionFilterSerializer,
    DailySubmissionSerializer,
    ExpensePeriodFilterSerializer,
    ExpenseReportByDateFilterSerializer,
    ExpenseReportIssueSerializer,
    IssuedExpenseReportSerializer,
    TomorrowBlockOverrideSerializer,
    TrafficLightTreeFilterSerializer,
)
from apps.operations.submissions.selectors import (
    READ_PERMISSION,
    DailySubmissionSelector,
)
from apps.operations.submissions.services import (
    amend_day,
    assert_report_date_has_data,
    assert_tomorrow_not_blocked,
    derive_period,
    ensure_division_scope,
    export_submission,
    issue_expense_document,
    override_tomorrow_block,
    submit_day,
)
from apps.operations.submissions.traffic_light import (
    TrafficLightStatus,
    traffic_light_tree,
)

logger = logging.getLogger(__name__)

# Расход read/issue endpoints gate on the (already-seeded) generation right
# (Story 6.10a Д2: management reads what it issues; daily_report.view does not
# exist — decided 2026-07-02).
_EXPENSE_PERMISSION = "daily_report.generate"
# Legal bypass of the «на завтра» block — its own permission (Story 6.10b),
# distinct from generation (issuing ≠ overriding a control gate).
_OVERRIDE_PERMISSION = "daily_report.override_block"
# Upper bound on how far ahead an override may reach (Д3, review 2026-07-13):
# the override record is irrevocable (5.6b — unique per date, no revocation),
# so a year-off typo would silently pre-lift a future FR-18 block forever.
MAX_OVERRIDE_HORIZON_DAYS = 31

# One source for both gates — the coarse mixin check and the scope re-check
# must never drift onto different permission codes. The READ code is imported
# from the selector module: the list selector's visibility and the view's
# read gate share it the same way (reads = mark_update, epics 2026-07-02).
_SUBMIT_PERMISSION = "daily_report.mark_update"
_AMEND_PERMISSION = "daily_report.correct"
# Светофор-дерево (10.3a) — существующее право чтения статусов, новых кодов не
# заводим (реестры прав и ошибок — закрытые списки). Тот же код стоит на
# фронт-маршруте /organization, так что гейт бэка и гард фронта совпадают.
_TRAFFIC_LIGHT_PERMISSION = "status.view"
# Личная копия сдачи (10.8) отдаётся байтами прямо из памяти — сосед
# _DOCX_CONTENT_TYPE живёт в document_release_service (там он описывает
# СОХРАНЯЕМОЕ вложение), здесь тип нужен вью для ответа.
_XLSX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _ensure_division_exists(division_id):
    """404 for a valid-but-phantom division UUID (review 2026-07-13).

    Called AFTER the scope guard — a scoped stranger still gets 403 first,
    never an existence oracle. Without this, a global-scope actor (scope NULL
    matches anything) gets 200-with-zero-pages from /period/ and a misleading
    409 «нет сдачи» from POST for a division that does not exist.
    """
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )


# Single-object projection for OpenAPI: the list-action heuristic would wrap
# the by-date point lookup into an array otherwise (canon: rbac views 2.9).
_SingleIssuedExpenseReport = extend_schema_serializer(many=False)(
    IssuedExpenseReportSerializer
)


class DailySubmissionPagination(LimitOffsetPagination):
    """{count, next, previous, results} envelope — architecture.md#L427:
    default 50, max 200. Per-API subclass (the project sets no global
    DEFAULT_PAGINATION_CLASS), mirror of AuditLogPagination (4.5)."""

    default_limit = 50
    max_limit = 200


class DailySubmissionViewSet(RequirePermissionMixin, viewsets.ViewSet):
    # Methods outside the map fall through the mixin's early return to DRF → 405.
    permission_map = {
        "create": _SUBMIT_PERMISSION,
        "amend": _AMEND_PERMISSION,
        "list": READ_PERMISSION,
        "retrieve": READ_PERMISSION,
        # Личная копия (10.8) видит РОВНО то, что и так отдаёт retrieve —
        # значит и гейтится тем же кодом; нового права не заводим.
        "export": READ_PERMISSION,
    }
    # No "head": HEAD stays 405 everywhere (the 5.8a/b minimal surface).
    http_method_names = ["get", "post", "options"]

    def list(self, request, *args, **kwargs):
        filters = DailySubmissionFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        # validated_data holds only the params actually provided — absent
        # optional filters simply don't reach the selector.
        qs = DailySubmissionSelector.list(request.actor_id, **filters.validated_data)
        paginator = DailySubmissionPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(
            DailySubmissionSerializer(page, many=True).data
        )

    def retrieve(self, request, pk=None, *args, **kwargs):
        # A point read: the REQUESTED version, stale or current — never the
        # chain head (deliberate contrast with amend's Д1 chain semantics).
        submission = DailySubmissionSelector.by_id(pk)
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        # Same order and trade-off as amend (accepted at the 5.8b review):
        # pk resolves first, the 403 carries the server-resolved division_id.
        ensure_division_scope(request.actor_id, READ_PERMISSION, submission.division_id)
        return Response(DailySubmissionDetailSerializer(submission).data)

    def create(self, request, *args, **kwargs):
        form = DailySubmissionCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        # The mixin gate can't see the division (request.effective_permissions
        # is resolved without one); re-check the same code against the
        # payload's division subtree → 403 on someone else's division.
        ensure_division_scope(request.actor_id, _SUBMIT_PERMISSION, division_id)
        submission = submit_day(
            division_id=division_id,
            business_date=form.validated_data["business_date"],
            # ARCH-SEC-030: identity from the auth contract, never the payload.
            actor=request.actor_id,
        )
        return Response(
            DailySubmissionSerializer(submission).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        responses={(200, _XLSX_CONTENT_TYPE): OpenApiTypes.BINARY},
        description=(
            "Личная копия сданного дня (.xlsx): паспорт сдачи + состав из "
            "снапшота."
        ),
    )
    @action(detail=True, methods=["get"])
    def export(self, request, pk=None, *args, **kwargs):
        # Точечное чтение, как retrieve: экспортируется ЗАПРОШЕННАЯ версия,
        # stale или current. Голова цепочки не подставляется — «щит»
        # доказывает конкретную версию, а не последнюю.
        submission = DailySubmissionSelector.by_id(pk)
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        # Скоуп-гвард ПОСЛЕ резолва pk (порядок retrieve): 403 обязан нести
        # уже серверно-разрешённый division_id.
        ensure_division_scope(request.actor_id, READ_PERMISSION, submission.division_id)
        payload, filename = export_submission(
            submission=submission, actor=request.actor_id
        )
        # X-Accel не применяется: отдавать с диска нечего, файл существует
        # только в памяти (осознанное отличие от documents/api/views.py).
        response = HttpResponse(payload, content_type=_XLSX_CONTENT_TYPE)
        response["Content-Disposition"] = content_disposition_header(True, filename)
        return response

    @action(detail=True, methods=["post"])
    def amend(self, request, pk=None, *args, **kwargs):
        form = DailySubmissionAmendSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # {pk} identifies the chain (Д1): amend_day re-resolves the head via
        # latest_for itself, so a stale-version pk amends the same chain.
        submission = DailySubmissionSelector.by_id(pk)
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        # Scope re-check against the RESOLVED submission's division — the pk
        # resolves first, so a phantom pk is 404 to any holder (existence by
        # integer pk is enumerable; a conscious REST trade-off, cf. tests).
        ensure_division_scope(
            request.actor_id, _AMEND_PERMISSION, submission.division_id
        )
        new_version = amend_day(
            division_id=submission.division_id,
            business_date=submission.business_date,
            # ARCH-SEC-030: identity from the auth contract, never the payload.
            actor=request.actor_id,
            reason=form.validated_data["reason"],
            sanction=form.validated_data["sanction"],
            # triggered_by_status_id stays None — it is the 5.4b hook's
            # provenance ref, never a client-writable field (Ловушка №4).
        )
        return Response(
            DailySubmissionSerializer(new_version).data,
            status=status.HTTP_201_CREATED,
        )


class ExpenseReportViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Story 6.10a — расход HTTP surface: POST issue (single date) + GET by date
    + GET period (read-only page-per-date, no number). Thin views over the
    existing issue/derive services; errors flow through the unified handler.
    «На завтра»-блокировка и override — Story 6.10b.
    """

    permission_map = {
        "create": _EXPENSE_PERMISSION,
        "list": _EXPENSE_PERMISSION,
        "period": _EXPENSE_PERMISSION,
        "override_block": _OVERRIDE_PERMISSION,
    }
    # No "head": HEAD stays 405 everywhere (mirror of the 5.8a/b minimal
    # surface above — a deliberate project-wide canon, not an omission).
    http_method_names = ["get", "post", "options"]

    @extend_schema(
        request=ExpenseReportIssueSerializer,
        responses={201: _SingleIssuedExpenseReport},
        description="Выпуск суточного расхода за дату (нумерованный "
        "юр-артефакт). 403 чужой scope; 404 нет подразделения; 409 нет "
        "сдачи / уже выпущен; 422 дата до начала данных / несходимость / "
        "TOMORROW_BLOCKED.",
    )
    def create(self, request, *args, **kwargs):
        form = ExpenseReportIssueSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        business_date = form.validated_data["business_date"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        # «На завтра»-блок (6.10b): only future dates; 422 TOMORROW_BLOCKED with
        # laggards, before the service's own 409 not-ready would fire.
        assert_tomorrow_not_blocked(
            business_date=business_date, today=Clock.today_local()
        )
        # Date-before-data (422) is checked BEFORE issuance so it wins over the
        # service's own 409 REPORT_NOT_READY_FOR_DATE (AC-4).
        assert_report_date_has_data(business_date=business_date)
        issued = issue_expense_document(
            division_id=division_id,
            business_date=business_date,
            actor=request.actor_id,
        )
        return Response(
            IssuedExpenseReportSerializer(issued).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        parameters=[ExpenseReportByDateFilterSerializer],
        responses={200: _SingleIssuedExpenseReport},
        description="Метаданные выпущенного расхода за дату (point lookup). "
        "Будущая дата НЕ блокируется намеренно: легально выпущенный через "
        "override «на завтра»-документ (6.10b) должен читаться. 404 не "
        "выпущен / нет подразделения.",
    )
    def list(self, request, *args, **kwargs):
        form = ExpenseReportByDateFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        business_date = form.validated_data["business_date"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        issued = IssuedDocumentSelector.current_issued(
            doc_type=EXPENSE_DOC_TYPE,
            division_id=division_id,
            business_date=business_date,
        )
        if issued is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={
                    "division_id": str(division_id),
                    "business_date": business_date.isoformat(),
                },
                message="Расход за дату не выпущен.",
            )
        return Response(IssuedExpenseReportSerializer(issued).data)

    @extend_schema(
        parameters=[ExpensePeriodFilterSerializer],
        responses={
            200: inline_serializer(
                name="ExpensePeriodResponse",
                fields={
                    "pages": serializers.ListField(
                        child=serializers.DictField(),
                        help_text="Страница-на-дату: {business_date, totals, "
                        "rows} — read-only derive, без номера документа.",
                    )
                },
            )
        },
        description="Read-only расход за период (страница на дату, без "
        "выпуска). 400 инверсия/длина>62/будущее; 404 нет подразделения; "
        "422 дата до начала данных.",
    )
    @action(detail=False, methods=["get"])
    def period(self, request, *args, **kwargs):
        form = ExpensePeriodFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        date_to = form.validated_data["date_to"]
        ensure_division_scope(request.actor_id, _EXPENSE_PERMISSION, division_id)
        _ensure_division_exists(division_id)
        # Period pages are derived on the fly — a future range would fabricate
        # official-looking numbers from today's roster (review D2 2026-07-13).
        # The by-date GET above is deliberately NOT future-blocked: it only
        # reads ISSUED documents, and a legal «на завтра» issue exists (6.10b).
        today = Clock.today_local()
        if date_to > today:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"date_to": date_to.isoformat(), "today": today.isoformat()},
                message="Период не может уходить в будущее.",
            )
        pages = derive_period(
            division_id=division_id,
            date_from=form.validated_data["date_from"],
            date_to=date_to,
        )
        return Response({"pages": pages})

    @extend_schema(
        request=TomorrowBlockOverrideSerializer,
        responses={
            201: inline_serializer(
                name="TomorrowBlockOverrideResponse",
                fields={
                    "business_date": serializers.DateField(),
                    "overridden_by": serializers.CharField(),
                    "reason": serializers.CharField(),
                },
            )
        },
        description="Легальный обход блокировки «на завтра» (право "
        "daily_report.override_block; day-level — без division-scope, обход "
        "действует на весь день). 400 не-будущая дата / дальше +31д / пустая "
        "причина; 409 обход на дату уже существует.",
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="override-tomorrow-block",
        url_name="override-tomorrow-block",
    )
    def override_block(self, request, *args, **kwargs):
        """Story 6.10b — legally lift the «на завтра» block for a future date."""
        form = TomorrowBlockOverrideSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        business_date = form.validated_data["business_date"]
        today = Clock.today_local()
        # Only a FUTURE date has a block to lift (FR-18: past/today never
        # blocked); overriding a non-future date is a no-op mistake → 400.
        if business_date <= today:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"business_date": business_date.isoformat()},
                message="Обойти можно только блокировку будущей даты.",
            )
        # Upper bound (Д3, review 2026-07-13): the record is irrevocable, so a
        # far-future typo would pre-lift the block for that date forever.
        if business_date > today + timedelta(days=MAX_OVERRIDE_HORIZON_DAYS):
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={
                    "business_date": business_date.isoformat(),
                    "max_days_ahead": MAX_OVERRIDE_HORIZON_DAYS,
                },
                message=(
                    f"Дата обхода дальше +{MAX_OVERRIDE_HORIZON_DAYS} дней — "
                    "проверьте год."
                ),
            )
        try:
            override = override_tomorrow_block(
                business_date=business_date,
                actor=request.actor_id,
                reason=form.validated_data["reason"],
            )
        except ValueError as exc:
            # 5.6b raises ValueError for both bad input and a duplicate, but the
            # duplicate carries the IntegrityError as __cause__ — a state
            # conflict is 409, not a form error (Д2, review D2 2026-07-13).
            if isinstance(exc.__cause__, IntegrityError):
                raise DomainError(
                    "TOMORROW_BLOCK_ALREADY_OVERRIDDEN",
                    409,
                    detail={"business_date": business_date.isoformat()},
                    message="Обход блокировки на эту дату уже существует.",
                ) from exc
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"business_date": business_date.isoformat()},
                message=str(exc),
            ) from exc
        return Response(
            {
                "business_date": business_date.isoformat(),
                "overridden_by": override.overridden_by,
                "reason": override.reason,
            },
            status=status.HTTP_201_CREATED,
        )


class TrafficLightViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Story 10.3a — HTTP-поверхность каскадного светофора (5.5b).

    Read-only проекция ``traffic_light_tree`` плоским списком узлов. Роут
    НЕ пересчитывает цвет: ``status``/``late`` приходят из сервиса байт-в-байт,
    а вьюха добавляет ровно то, чего у каскада нет — ``name``/``parent_id`` из
    ``CoreDivisionTreeSelector`` и три гарда, которых в сервисе нет вообще:

    * 403 чужой корень (``ensure_division_scope``);
    * 404 несуществующий корень — каскад сам фабрикует ``{root: NEUTRAL}`` для
      фантомного UUID, поэтому гейт обязан стоять ДО вызова;
    * 422 дата до начала данных — на ранней дате ``resolve_status`` даёт
      ``IN_SERVICE`` ⇒ ложное GREEN.

    Порядок гардов (scope → exists → дата) load-bearing и зеркалит
    ``ExpenseReportViewSet``: обратный сделал бы 404 оракулом существования для
    чужака, а раннюю дату — маской, скрывающей 403.
    """

    permission_map = {"tree": _TRAFFIC_LIGHT_PERMISSION}
    # No "head": HEAD stays 405 everywhere (project-wide canon, mirror of the
    # two ViewSets above). GET-only ⇒ AUDIT_MATRIX не нужен (аудит покрывает
    # только мутирующие роуты) — если сюда попадёт write-глагол, покраснеет
    # test_audit_matrix_covers_every_mutating_route, и это признак ошибки.
    http_method_names = ["get", "options"]

    @extend_schema(
        parameters=[TrafficLightTreeFilterSerializer],
        responses={
            200: inline_serializer(
                name="TrafficLightTreeResponse",
                fields={
                    "business_date": serializers.DateField(),
                    "nodes": inline_serializer(
                        name="TrafficLightNode",
                        many=True,
                        fields={
                            "division_id": serializers.UUIDField(),
                            "name": serializers.CharField(),
                            "parent_id": serializers.UUIDField(allow_null=True),
                            "status": serializers.ChoiceField(
                                choices=TrafficLightStatus.choices
                            ),
                            "late": serializers.BooleanField(),
                        },
                    ),
                },
            )
        },
        description="Каскадный светофор поддерева (5.5b), плоский список. "
        "400 не-UUID/не-ISO/будущая дата; 403 чужой корень; "
        "404 нет подразделения; 422 дата до начала данных.",
    )
    @action(detail=False, methods=["get"], url_path="tree")
    def tree(self, request, *args, **kwargs):
        form = TrafficLightTreeFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        # ARCH-DATA-024: children_map FULL-scans Division — ONE call, reused by
        # both the root resolution and the parent_id assembly below.
        children = CoreDivisionTreeSelector.children_map()
        parent_of = {
            child: parent for parent, kids in children.items() for child in kids
        }

        root_division_id = form.validated_data.get("root_division_id")
        if root_division_id is not None:
            ensure_division_scope(
                request.actor_id, _TRAFFIC_LIGHT_PERMISSION, root_division_id
            )
            _ensure_division_exists(root_division_id)
            roots = [root_division_id]
        else:
            # Корень опущен ⇒ берём его из RBAC: экран руководителя не обязан
            # знать «а какой у меня корень». visible_division_ids отдаёт
            # РАЗВЁРНУТОЕ поддерево (не корни), поэтому корни выводятся
            # предикатом «родитель не в visible» — он же даёт минимальное
            # множество, так что вложенные/пересекающиеся гранты не дублируют
            # узлы. Ветвление строго на `is None`: None = ГЛОБАЛЬНО, set() =
            # грантов нет (перепутать = отдать всё дерево актору без грантов;
            # за грубым гейтом эта ветка недостижима и остаётся fail-closed).
            visible = PermissionService.visible_division_ids(
                request.actor_id, _TRAFFIC_LIGHT_PERMISSION
            )
            if visible is None:
                roots = children.get(None, [])
            else:
                roots = [d for d in visible if parent_of.get(d) not in visible]
                if visible and not roots:
                    # Цикл в Division.parent (нет анти-цикл-CHECK) схлопывает
                    # предикат в пустоту. Это дата-баг, не запрос: отдаём
                    # честный пустой ответ и шумим в лог, а не подставляем
                    # произвольный корень.
                    logger.warning(
                        "traffic-light: no root resolved from a non-empty scope "
                        "(parent cycle?) actor=%s visible=%s",
                        request.actor_id,
                        sorted(str(d) for d in visible),
                    )

        business_date = form.validated_data.get("business_date") or Clock.today_local()
        today = Clock.today_local()
        if business_date > today:
            # Зеркало ExpenseReportViewSet.period: будущая дата сфабриковала бы
            # светофор из сегодняшнего ростера.
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={
                    "business_date": business_date.isoformat(),
                    "today": today.isoformat(),
                },
                message="Светофор не считается на будущую дату.",
            )
        assert_report_date_has_data(business_date=business_date)

        merged: dict = {}
        for root in roots:
            merged.update(traffic_light_tree(root, business_date))

        names = CoreDivisionTreeSelector.divisions_map(merged.keys())
        nodes = []
        for division_id, cascade in merged.items():
            parent_id = parent_of.get(division_id)
            nodes.append(
                {
                    "division_id": str(division_id),
                    # Гонка удаления: имени нет — узел ОСТАЁТСЯ (потерять RED
                    # хуже, чем потерять имя).
                    "name": names.get(division_id, ""),
                    # null, если родителя нет в ответе (корень поддерева либо
                    # родитель вне видимости): клиент никогда не получает
                    # ссылку на узел, которого в ответе нет.
                    "parent_id": str(parent_id) if parent_id in merged else None,
                    "status": cascade.status,
                    "late": cascade.late,
                }
            )
        nodes.sort(key=lambda node: (node["name"], node["division_id"]))
        # business_date эхом: сервер считает в VAPS_LOCAL_TIMEZONE, экран — в
        # браузере; на границе суток «сегодня» разойдётся.
        return Response(
            {"business_date": business_date.isoformat(), "nodes": nodes}
        )
