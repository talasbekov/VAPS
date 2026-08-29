"""Вьюхи core: чтение оргструктуры в контракте нового бэка.

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations: заводить
второй механизм прав ради нового префикса значило бы защищать одни и те же
сведения по-разному в зависимости от того, каким адресом их спросили.
"""
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from organization_management.apps.core.api.serializers import (
    DivisionSerializer,
    EmployeeSerializer,
    PositionSerializer,
    RankSerializer,
    StaffingSlotSerializer,
)
from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.staff_unit.models import StaffUnit

# Оргструктура открывается тем же правом, что и в доноре.
_READ_ORGSTRUCTURE_PERMISSION = "orgstructure.view"
# Кадровые записи открываются своим правом: оргструктура — это форма, а
# карточка сотрудника — персональные данные, и уравнивать их нельзя.
_READ_PERSONNEL_PERMISSION = "personnel.view"


class DivisionViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/divisions/ — список подразделений в донорском контракте.

    Только чтение: срез переносит контракт для экранов раздела, а правка
    оргструктуры на старой стороне уже живёт в /api/divisions/ со своими
    проверками. Две пишущие поверхности над одной таблицей разошлись бы в
    инвариантах.
    """

    serializer_class = DivisionSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно: без него пагинация DRF предупреждает о
        # нестабильной выборке, а страницы могут повторять и терять строки.
        qs = Division.objects.all().order_by("tree_id", "lft", "id")
        return self._filter_by_type(qs)

    def _filter_by_type(self, qs):
        """Отбор по типу узла: `?type_code=department` (Plane №315).

        До этого параметр МОЛЧА ИГНОРИРОВАЛСЯ: справочник отдавал всё дерево, и
        клиент, отобравший «департаменты», получал первой строкой организацию.
        Ошибка всплывала через шаг — заявку такому «департаменту» сервер
        отбивал 400 «Такого департамента нет в справочнике», и выглядело это
        как ошибка ввода пользователя. Тот же класс, что №289: параметр не
        поддержан и при этом не отбит.

        Неизвестный тип — 400, а не пустой список: «таких узлов нет» и «такого
        типа не бывает» для клиента выглядят одинаково, а означают разное.
        """
        raw = (self.request.query_params.get("type_code") or "").strip()
        if not raw:
            return qs
        known = {value for value, _label in Division.DivisionType.choices}
        if raw not in known:
            raise ValidationError(
                {"type_code": f"Неизвестный тип узла. Известные: {', '.join(sorted(known))}."}
            )
        return qs.filter(division_type=raw)


class EmployeeViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/employees/ — кадровые карточки в донорском контракте.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка кадровых
    записей живёт на старой стороне со своими проверками.
    """

    serializer_class = EmployeeSerializer
    permission_map = {
        "list": _READ_PERSONNEL_PERMISSION,
        "retrieve": _READ_PERSONNEL_PERMISSION,
    }

    def get_queryset(self):
        # select_related по званию и штатной единице: без него каждая строка
        # добавляла бы запросы за должностью и подразделением (N+1).
        qs = (
            Employee.objects.select_related(
                "rank", "staff_unit", "staff_unit__position"
            )
            .all()
            .order_by("last_name", "first_name", "id")
        )
        qs = self._filter_by_division(qs)
        return self._filter_by_reference_and_search(qs)

    def _filter_by_division(self, qs):
        # Экран «Расход дня» шлёт ?division_id=<id> и ждёт состав ИМЕННО этого
        # подразделения; без фильтра сюда попадал весь личный состав, и утреннее
        # массовое обновление адресовало не тех. Подразделение висит на штатной
        # единице (см. EmployeeSerializer.get_division) — значит и фильтр идёт
        # через неё: INNER JOIN отсекает непривязанных (у них подразделения нет
        # вовсе). Точное совпадение, как у донора Backend/VAPS.
        raw = self.request.query_params.get("division_id")
        if not raw:
            return qs
        try:
            division_id = int(raw)
        except (TypeError, ValueError):
            raise ValidationError({"division_id": "должен быть целым числом"})
        return qs.filter(staff_unit__division_id=division_id)

    def _filter_by_reference_and_search(self, qs):
        # Прочие донорские фильтры кадрового списка. Каждый — точное совпадение
        # (search — подстрока), все комбинируются с division_id и между собой
        # по И, как в EmployeeViewSet донора. Источники у старой схемы разные:
        # статус лежит на самой Employee, звание — на FK-справочнике, должность —
        # через штатную единицу.
        params = self.request.query_params
        if status_code := params.get("status"):
            qs = qs.filter(employment_status=status_code)
        if rank_code := params.get("rank_code"):
            qs = qs.filter(rank__code=rank_code)
        if position_code := params.get("position_code"):
            qs = qs.filter(staff_unit__position__code=position_code)
        if search := params.get("search"):
            # `full_name` у старой схемы нет — это сборка сериализатора; ищем по
            # частям имени и табельному (донор ищет по своим эквивалентам).
            qs = qs.filter(
                Q(last_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(middle_name__icontains=search)
                | Q(personnel_number__icontains=search)
            )
        return qs


# Ключ справочников формы штата — КОД, а не числовой pk. У донора Position и
# Rank лежат в своих таблицах с кодом-первичным ключом (см. срезы 155/156), и
# клиент SPA сгенерирован из ТОЙ схемы: на руках у него из списка только
# `code`. Пока detail-маршруты искали по pk, объявленный схемой переход
# list → карточка был недостижим по контракту: обращение по code давало 404, а
# pk клиенту не отдавали вовсе (Plane №306).
#
# Из трёх вариантов карточки взят второй — lookup по коду. Первый (добавить
# `id` в списочную строку) закрыл бы 404, но завёл бы В КОНТРАКТЕ поле,
# которого у донора нет, и оставил бы у ресурса два разных ключа. Третий
# (снять detail) выкинул бы объявленный схемой маршрут. Ломать существующие
# ссылки по pk нечего: читателей detail нет ни во фронте (lib/api.ts берёт
# только списки), ни в пробах — проверено грепом до правки.
#
# Регулярное выражение шире умолчания DRF (`[^/.]+`): точку код содержать
# может — усыновлённые строки стенда держат СВОИ коды, заведённые до лестницы
# (seed_positions_ranks), и их набор символов нам не подвластен. Несуществующий
# код по-прежнему даёт честный 404.
_REFERENCE_LOOKUP_FIELD = "code"
_REFERENCE_LOOKUP_REGEX = "[^/]+"


class PositionViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/positions/ — справочник должностей в донорском контракте.

    Право то же, что у оргструктуры: должность — это форма штата, а не
    персональные данные, и делить её со структурой подразделений логично.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка
    справочника живёт на старой стороне со своими проверками.
    """

    serializer_class = PositionSerializer
    lookup_field = _REFERENCE_LOOKUP_FIELD
    lookup_value_regex = _REFERENCE_LOOKUP_REGEX
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно (тот же, что в Meta модели): без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return Position.objects.all().order_by("level", "name", "id")


class RankViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/ranks/ — справочник званий в донорском контракте.

    Право и режим те же, что у PositionViewSet: звание — справочник формы
    штата, правка живёт на старой стороне.
    """

    serializer_class = RankSerializer
    lookup_field = _REFERENCE_LOOKUP_FIELD
    lookup_value_regex = _REFERENCE_LOOKUP_REGEX
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # Порядок фиксируем явно (тот же, что в Meta модели): без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return Rank.objects.all().order_by("level", "name", "id")


class StaffingSlotViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/staffing-slots/ — штатные слоты в донорском контракте.

    Право то же, что у positions и ranks: штатный слот — это форма штата, а
    не персональные данные. Сотрудник, занимающий слот, в контракте донора не
    участвует вовсе (у него связь идёт отдельной сущностью назначения),
    поэтому кадровое право здесь не при чём.

    Только чтение — по тому же доводу, что у DivisionViewSet: правка штатного
    расписания живёт на старой стороне (/api/staff_unit/) со своими
    проверками, и две пишущие поверхности над одной таблицей разошлись бы в
    инвариантах.
    """

    serializer_class = StaffingSlotSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        # select_related по должности: без него каждая строка добавляла бы
        # запрос за кодом должности (N+1). Порядок фиксируем явно — без него
        # пагинация DRF предупреждает о нестабильной выборке.
        return (
            StaffUnit.objects.select_related("position")
            .all()
            .order_by("division_id", "index", "id")
        )


class VacancyViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/core/vacancies/ — свободные штатные слоты.

    ЭТОТ АДРЕС ОТДАЁТ НЕ ЗАПИСИ «ВАКАНСИЯ», А СЛОТЫ. У донора VacancyViewSet
    зовёт compute_free_slots и сериализует результат тем же
    StaffingSlotSerializer, что и /staffing-slots/; правило —
    BR-CORE-STAFF-002: «вакансия = слот без действующего назначения на дату».
    Поэтому и здесь строка та же, и сериализатор тот же: два адреса обязаны
    описывать один слот одинаково, иначе клиент, сверяющий вакансию со
    штатным расписанием, получил бы два разных описания одной строки.

    СТАРАЯ staff_unit.Vacancy В ОТБОРЕ НЕ УЧАСТВУЕТ. Она описывает объявление
    о наборе (требования, обязанности, статус), а не занятость слота, и её
    может не быть у настоящей незанятой единицы. Отбор идёт по отсутствию
    сотрудника — прямой аналог «нет действующего назначения»; сузь его по
    наличию объявления, и незанятый штат оказался бы спрятан от клиента.

    ДАТУ СТАРАЯ СХЕМА НЕ ПОДДЕРЖИВАЕТ: у StaffUnit нет временных границ
    (`valid_from`/`valid_to` контракта отдаются null, см. срез 157), а
    занятость хранится одним полем «сейчас», без интервалов. Донорский
    параметр `date` поэтому не заведён: принять его и ответить теми же
    строками значило бы выдать сегодняшний штат за штат на любую дату.

    Право и режим — как у StaffingSlotViewSet: та же выборка, тот же штат.
    """

    serializer_class = StaffingSlotSerializer
    permission_map = {
        "list": _READ_ORGSTRUCTURE_PERMISSION,
        "retrieve": _READ_ORGSTRUCTURE_PERMISSION,
    }

    def get_queryset(self):
        queryset = (
            StaffUnit.objects.select_related("position")
            .filter(employee__isnull=True)
            .order_by("division_id", "index", "id")
        )
        # Параметр донора. Без него выборка НЕ сужается: свободный слот
        # чужого подразделения — тоже вакансия, и прятать его молча нельзя.
        division_id = self.request.query_params.get("division_id")
        if division_id:
            queryset = queryset.filter(division_id=division_id)
        return queryset
