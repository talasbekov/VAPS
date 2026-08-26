"""Вьюхи раздела «Охранные мероприятия».

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations, core и
documents: заводить второй механизм прав ради нового префикса значило бы
защищать одни и те же сведения по-разному в зависимости от того, каким адресом
их спросили.
"""
from django.db.models import Exists, OuterRef
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)
from organization_management.apps.ops.api.serializers import (
    SecurityObjectSerializer,
)
from organization_management.apps.ops import gvo as gvo_service
from organization_management.apps.ops import passport as passport_service
from organization_management.apps.ops import analytics as analytics_service
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from organization_management.apps.ops import ratings as ratings_service
from organization_management.apps.ops import reports as reports_service
from organization_management.apps.operations.api.permissions import (
    effective_permissions,
    require_scoped_permission,
    resolve_actor_id,
)
from organization_management.apps.operations.clock import Clock
from django.core.exceptions import ValidationError

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
        "history": _READ_OBJECT_PERMISSION,
        "create": _MANAGE_OBJECT_PERMISSION,
        "passport": _MANAGE_OBJECT_PERMISSION,
        "passport_versions": _MANAGE_OBJECT_PERMISSION,
    }

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        """История ОМ на объекте и лица, его посещавшие (Plane №38)."""
        return Response({"results": gvo_service.object_event_history(pk)})

    # Заведение объекта прямо из окна создания ОМ: «объекта нет в списке —
    # добавить» (ClickUp 86eyqf7a7). Карточка МИНИМАЛЬНАЯ, паспорт не оформлен —
    # его ведёт владелец объекта в своём разделе.
    def create(self, request):
        security_object = passport_service.create_object(
            name=request.data.get("name"),
            object_type=request.data.get("objectType"),
            region=request.data.get("region"),
            address=request.data.get("address"),
            ownership=request.data.get("ownership"),
        )
        return Response(
            SecurityObjectSerializer(security_object).data, status=201
        )

    def get_queryset(self):
        # Порядок задаёт Meta.ordering модели, и владелец у него ОДИН.
        # Повторить order_by здесь значило бы завести второй источник правды:
        # проба, ломающая один из них, оставалась бы зелёной за счёт второго,
        # и порядок оказался бы не проверен ни там, ни тут.
        return OpsSecurityObject.objects.prefetch_related(
            "sectors__posts", "passport_versions"
        ).annotate(
            # Вкладка «Объекты ОМ» реестра. Exists подзапросом, а не
            # Count с distinct: нужен факт, а не число, и подзапрос
            # останавливается на первой найденной строке. Хранимого флага под
            # этот признак нет намеренно — см. OpsSecurityObject.ownership.
            has_security_events=Exists(
                OpsSecurityEvent.objects.filter(security_object=OuterRef("pk"))
            )
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
_STAGE_OVERRIDE_PERMISSION = "event.stage_override"
_DELETE_EVENT_PERMISSION = "event.delete"
# Звенья цепочки «Сбор сил на ОМ» (Plane №74). Область у них не в коде права, а
# в НАЗНАЧЕНИИ роли (`UserRole.scope_division_id`) — см. проверки в действиях.
_FORCES_COMMAND_PERMISSION = "forces.command"
_FORCES_ALLOCATE_PERMISSION = "forces.allocate"
_FORCES_SELECT_PERMISSION = "forces.select"
_PLACEMENT_PERMISSION = "placement.manage"


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
        # Удаление — СВОЁ право: ведущий мероприятие его правит, стирает из
        # реестра администратор (та же мерка, что у stage_override).
        "destroy": _DELETE_EVENT_PERMISSION,
        "bindable_objects": _MANAGE_EVENT_PERMISSION,
        "visit_object_add": _MANAGE_EVENT_PERMISSION,
        "visit_object_detail": _MANAGE_EVENT_PERMISSION,
        "visit_object_chief": _MANAGE_EVENT_PERMISSION,
        # Раздача права — работа ведущего мероприятие, а не замещающего:
        # иначе назначенный смог бы назначить себе смену и разрастить круг.
        "visit_object_deputy_add": _MANAGE_EVENT_PERMISSION,
        "visit_object_deputy_remove": _MANAGE_EVENT_PERMISSION,
        "bulletin": _MANAGE_EVENT_PERMISSION,
        "bulletin_complete": _MANAGE_EVENT_PERMISSION,
        "recon": _MANAGE_EVENT_PERMISSION,
        "recon_import": _MANAGE_EVENT_PERMISSION,
        "recon_complete": _MANAGE_EVENT_PERMISSION,
        # Цепочка «Сбор сил на ОМ» разделена по звеньям (Plane №74): деление
        # потребности и решения по спискам — штаб; оповещение и отправка —
        # ответственный за выделение в СВОЁМ департаменте; выделение людей —
        # начальник управления по СВОЕМУ управлению. Карта даёт ответ «есть ли
        # право вообще»; область сужают проверки внутри действий — они знают,
        # о каком департаменте и управлении идёт речь, а карта не знает.
        "forces_split": _FORCES_COMMAND_PERMISSION,
        "forces_accept": _FORCES_COMMAND_PERMISSION,
        "forces_return": _FORCES_COMMAND_PERMISSION,
        "forces_notify": _FORCES_ALLOCATE_PERMISSION,
        "forces_submit": _FORCES_ALLOCATE_PERMISSION,
        "forces_withdraw": _FORCES_ALLOCATE_PERMISSION,
        "forces_member_add": _FORCES_SELECT_PERMISSION,
        "forces_member_remove": _FORCES_SELECT_PERMISSION,
        # Числа по группам и завершение стадии — прежний путь, которым ведут
        # мероприятия, заведённые до автопрохода (Plane №110). Своего звена в
        # цепочке у них нет, и делить их по ролям заказчик не просил.
        "force_allocation": _MANAGE_EVENT_PERMISSION,
        "placement_assign": _PLACEMENT_PERMISSION,
        "placement_unassign": _PLACEMENT_PERMISSION,
        "placement_sector_senior": _PLACEMENT_PERMISSION,
        # Завершение этапа — не расстановка людей, а переход мероприятия
        # дальше по цепочке: его делает ведущий ОМ.
        "placement_complete": _MANAGE_EVENT_PERMISSION,
        "approval_approve": _MANAGE_EVENT_PERMISSION,
        # Маршрут согласования правит тот же, кто ведёт мероприятие: action без
        # записи в карте провалился бы в автоопределение и остался без права.
        "approval_route_add": _MANAGE_EVENT_PERMISSION,
        "approval_route_remove": _MANAGE_EVENT_PERMISSION,
        "approval_route_decide": _MANAGE_EVENT_PERMISSION,
        "approval_route_move": _MANAGE_EVENT_PERMISSION,
        "approval_send": _MANAGE_EVENT_PERMISSION,
        "approval_withdraw": _MANAGE_EVENT_PERMISSION,
        "approval_remark_resolve": _MANAGE_EVENT_PERMISSION,
        "approval_return": _MANAGE_EVENT_PERMISSION,
        "acknowledge": _MANAGE_EVENT_PERMISSION,
        "acknowledgement_complete": _MANAGE_EVENT_PERMISSION,
        "journal": _MANAGE_EVENT_PERMISSION,
        "conduct_replace": _MANAGE_EVENT_PERMISSION,
        "close": _MANAGE_EVENT_PERMISSION,
        # Перевод на произвольный этап — СВОЁ право, не event.manage:
        # ведущий мероприятие проходит цепочку по правилам, обход правил
        # остаётся администратору.
        "stage_override": _STAGE_OVERRIDE_PERMISSION,
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

        # Период и ответственный фильтруются НА СЕРВЕРЕ: тот же фильтр на
        # клиенте сузил бы только загруженную страницу, и «за июль ничего нет»
        # означало бы «нет на этой странице» — худший вид вранья в реестре.
        date_from = (request.query_params.get("from") or "").strip()
        date_to = (request.query_params.get("to") or "").strip()
        owner = (request.query_params.get("owner") or "").strip()

        # prefetch объектов посещения: без него каждая строка реестра
        # добирала бы свой список отдельным запросом (страница в 20 строк —
        # 20 лишних round-trip, календарь берёт 200).
        rows = list(OpsSecurityEvent.objects.prefetch_related("visit_objects__deputies"))
        if stage:
            # Список стадий через запятую, а не одна: ленты «Сбора сил на ОМ»
            # спрашивают ОКНО, в котором сбор живёт («Потребность», «Запрос
            # сил», «Расстановка»), а не одну стадию (Plane №110). Фильтровать
            # такое окно на клиенте значило бы сузить только загруженную
            # страницу — тот же вид вранья, что и с периодом выше.
            wanted = {part.strip() for part in stage.split(",") if part.strip()}
            rows = [e for e in rows if e.stage in wanted]
        if date_from:
            rows = [e for e in rows if str(e.business_date) >= date_from]
        if date_to:
            rows = [e for e in rows if str(e.business_date) <= date_to]
        if owner:
            rows = [e for e in rows if e.owner_name == owner]
        if search:
            rows = [
                e
                for e in rows
                if search
                in f"{e.title} {e.code} {e.object_name} {e.owner_name}".lower()
            ]
        # Значения фильтра «ответственный» считает СЕРВЕР по всему реестру:
        # собранный по странице список предлагал бы не всех.
        owners = sorted({e.owner_name for e in OpsSecurityEvent.objects.all() if e.owner_name})
        start = (page - 1) * page_size
        return Response(
            {
                "owners": owners,
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

    def destroy(self, request, pk=None):
        # Ответ — 204 без тела: удалённого мероприятия больше нет, и
        # возвращать его «в форме контракта» значило бы отдавать призрак.
        event_service.delete_event(pk, actor=request.user)
        return Response(status=204)

    def create(self, request):
        data = request.data or {}
        event = event_service.create_event(
            title=data.get("title"),
            object_id=data.get("objectId"),
            business_date=data.get("businessDate"),
            business_date_end=data.get("businessDateEnd"),
            kind=data.get("kind"),
            event_time=data.get("eventTime"),
            protected_person_id=data.get("protectedPersonId"),
            location=data.get("location"),
            chief_employee_id=data.get("chiefEmployeeId"),
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

    # ── Объекты посещения ───────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="visit-objects")
    def visit_object_add(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.add_visit_object(
                pk,
                object_id=data.get("objectId"),
                protected_person_id=data.get("protectedPersonId"),
            ),
            status=201,
        )

    # DELETE и PATCH — ОДИН экшен: у роутера DRF два экшена с одинаковым
    # url_path дают два маршрута, и первый по алфавиту забирает оба метода,
    # отвечая 405 на второй. Ветка по методу здесь честнее, чем маршрут,
    # который молча не работает.
    @action(
        detail=True,
        methods=["delete", "patch"],
        url_path=r"visit-objects/(?P<visit_object_id>[^/.]+)",
    )
    def visit_object_detail(self, request, pk=None, visit_object_id=None):
        if request.method.lower() == "patch":
            data = request.data or {}
            return self._event_response(
                event_service.update_visit_object(
                    pk,
                    visit_object_id,
                    visit_day=data.get("visitDay"),
                    note=data.get("note"),
                )
            )
        return self._event_response(
            event_service.remove_visit_object(pk, visit_object_id)
        )

    # ── Замещающие на объекте посещения ─────────────────────────────────

    @action(
        detail=True,
        methods=["post"],
        url_path=r"visit-objects/(?P<visit_object_id>[^/.]+)/deputies",
    )
    def visit_object_deputy_add(self, request, pk=None, visit_object_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.add_visit_object_deputy(
                pk,
                visit_object_id,
                employee_id=data.get("employeeId"),
                can_edit_placement=data.get("canEditPlacement"),
                actor=request.user,
            ),
            status=201,
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=(
            r"visit-objects/(?P<visit_object_id>[^/.]+)"
            r"/deputies/(?P<deputy_id>[^/.]+)"
        ),
    )
    def visit_object_deputy_remove(
        self, request, pk=None, visit_object_id=None, deputy_id=None
    ):
        return self._event_response(
            event_service.remove_visit_object_deputy(
                pk, visit_object_id, deputy_id, actor=request.user
            )
        )

    # ── Старший объекта посещения ───────────────────────────────────────

    # POST назначает (и заменяет), DELETE снимает — один экшен по той же
    # причине, что у visit_object_detail: два экшена на одном url_path дают
    # маршрут, где первый по алфавиту забирает оба метода.
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path=r"visit-objects/(?P<visit_object_id>[^/.]+)/chief",
    )
    def visit_object_chief(self, request, pk=None, visit_object_id=None):
        if request.method.lower() == "delete":
            return self._event_response(
                event_service.remove_visit_object_chief(
                    pk, visit_object_id, actor=request.user
                )
            )
        data = request.data or {}
        return self._event_response(
            event_service.assign_visit_object_chief(
                pk,
                visit_object_id,
                employee_id=data.get("employeeId"),
                actor=request.user,
            )
        )

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
                # Ключа может не быть — тогда сохранённый запрос не трогаем
                # (см. `update_recon`): «нет ключа» это не «ноль».
                force_request=data.get("forceRequest"),
            )
        )

    @action(detail=True, methods=["post"], url_path="recon/import-from-passport")
    def recon_import(self, request, pk=None):
        return self._event_response(event_service.import_recon_from_passport(pk))

    @action(detail=True, methods=["post"], url_path="recon/complete")
    def recon_complete(self, request, pk=None):
        return self._event_response(event_service.complete_recon(pk))

    # Ручка `POST demand/approve/` СНЯТА 26.08.2026 (Plane №149): стадию
    # «Потребность» проходит сервер (Plane №110), форм у неё на клиенте нет,
    # мероприятий на этой стадии не осталось. Снятие — решение заказчика.

    @action(detail=True, methods=["post"], url_path="forces/allocation")
    def forces_split(self, request, pk=None):
        """Раскладка потребности по департаментам (Plane №73, шаг «СС-1»).

        Список целиком, а не строка: «кому сколько» — одно решение штаба.
        """
        data = request.data or {}
        return self._event_response(
            event_service.split_force_demand(pk, rows=data.get("rows"))
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/notify",
    )
    def forces_notify(self, request, pk=None, allocation_id=None):
        """Оповестить управления департамента (Plane №73, шаг «СС-2»).

        Область — департамент СТРОКИ РАСКЛАДКИ (Plane №74): оповещать свои
        управления вправе ответственный за выделение в этом департаменте, а не
        в чужом.
        """
        require_scoped_permission(
            request,
            _FORCES_ALLOCATE_PERMISSION,
            event_service.allocation_scope_division(pk, allocation_id),
        )
        return self._event_response(
            event_service.notify_directorates(
                pk, allocation_id, actor=resolve_actor_id(request)
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/members",
    )
    def forces_member_add(self, request, pk=None, allocation_id=None):
        """Управление выделяет человека (Plane №73, шаг «СС-3»).

        Область — управление САМОГО СОТРУДНИКА (Plane №74): начальник
        управления выделяет своих людей и только своих. Именно это действие
        проставляет статус «Участие на мероприятии», о котором говорил
        заказчик, — отдельной ручки у статуса здесь нет.
        """
        data = request.data or {}
        require_scoped_permission(
            request,
            _FORCES_SELECT_PERMISSION,
            event_service.employee_scope_division(data.get("employeeId")),
        )
        return self._event_response(
            event_service.add_allocation_member(
                pk,
                allocation_id,
                employee_id=data.get("employeeId"),
                actor=resolve_actor_id(request),
                # Протокол обхода мягкого конфликта — общий для раздела:
                # пересечения статусов ловит status_service, и повтор с
                # причиной приходит теми же полями, что у расстановки.
                override=data.get("override") is True,
                override_reason=data.get("override_reason") or "",
            )
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=(
            r"forces/allocation/(?P<allocation_id>[^/]+)"
            r"/members/(?P<employee_id>[^/]+)"
        ),
    )
    def forces_member_remove(
        self, request, pk=None, allocation_id=None, employee_id=None
    ):
        # Снятие проверяется по ТОМУ ЖЕ сотруднику, что и выделение: иначе
        # своего человека выделяло бы своё управление, а снимало бы любое.
        require_scoped_permission(
            request,
            _FORCES_SELECT_PERMISSION,
            event_service.employee_scope_division(employee_id),
        )
        return self._event_response(
            event_service.remove_allocation_member(
                pk,
                allocation_id,
                employee_id,
                actor=resolve_actor_id(request),
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/submit",
    )
    def forces_submit(self, request, pk=None, allocation_id=None):
        """Департамент отправляет список штабу (Plane №73, шаг «СС-4»).

        Область — департамент строки раскладки (Plane №74): отправляет свой
        список тот, кто за него отвечает.
        """
        require_scoped_permission(
            request,
            _FORCES_ALLOCATE_PERMISSION,
            event_service.allocation_scope_division(pk, allocation_id),
        )
        return self._event_response(
            event_service.submit_allocation(
                pk, allocation_id, actor=resolve_actor_id(request)
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/withdraw",
    )
    def forces_withdraw(self, request, pk=None, allocation_id=None):
        # Отзыв — оборотная сторона отправки, и область у него та же: свой
        # список отзывает тот же, кто его отправлял (Plane №74).
        require_scoped_permission(
            request,
            _FORCES_ALLOCATE_PERMISSION,
            event_service.allocation_scope_division(pk, allocation_id),
        )
        return self._event_response(
            event_service.withdraw_allocation(
                pk, allocation_id, actor=resolve_actor_id(request)
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/accept",
    )
    def forces_accept(self, request, pk=None, allocation_id=None):
        """Штаб принимает список и отдаёт людей ОМ (Plane №73, шаг «СС-5»)."""
        return self._event_response(
            event_service.accept_allocation(
                pk, allocation_id, actor=resolve_actor_id(request)
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"forces/allocation/(?P<allocation_id>[^/]+)/return",
    )
    def forces_return(self, request, pk=None, allocation_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.return_allocation(
                pk,
                allocation_id,
                reason=data.get("reason"),
                actor=resolve_actor_id(request),
            )
        )

    @action(
        detail=True,
        methods=["patch"],
        # lookahead: слова complete и allocation — не id запроса; порядок
        # регистрации extra-actions у DRF алфавитный, и без него forces/complete/
        # съедался бы этим маршрутом (ровно та же ловушка, что у path-to-regexp
        # в моке). `allocation` попал сюда по той же причине: POST на него иначе
        # доезжает до этого маршрута и отбивается 405 вместо работы.
        url_path=r"forces/(?P<request_id>(?!complete/|allocation/)[^/]+)",
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

    # Ручка `POST forces/complete/` СНЯТА 26.08.2026 (Plane №149) — по тому же
    # основанию, что и `demand/approve` выше.

    # ── Исключение гейта: замещающий правит расстановку своего объекта ──

    _DEPUTY_ACTIONS = frozenset({"placement_assign", "placement_unassign"})

    def permission_override(self, request):
        """Замещающий на объекте посещения правит расстановку ЭТОГО объекта.

        Открываются только два действия — назначить и снять; завершение этапа
        (`placement_complete`) остаётся у ведущего мероприятие: это переход
        цепочки, а не работа по объекту.

        Признак запоминается на вьюхе, чтобы операция попала в журнал мутаций
        поимённо: действие в обход общего права обязано быть названным.
        """
        self._acting_as_deputy = False
        if self.action not in self._DEPUTY_ACTIONS:
            return False
        employee = getattr(request.user, "employee", None)
        if employee is None or not employee.is_active:
            return False
        event = OpsSecurityEvent.objects.filter(pk=self.kwargs.get("pk")).first()
        if event is None:
            return False
        post = self._deputy_target_post(event)
        if post is None:
            return False
        allowed = event_service.deputy_can_edit_placement(
            event, employee.pk, post
        )
        self._acting_as_deputy = allowed
        self._deputy_employee = employee if allowed else None
        return allowed

    def _require_placement_lead(self, event_id):
        """Расстановку ведёт СТАРШИЙ объекта/мероприятия (Plane №74).

        Право `placement.manage` отвечает «может ли человек расставлять
        вообще»; здесь спрашивается «его ли это мероприятие». Замещающий с
        правом правки расстановки уже прошёл `permission_override` — его и
        пропускаем: у него своя привязка, к посту.

        Администратор («*») не сужается: у него проходит любая проверка
        раздела, и обходить это исключение здесь было бы расхождением с
        остальным гейтом.
        """
        if self._acting_as_deputy_now():
            return
        if "*" in effective_permissions(self.request):
            return
        event = OpsSecurityEvent.objects.filter(pk=event_id).first()
        if event is None:
            return
        employee = getattr(self.request.user, "employee", None)
        employee_id = employee.pk if employee is not None else None
        if not event_service.placement_is_led_by(event, employee_id):
            raise PermissionDenied("PERMISSION_DENIED")

    def _acting_as_deputy_now(self):
        return bool(getattr(self, "_acting_as_deputy", False))

    def _deputy_actor(self):
        """Сотрудник, действующий замещающим, либо `None` — обычное право."""
        if not getattr(self, "_acting_as_deputy", False):
            return None
        return getattr(self, "_deputy_employee", None)

    def _deputy_target_post(self, event):
        """Строка расчёта, которой касается операция.

        У назначения пост приходит телом, у снятия — известен только id
        назначения, и пост восстанавливается по нему: право проверяется по
        ОБЪЕКТУ поста, а не по факту «что-то делаю в этом ОМ».
        """
        posts = {str(p.get("id")): p for p in (event.recon_sector_posts or [])}
        if self.action == "placement_assign":
            return posts.get(str((self.request.data or {}).get("postId")))
        assignment = next(
            (
                a
                for a in (event.placement_assignments or [])
                if str(a.get("id")) == str(self.kwargs.get("assignment_id"))
            ),
            None,
        )
        if assignment is None:
            return None
        return posts.get(str(assignment.get("postId")))

    @action(detail=True, methods=["post"], url_path="placement/assign")
    def placement_assign(self, request, pk=None):
        data = request.data or {}
        self._require_placement_lead(pk)
        return self._event_response(
            event_service.assign_placement(
                pk,
                post_id=data.get("postId"),
                employee_id=data.get("employeeId"),
                override=data.get("override"),
                override_reason=data.get("override_reason"),
                # Кто действует ролью в данных, а не правом. Журнал мутаций
                # пишет СЕРВИС: у него транзакция операции, и запись «действие
                # замещающего» не может разъехаться с самим действием.
                deputy=self._deputy_actor(),
            )
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"placement/(?P<assignment_id>(?!assign/|complete/)[^/]+)",
    )
    def placement_unassign(self, request, pk=None, assignment_id=None):
        self._require_placement_lead(pk)
        return self._event_response(
            event_service.unassign_placement(
                pk, assignment_id, deputy=self._deputy_actor()
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"placement/(?P<assignment_id>[^/]+)/senior",
    )
    def placement_sector_senior(self, request, pk=None, assignment_id=None):
        """Старший сектора: назначить или снять (Plane №65, «Р-4»)."""
        data = request.data or {}
        return self._event_response(
            event_service.set_sector_senior(
                pk,
                assignment_id,
                senior=bool(data.get("senior", True)),
                actor=request.user,
            )
        )

    @action(detail=True, methods=["post"], url_path="placement/complete")
    def placement_complete(self, request, pk=None):
        return self._event_response(event_service.complete_placement(pk))

    @action(detail=True, methods=["post"], url_path="approval/route")
    def approval_route_add(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.add_approver(
                pk,
                name=data.get("name"),
                unit=data.get("unit"),
                position=data.get("position"),
            )
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"approval/route/(?P<approver_id>(?!decide/)[^/]+)",
    )
    def approval_route_remove(self, request, pk=None, approver_id=None):
        return self._event_response(event_service.remove_approver(pk, approver_id))

    @action(
        detail=True,
        methods=["post"],
        url_path=r"approval/route/(?P<approver_id>[^/]+)/decide",
    )
    def approval_route_decide(self, request, pk=None, approver_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.decide_approver(
                pk,
                approver_id=approver_id,
                decision=data.get("decision"),
                comment=data.get("comment"),
            )
        )

    @action(detail=True, methods=["post"], url_path="approval/send")
    def approval_send(self, request, pk=None):
        return self._event_response(event_service.send_for_approval(pk))

    @action(detail=True, methods=["post"], url_path="approval/withdraw")
    def approval_withdraw(self, request, pk=None):
        return self._event_response(event_service.withdraw_from_approval(pk))

    @action(
        detail=True,
        methods=["post"],
        url_path=r"approval/route/(?P<approver_id>[^/]+)/move",
    )
    def approval_route_move(self, request, pk=None, approver_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.move_approver(
                pk, approver_id, direction=data.get("direction")
            )
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"approval/remarks/(?P<remark_id>[^/]+)/resolve",
    )
    def approval_remark_resolve(self, request, pk=None, remark_id=None):
        data = request.data or {}
        return self._event_response(
            event_service.resolve_remark(
                pk, remark_id, resolved=bool(data.get("resolved", True))
            )
        )

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

    @action(detail=True, methods=["post"], url_path="stage")
    def stage_override(self, request, pk=None):
        data = request.data or {}
        return self._event_response(
            event_service.override_stage(
                pk,
                stage=data.get("stage"),
                actor=resolve_actor_id(request),
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


class AccessCatalogViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/access-catalog/ — где применяется каждое право.

    Заказчик отказался от третьего уровня «функция» отдельной сущностью
    (решение 26.08.2026): право остаётся тем, что проверяют ручки, а функции —
    read-only список мест, которые оно открывает. Поэтому каталог не хранится,
    а собирается из карт `permission_map` (см. `ops.access_catalog`): копия в
    базе устаревала бы при первой правке гейта, и экран настроек обещал бы
    доступ, которого нет.

    Право на чтение — `admin.roles`: карта гейтов показывает, какая ручка чем
    закрыта, и её незачем показывать тому, кто доступом не управляет.
    """

    permission_map = {"list": "admin.roles"}

    def list(self, request):
        from organization_management.apps.operations.models import Permission
        from organization_management.apps.ops.access_catalog import catalog

        search = (request.query_params.get("search") or "").strip()
        grouped = catalog(search)
        known = {
            row.code: row
            for row in Permission.objects.filter(code__in=list(grouped))
        }
        results = []
        for code in sorted(grouped):
            permission = known.get(code)
            results.append(
                {
                    "code": code,
                    # Право, которого нет в справочнике, всё равно попадает в
                    # каталог: гейт на нём стоит, и молчать об этом значило бы
                    # спрятать закрытую ручку от того, кто раздаёт доступ.
                    "name": permission.name if permission is not None else "",
                    "isKnown": permission is not None,
                    "isActive": permission.is_active if permission is not None else False,
                    "functions": grouped[code],
                }
            )
        return Response({"results": results, "count": len(results)})


class OpsPersonnelViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/personnel/ — read-only кадровый снимок для подбора
    кандидатов на расстановку: {id, name, rankLabel, unit}. Источник — живые
    кадровые записи (Employee + звание + подразделение штатной единицы), а не
    своя таблица: раздел ОМ кадры не ведёт, он их читает."""

    # «me» перечислен ЯВНО: action без записи в карте проваливается в
    # автоопределение, которое для нестандартного имени возвращает None, то
    # есть ручка осталась бы без права вовсе.
    permission_map = {
        "list": _MANAGE_EVENT_PERMISSION,
        "me": _READ_EVENT_PERMISSION,
    }

    #: Потолок страницы. Без него `?page_size=1000000` отдаёт кадры целиком
    #: одним ответом — размер страницы назначал бы спросивший.
    MAX_PAGE_SIZE = 100

    def list(self, request):
        """Кадровый снимок: поиск и постраничка НА СЕРВЕРЕ («Реестр ОМ-35.3»).

        Требование заказчика — «выпадающий список с пагинацией сотрудников с
        возможностью поиска». Поиск обязан идти сюда, а не фильтровать
        загруженное: фильтр по странице отвечает «такого сотрудника нет», имея
        в виду «нет на этой странице», — худший вид вранья в подборе людей.

        Ответ ВСЕГДА страница. Безстраничная ветка («нет параметров — весь
        список») жила ровно столько, сколько на ней стояли старые читатели:
        расстановка, проведение и окно создания ОМ фильтровали снимок на
        клиенте, и обрезка сузила бы им выбор людей молча. Все четыре переехали
        на серверный поиск (Plane №61), и ветка снята: два способа читать один
        список расходятся тем вернее, чем реже смотрят на второй.

        Клиент, не приславший `page`/`page_size`, получает ПЕРВУЮ страницу
        размером с потолок — это честнее прежнего «всего списка»: он видит
        `count` и знает, что показано не всё.
        """
        from django.db.models import Q

        from organization_management.apps.employees.models import Employee
        from organization_management.apps.ops.security_events import (
            personnel_display_name,
        )

        employees = (
            Employee.objects.filter(is_active=True)
            .select_related("rank", "staff_unit__division")
            .order_by("last_name", "first_name", "id")
        )

        # Отбор по подразделению: управление выделяет СВОИХ людей, и без
        # фильтра окно подбора предлагало бы ему всю службу (Plane №73, СС-3).
        # Поддерево, а не один узел: у управления есть отделы, и человек
        # числится в отделе, а не в управлении.
        division_id = (request.query_params.get("division_id") or "").strip()
        if division_id.isdigit():
            from organization_management.apps.divisions.models import Division

            node = Division.objects.filter(pk=division_id).first()
            employees = (
                employees.filter(
                    staff_unit__division__in=node.get_descendants(include_self=True)
                )
                if node is not None
                # Незнакомое подразделение — пустой список, а не «все»: иначе
                # опечатка в фильтре молча расширяла бы выбор.
                else employees.none()
            )

        # Поиск по тому, что человек видит в строке списка: ФИО, звание,
        # подразделение и табельный номер. Искать по невидимому полю значит
        # отдавать строки, про которые непонятно, почему они нашлись.
        search = (request.query_params.get("search") or "").strip()
        if search != "":
            employees = employees.filter(
                Q(last_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(middle_name__icontains=search)
                | Q(personnel_number__icontains=search)
                | Q(rank__name__icontains=search)
                | Q(staff_unit__division__name__icontains=search)
            ).distinct()

        # ── Рейтинг (Plane №67, шаг РЙ-4) ───────────────────────────────
        # Заказчик: «Научи отдавать рейтинг». До этой правки доска подбора
        # фильтровала по рейтингу В ПРЕДЕЛАХ ЗАГРУЖЕННОЙ СТРАНИЦЫ, и «нет
        # кандидатов» означало «нет на этой странице» — на базе больше
        # страницы это прямое враньё в подборе людей.
        #
        # Право уважается: без `rating.view_aggregate` поля НЕТ ВОВСЕ (а не
        # `null`: null значил бы «рейтинга нет», хотя он есть и его просто не
        # показывают), и отбор по нему недоступен — 403, а не молчаливое
        # игнорирование параметра. Молча проигнорировать отбор хуже отказа:
        # спросивший увидел бы полный список и решил, что фильтр сработал.
        perms = effective_permissions(request)
        may_see_rating = (
            "*" in perms
            or ratings_service.VIEW_AGGREGATE_PERMISSION in perms
        )
        rating_band = (request.query_params.get("rating_band") or "").strip()
        ordering = (request.query_params.get("ordering") or "").strip()
        order_by_rating = ordering == "rating"
        if ordering not in ("", "rating"):
            raise DomainError(
                "VALIDATION_ERROR", 400,
                detail={"ordering": ["Известен один порядок: rating."]},
                message="Проверьте заполнение формы.",
            )
        ratings_by_employee = {}
        if rating_band != "" or order_by_rating or may_see_rating:
            try:
                ratings_by_employee = (
                    ratings_service.aggregate_rating_by_personnel()
                )
            except DomainError:
                # Раздел рейтинга не настроен (нет флагов, нет методики).
                # Рейтинг здесь — ОБОГАЩЕНИЕ кадрового списка, а не его
                # условие: подбор людей обязан работать и там, где рейтинг не
                # заводили вовсе. Иначе одна ненастроенная строка настроек
                # ломает окно выбора сотрудника целиком — это и был регресс,
                # найденный сторожем схемы (Plane №151).
                #
                # НО: если по рейтингу просили ОТБОР или ПОРЯДОК — молчать
                # нельзя. Спросивший увидел бы полный список в обычном порядке
                # и решил, что фильтр сработал. Отказ пробрасывается как есть,
                # с честной причиной «раздел не настроен».
                if rating_band != "" or order_by_rating:
                    raise
                ratings_by_employee = {}
                may_see_rating = False
        if order_by_rating and not may_see_rating:
            # Ранжировать по невидимому баллу нельзя: порядок сам по себе
            # РАССКАЗЫВАЕТ рейтинг — кто выше, тот сильнее. Право на агрегат
            # закрывает и значение, и порядок.
            raise DomainError(
                "PERMISSION_DENIED", 403,
                detail={
                    "permission": ratings_service.VIEW_AGGREGATE_PERMISSION
                },
                message="Недостаточно прав.",
            )
        if rating_band != "":
            if not may_see_rating:
                raise DomainError(
                    "PERMISSION_DENIED", 403,
                    detail={
                        "permission": ratings_service.VIEW_AGGREGATE_PERMISSION
                    },
                    message="Недостаточно прав.",
                )
            matches = ratings_service.RATING_BANDS.get(rating_band)
            if matches is None:
                raise DomainError(
                    "VALIDATION_ERROR", 400,
                    detail={"rating_band": [
                        "Неизвестная полоса рейтинга: "
                        + ", ".join(sorted(ratings_service.RATING_BANDS))
                    ]},
                    message="Проверьте заполнение формы.",
                )
            # Отбор идёт ДО постранички — в этом вся задача. Список id, а не
            # срез страницы: иначе полнота отбора снова стала бы зависеть от
            # того, что успело загрузиться.
            wanted = [
                pk for pk in employees.values_list("pk", flat=True)
                if matches(ratings_by_employee.get(str(pk)))
            ]
            employees = employees.filter(pk__in=wanted)

        total = employees.count()
        try:
            page = max(int(request.query_params.get("page", "1")), 1)
        except ValueError:
            page = 1
        try:
            page_size = max(
                int(request.query_params.get("page_size", str(self.MAX_PAGE_SIZE))),
                1,
            )
        except ValueError:
            page_size = self.MAX_PAGE_SIZE
        page_size = min(page_size, self.MAX_PAGE_SIZE)
        start = (page - 1) * page_size
        if order_by_rating:
            # Ранжирование по решению заказчика (26.08.2026): «надо разрешить
            # ранжировать всю кадровую базу по баллу». Порядок считается по
            # ВСЕЙ выборке и только потом режется на страницы — иначе вышла бы
            # та же беда, что с отбором: страница, упорядоченная сама в себе.
            #
            # Агрегат считается в Python по методике (период, порог оценок,
            # флаги), колонки с ним в базе нет — поэтому порядок задаётся
            # списком id, а не `order_by`. Второй ключ — фамилия: без него
            # равные баллы шли бы в порядке, который база не обещает, и
            # страницы «плавали» бы между запросами.
            ordered_pks = sorted(
                employees.values_list("pk", "last_name", "first_name"),
                key=lambda row: (
                    # `None` — «судить не по чему»; такие идут В КОНЕЦ, а не
                    # считаются нулём: ноль означал бы плохую оценку.
                    ratings_by_employee.get(str(row[0])) is None,
                    -(ratings_by_employee.get(str(row[0])) or 0),
                    row[1],
                    row[2],
                ),
            )
            page_pks = [row[0] for row in ordered_pks[start : start + page_size]]
            by_pk = {e.pk: e for e in employees.filter(pk__in=page_pks)}
            employees = [by_pk[pk] for pk in page_pks if pk in by_pk]
        else:
            employees = employees[start : start + page_size]

        # Статус НА ДАТУ (Plane №65, шаг «Р-2»): подбор кандидатов обязан
        # показывать, свободен ли человек в день мероприятия, — предлагать
        # занятого значит предлагать конфликт. Дату спрашивает КЛИЕНТ и берёт
        # её у мероприятия: считать «сегодня» за него нельзя, расстановка
        # ведётся на будущий день.
        #
        # Без параметра оба поля равны null и означают «не спрашивали» — форма
        # ответа одна на оба случая: две формы заставили бы читателя гадать,
        # что ему пришло.
        from organization_management.apps.ops.security_events import (
            day_status_map,
        )

        rows = list(employees)
        # Разбор даты — общий `_parse_date_param` (мусор → 400), а не свой:
        # у правила «что считается датой в query» один владелец.
        business_date = _parse_date_param(request, "business_date")
        statuses = (
            {}
            if business_date is None
            else day_status_map([e.pk for e in rows], business_date)
        )

        results = []
        for employee in rows:
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
            code, label = statuses.get(str(employee.pk), (None, None))
            results.append(
                {
                    "id": str(employee.pk),
                    "name": personnel_display_name(employee),
                    "rankLabel": employee.rank.name if employee.rank else "",
                    "unit": unit,
                    "statusCode": code,
                    "statusLabel": label,
                }
            )
            if may_see_rating:
                # `None` здесь значит «судить не по чему»: человек не связан с
                # рейтингом, оценок меньше порога методики либо функция
                # выключена. Для подбора это один и тот же случай.
                results[-1]["aggregateRating"] = ratings_by_employee.get(
                    str(employee.pk)
                )
        # `next`/`previous` — НОМЕРА страниц, как у реестра ОМ: контракт
        # раздела один, и второй его вид (ссылки) заставил бы клиента угадывать,
        # что ему пришло.
        return Response(
            {
                "count": total,
                "next": (
                    str(page + 1)
                    if (page - 1) * page_size + page_size < total
                    else None
                ),
                "previous": str(page - 1) if page > 1 else None,
                "results": results,
            }
        )

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        """Сотрудник, привязанный к учётной записи, — для «своего назначения».

        Экран ознакомления показывает сотруднику ЕГО назначение, а связать
        учётку с кадровой записью можно только здесь: `Employee.user` —
        единственное место, где эта связь существует. Сопоставлять по ФИО
        нельзя: тёзка увидел бы чужое назначение как своё.

        Привязки может не быть (сид её не заполняет) — тогда 404 с причиной, а
        не пустой объект: экран обязан отличать «связи нет» от «назначений
        нет».
        """
        from organization_management.apps.employees.models import Employee
        from organization_management.apps.ops.security_events import (
            personnel_display_name,
        )

        employee = getattr(request.user, "employee", None)
        if employee is None or not employee.is_active:
            return Response(
                {
                    "error_code": "EMPLOYEE_NOT_LINKED",
                    "message": "Учётная запись не привязана к сотруднику.",
                },
                status=404,
            )
        try:
            staff_unit = employee.staff_unit
        except Employee.staff_unit.RelatedObjectDoesNotExist:
            staff_unit = None
        unit = (
            staff_unit.division.name
            if staff_unit is not None and staff_unit.division is not None
            else ""
        )
        return Response(
            {
                "id": str(employee.pk),
                "name": personnel_display_name(employee),
                "rankLabel": employee.rank.name if employee.rank else "",
                "unit": unit,
            }
        )


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
                        # Ключ у строки ровно один: числовой или кодовый
                        # (право, роль). Клиенту он приходит одним полем —
                        # два заставили бы каждый экран гадать, какое читать.
                        "entityId": (
                            row.entity_key
                            if row.entity_key is not None
                            else str(row.entity_id)
                        ),
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "employee", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Код участника рейтинга. НЕ УКАЗАН — отдаётся первый "
                    "заведённый участник: у экрана динамики есть состояние "
                    "«сотрудник ещё не выбран», и оно опирается на этот "
                    "порядок (Plane №63)."
                ),
            )
        ]
    )
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "employee", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=True,
                description=(
                    "Код участника рейтинга. ОБЯЗАТЕЛЕН: без него ручка "
                    "отвечает 400. Раньше параметр в схеме не объявлялся "
                    "вовсе, и сгенерированный по ней клиент получал метод "
                    "без аргументов, который всегда отвечал 404 (Plane №63)."
                ),
            )
        ]
    )
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "preset", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Код именованного периода. ЛИБО он, ЛИБО пара from/to — "
                    "период считает сервер, чтобы «текущая неделя» не означала "
                    "разные интервалы у разных вкладок. Не прислано НИЧЕГО — "
                    "400 (Plane №151)."
                ),
            ),
            OpenApiParameter(
                "from", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Начало периода, ГГГГ-ММ-ДД. Обязателен вместе с to, если нет preset.",
            ),
            OpenApiParameter(
                "to", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Конец периода, ГГГГ-ММ-ДД. Обязателен вместе с from, если нет preset.",
            ),
        ]
    )
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "preset", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Код именованного периода. ЛИБО он, ЛИБО пара from/to — "
                    "период считает сервер, чтобы «текущая неделя» не означала "
                    "разные интервалы у разных вкладок. Не прислано НИЧЕГО — "
                    "400 (Plane №151)."
                ),
            ),
            OpenApiParameter(
                "from", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Начало периода, ГГГГ-ММ-ДД. Обязателен вместе с to, если нет preset.",
            ),
            OpenApiParameter(
                "to", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Конец периода, ГГГГ-ММ-ДД. Обязателен вместе с from, если нет preset.",
            ),
        ]
    )
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "preset", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Код именованного периода. ЛИБО он, ЛИБО пара from/to — "
                    "период считает сервер, чтобы «текущая неделя» не означала "
                    "разные интервалы у разных вкладок. Не прислано НИЧЕГО — "
                    "400 (Plane №151)."
                ),
            ),
            OpenApiParameter(
                "from", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Начало периода, ГГГГ-ММ-ДД. Обязателен вместе с to, если нет preset.",
            ),
            OpenApiParameter(
                "to", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=False,
                description="Конец периода, ГГГГ-ММ-ДД. Обязателен вместе с from, если нет preset.",
            ),
        ]
    )
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
        "detail_card": reports_service.GENERATE_PERMISSION,
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

    # Контракт мока (REPORT_JOB_DETAIL_PATH_PATTERN) зовёт карточку по
    # /{id}/detail/ — фронт бьёт именно сюда, retrieve без суффикса он не
    # использует.
    @action(detail=True, methods=["get"], url_path="detail")
    def detail_card(self, request, pk=None):
        return self.retrieve(request, pk=pk)

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


# ── «Расход дня» раздела ОМ — адаптеры над живым /api/operations/ ──────────

from organization_management.apps.ops import daily as daily_service

# Гарды области и разбор параметров — ИМПОРТОМ из вьюх operations, не копией:
# у правила «что видно актору» один владелец, и дублирующий гард здесь молча
# разошёлся бы с ним (класс «дублирующие гарды» из ревью).
from organization_management.apps.operations.api.views import (
    _assert_division_in_scope,
    _parse_date_param,
    _parse_int_param,
    _resolve_division_scope,
)
from organization_management.apps.operations.api.serializers import (
    BulkStatusCreateSerializer,
    DailySubmissionAmendSerializer,
    DailySubmissionCreateSerializer,
)

_DAILY_READ_PERMISSION = "status.view"
_DAILY_BULK_PERMISSION = "status.manage"
_DAILY_SUBMIT_PERMISSION = "daily_report.mark_update"
_DAILY_AMEND_PERMISSION = "daily_report.correct"


class OpsDailyDivisionsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/daily/divisions/ — подразделения области актора в форме
    контракта клиента (строковые id)."""

    permission_map = {"list": _DAILY_READ_PERMISSION}

    def list(self, request):
        return Response(
            {
                "results": daily_service.visible_division_rows(
                    resolve_actor_id(request), _DAILY_READ_PERMISSION
                )
            }
        )


class OpsDailyEmployeesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/ops/daily/employees/?division_id= — состав подразделения для
    грида. Чужое подразделение — 403 (общий резолвер области), а не пустой
    список, неотличимый от «там никого нет»."""

    permission_map = {"list": _DAILY_READ_PERMISSION}

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "division_id", OpenApiTypes.INT, OpenApiParameter.QUERY,
                required=True,
                description=(
                    "Подразделение. ОБЯЗАТЕЛЕН: состав отдаётся по одному "
                    "подразделению, «весь состав службы» эта ручка не отдаёт "
                    "вовсе (Plane №151)."
                ),
            )
        ]
    )
    def list(self, request):
        division_id = _parse_int_param(request, "division_id")
        if division_id is None:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"division_id": ["Укажите подразделение."]},
                message="Проверьте параметры запроса.",
            )
        _resolve_division_scope(request, division_id, _DAILY_READ_PERMISSION)
        results = daily_service.employee_rows([division_id])
        return Response(
            {
                "count": len(results),
                "next": None,
                "previous": None,
                "results": results,
            }
        )


class OpsDailyBulkViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST /api/ops/daily/statuses-bulk/ — делегат bulk_create_statuses:
    та же атомарность и тот же построчный details.rows, что у
    /api/operations/statuses/bulk/."""

    permission_map = {"create": _DAILY_BULK_PERMISSION}

    def create(self, request):
        from rest_framework import status as http_status

        from organization_management.apps.operations.bulk_status_service import (
            bulk_create_statuses,
        )
        from organization_management.apps.operations.selectors import (
            DivisionTreeSelector,
        )
        from organization_management.apps.operations.services import (
            PermissionService,
        )

        form = BulkStatusCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), _DAILY_BULK_PERMISSION
        )
        if allowed is None:
            allowed = DivisionTreeSelector.all_ids()
        created = bulk_create_statuses(
            form.validated_data["rows"],
            actor=resolve_actor_id(request),
            business_date=form.validated_data["business_date"],
            allowed_division_ids=allowed,
            amendment_reason=form.validated_data.get("amendment_reason", ""),
        )
        return Response(
            {"created": len(created)}, status=http_status.HTTP_201_CREATED
        )


class OpsDailySubmissionsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/daily/daily-submissions/ — сдача дня в форме контракта
    клиента: список несёт ВСЕ версии дня (историю решает экран), создание и
    поправка делегируются day_submission_service."""

    permission_map = {
        "list": _DAILY_READ_PERMISSION,
        "create": _DAILY_SUBMIT_PERMISSION,
        "amend": _DAILY_AMEND_PERMISSION,
    }

    def list(self, request):
        division_id = _parse_int_param(request, "division_id")
        scope = _resolve_division_scope(
            request, division_id, _DAILY_READ_PERMISSION
        )
        results = daily_service.list_submissions(
            scope=scope,
            division_id=division_id,
            business_date=_parse_date_param(request, "business_date"),
        )
        return Response(
            {
                "count": len(results),
                "next": None,
                "previous": None,
                "results": results,
            }
        )

    def create(self, request):
        from rest_framework import status as http_status

        from organization_management.apps.operations.day_submission_service import (
            submit_day,
        )

        form = DailySubmissionCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        _assert_division_in_scope(
            request, division_id, _DAILY_SUBMIT_PERMISSION,
            field="division_id",
        )
        submission = submit_day(
            division_id=division_id,
            business_date=form.validated_data["business_date"],
            actor=resolve_actor_id(request),
        )
        return Response(
            daily_service.serialize_submission(submission),
            status=http_status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="amend")
    def amend(self, request, pk=None):
        from rest_framework import status as http_status

        from organization_management.apps.operations.day_submission_service import (
            amend_day,
        )
        from organization_management.apps.operations.models_submission import (
            OpsDailySubmission,
        )

        form = DailySubmissionAmendSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        submission = (
            OpsDailySubmission.objects.filter(pk=pk).first()
            if str(pk).isdigit()
            else None
        )
        if submission is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        _assert_division_in_scope(
            request, submission.division_id, _DAILY_AMEND_PERMISSION,
            field="division_id",
        )
        amended = amend_day(
            division_id=submission.division_id,
            business_date=submission.business_date,
            actor=resolve_actor_id(request),
            reason=form.validated_data["reason"],
            sanction=form.validated_data["sanction"],
        )
        return Response(
            daily_service.serialize_submission(amended),
            status=http_status.HTTP_201_CREATED,
        )


# ── Обратная связь (§28) ────────────────────────────────────────────────────

from organization_management.apps.ops import feedback as feedback_service


class OpsFeedbackRequestsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/feedback-requests/ — реестр, создание, карточка, отправка
    черновика, комментарии, разбор и закрытие обращения.

    Гейт миксина держит право ДЕЙСТВИЯ (чтение/создание/разбор); видимость
    конкретного обращения, конфиденциальность содержания и вид комментария
    проверяет сервис по-записно — невидимое обращение отвечает «не найдено»,
    а не «нет прав», чтобы отказ не подтверждал существование записи.
    """

    permission_map = {
        "list": feedback_service.VIEW_PERMISSION,
        "retrieve": feedback_service.VIEW_PERMISSION,
        "create": feedback_service.CREATE_PERMISSION,
        "submit": feedback_service.CREATE_PERMISSION,
        "comments": feedback_service.VIEW_PERMISSION,
        "triage": feedback_service.TRIAGE_PERMISSION,
        "close": feedback_service.TRIAGE_PERMISSION,
    }

    def list(self, request):
        params = request.query_params
        try:
            page = int(params.get("page", "1"))
        except (TypeError, ValueError):
            page = 1
        return Response(
            feedback_service.list_feedback(
                resolve_actor_id(request),
                effective_permissions(request),
                {
                    "search": params.get("search") or "",
                    "type": params.get("type") or None,
                    "status": params.get("status") or None,
                    "module": params.get("module") or None,
                    "page": page,
                    "mine": params.get("mine") == "true",
                },
            )
        )

    def retrieve(self, request, pk=None):
        return Response(
            feedback_service.get_feedback(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )

    def create(self, request):
        return Response(
            feedback_service.create_feedback(
                resolve_actor_id(request), request.data
            )
        )

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        return Response(
            feedback_service.submit_feedback(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
            )
        )

    @action(detail=True, methods=["post"], url_path="comments")
    def comments(self, request, pk=None):
        return Response(
            feedback_service.add_comment(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                request.data,
            )
        )

    @action(detail=True, methods=["post"], url_path="triage")
    def triage(self, request, pk=None):
        return Response(
            feedback_service.triage_feedback(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                request.data,
            )
        )

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        return Response(
            feedback_service.close_feedback(
                resolve_actor_id(request),
                effective_permissions(request),
                str(pk),
                request.data,
            )
        )


# ── ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20) ─────────


class OpsProtectedPersonsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/protected-persons/ — справочник охраняемых лиц.

    Только чтение с фронта; правка — Django Admin (Admin = справочники).
    """

    permission_map = {"list": "event.view", "history": "event.view"}

    def list(self, request):
        return Response({"results": gvo_service.list_persons()})

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        """История ОМ охраняемого лица (задача заказчика Plane №38).

        Право то же, что у справочника: история — это те же мероприятия, что
        видны в реестре, собранные по лицу.
        """
        return Response({"results": gvo_service.person_event_history(pk)})


class OpsLegalDocumentsViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/legal-documents/ — нормативная база ОМ (только чтение).

    Файлы документов система не хранит: fileUrl честно null.
    """

    permission_map = {"list": "event.view"}

    def list(self, request):
        return Response({"results": gvo_service.list_legal_documents()})


class OpsGvoSummariesViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """/api/ops/gvo-summaries/ — ручные правки сводок ГВО по коду ОМ.

    База сводки собирается на клиенте из бюллетеня; здесь только патчи —
    та же семантика, что у мока MSW (list / patch / reset).
    """

    # Правка сводки — своё право (Plane «Реестр ОМ-35.6»): её заполняет
    # старший ГВО, а не всякий, кто ведёт мероприятие. ЧТЕНИЕ остаётся на
    # `event.view`: сводку смотрят и те, кто её не заполняет (командный центр,
    # реестр, карточка ОМ), и закрыть просмотр правом правки значило бы
    # спрятать данные от их читателей.
    permission_map = {
        "list": "event.view",
        "partial_update": "gvo.manage",
        "reset": "gvo.manage",
    }
    # Код ОМ содержит кириллицу и дефисы («ОМ-2026-1») — дефолтный lookup
    # [^/.]+ подходит, но объявим явно ради читаемости.
    lookup_value_regex = r"[^/]+"

    #: Действия, которые открывает роль В ДАННЫХ (не код права).
    _CHIEF_ACTIONS = frozenset({"partial_update", "reset"})

    def permission_override(self, request):
        """Старший ГВО правит сводку СВОЕГО мероприятия без `gvo.manage`.

        «Старший ГВО или админ» — требование заказчика дословно. Админ проходит
        по «*», а старший — по роли в данных: старший мероприятия
        (`chief_employee_id` бюллетеня) у визита иностранного ОЛ и есть
        старший ГВО (подпись факта сводки уточнена 23.08 ровно поэтому).

        Почему не «старший группы ГВО» из самой сводки: там он ТЕКСТ патча
        («Фамилия | позывной | старший ГВО»), без ссылки на кадровую запись.
        Пускать по совпадению фамилии нельзя — тёзка получил бы правку чужой
        сводки, а сама строка правится тем же окном, то есть право выдавало бы
        себя само.

        Старший ОБЪЕКТА посещения (`ОМ-35.2`) сюда НЕ входит: его полномочия
        кончаются на его объекте, а сводка — про мероприятие целиком.

        Только своё ОМ: код мероприятия берётся из адреса, и «я где-то
        старший» права на чужую сводку не даёт.
        """
        if self.action not in self._CHIEF_ACTIONS:
            return False
        employee = getattr(request.user, "employee", None)
        if employee is None or not employee.is_active:
            return False
        event = OpsSecurityEvent.objects.filter(code=self.kwargs.get("pk")).first()
        if event is None:
            return False
        return event.chief_employee_id == employee.pk

    def list(self, request):
        return Response({"results": gvo_service.list_patches()})

    def partial_update(self, request, pk=None):
        try:
            record = gvo_service.apply_patch(
                pk, request.data, request.user,
                actor=resolve_actor_id(request),
            )
        except ValidationError as exc:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail=exc.message_dict,
                message="Проверьте состав патча.",
            )
        if record is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                message="Мероприятие с таким кодом не найдено.",
            )
        return Response(record)

    @action(detail=True, methods=["post"], url_path="reset")
    def reset(self, request, pk=None):
        try:
            record = gvo_service.reset_patch(
                pk, request.data, actor=resolve_actor_id(request)
            )
        except ValidationError as exc:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail=exc.message_dict,
                message="Проверьте раздел сброса.",
            )
        if record is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                message="Мероприятие с таким кодом не найдено.",
            )
        return Response(record)
