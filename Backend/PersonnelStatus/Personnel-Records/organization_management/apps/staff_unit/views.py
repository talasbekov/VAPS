from datetime import date

from django.db.models import OuterRef, Q, Subquery
from django.db.models.query import Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import viewsets, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import action
from django.db import transaction

from organization_management.apps.staff_unit.models import Vacancy, StaffUnit
from organization_management.apps.staff_unit.serializers import (
    VacancySerializer,
    StaffUnitSerializer,
    StaffUnitBulkUpdateSerializer,
    StaffUnitDetailedSerializer,
)
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.dictionaries.api.serializers import PositionSerializer
from organization_management.apps.common.drf_permissions import (
    RoleBasedPermission,
    CanViewVacancies,
    CanCreateVacancy,
    CanEditVacancy,
    CanViewStaffingTable,
    CanManageStaffingTable
)
from organization_management.apps.common.rbac import get_user_scope_queryset, check_permission
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.masking import mask_iin
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import (
    CURRENT_STATUS_ORDER,
    active_status,
    active_status_prefetch,
)


#: Право раздела ОМ, открывающее кадровые экраны расхода (Plane №325).
#: ТО ЖЕ, что у борда расхода и аналитики службы: экран показывает ровно то,
#: что показывают они, и второе имя для одного и того же разошлось бы с ними
#: при первой же раздаче прав.
_OPS_READ_STATUS_PERMISSION = 'status.view'
#: Право раздела на чтение ОРГСТРУКТУРЫ. Ручку статистики зовёт и экран
#: организации, и требовать от его читателя право на статусы значило бы
#: закрыть ему счётчики его же дерева (Plane №339).
_OPS_READ_ORGSTRUCTURE_PERMISSION = 'orgstructure.view'


def _as_date(value):
    """Дата из JSON-строки. None — значения нет или оно не разбирается."""
    if value is None or value == '':
        return None
    if isinstance(value, date):
        return value
    return parse_date(str(value))


class PositionViewSet(viewsets.ModelViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            self.permission_classes = [permissions.IsAuthenticated]
        else:
            self.permission_classes = [permissions.IsAuthenticated]
        return super().get_permissions()


class VacancyViewSet(viewsets.ModelViewSet):
    """
    ViewSet для управления вакансиями с проверкой прав на основе ролей
    """
    queryset = Vacancy.objects.all()
    serializer_class = VacancySerializer

    # Маппинг actions на требуемые права
    permission_map = {
        'list': 'view_vacancies',
        'retrieve': 'view_vacancies',
        'create': 'create_vacancy',
        'update': 'edit_vacancy',
        'partial_update': 'edit_vacancy',
        'destroy': 'close_vacancy',
    }

    def get_permissions(self):
        """Динамическое определение permissions на основе action"""
        if self.action in ['create']:
            return [permissions.IsAuthenticated(), CanCreateVacancy()]
        elif self.action in ['update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), CanEditVacancy()]
        else:
            return [permissions.IsAuthenticated(), CanViewVacancies()]

    def get_queryset(self):
        """Фильтрация queryset по области видимости пользователя"""
        user = self.request.user

        # Суперпользователь видит всё
        if user.is_superuser:
            return Vacancy.objects.all()

        # Используем RBAC engine для фильтрации
        return get_user_scope_queryset(user, Vacancy)

    def perform_create(self, serializer):
        """
        Проверка прав при создании вакансии
        Вакансия будет связана с StaffUnit, проверяем scope через него
        """
        user = self.request.user

        # Базовая проверка прав на создание вакансий
        if not user.is_superuser and hasattr(user, 'role_info'):
            if not check_permission(user, 'create_vacancy'):
                raise PermissionDenied(
                    "У вас нет прав для создания вакансий"
                )

        serializer.save()

    def perform_update(self, serializer):
        """
        Проверка прав при обновлении вакансии
        """
        user = self.request.user
        instance = self.get_object()

        if not user.is_superuser:
            if not check_permission(user, 'edit_vacancy', instance):
                raise PermissionDenied(
                    "У вас нет прав для редактирования этой вакансии"
                )

        serializer.save()

    def perform_destroy(self, instance):
        """
        Проверка прав при закрытии/удалении вакансии
        """
        user = self.request.user

        if not user.is_superuser:
            if not check_permission(user, 'close_vacancy', instance):
                raise PermissionDenied(
                    "У вас нет прав для закрытия этой вакансии"
                )

        # Вместо удаления - закрываем вакансию
        instance.status = Vacancy.VacancyStatus.CLOSED
        instance.save()


class StaffUnitViewSet(viewsets.ModelViewSet):
    """
    ViewSet для управления штатным расписанием с проверкой прав на основе ролей
    """
    queryset = StaffUnit.objects.all()
    serializer_class = StaffUnitSerializer

    # Маппинг actions на требуемые права
    permission_map = {
        'list': 'view_staffing_table',
        'retrieve': 'view_staffing_table',
        'create': 'create_staffing_position',
        'update': 'edit_staffing_position',
        'partial_update': 'edit_staffing_position',
        'destroy': 'delete_staffing_position',
    }

    def get_permissions(self):
        """Динамическое определение permissions на основе action"""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated(), CanManageStaffingTable()]
        # ЧТЕНИЕ ручки `directorate` открыто И правом раздела (Plane №325).
        # Класс `CanViewStaffingTable` спрашивает кадровое `view_staffing_table`,
        # и у ролевой учётки раздела его может не быть вовсе — тогда 403
        # приходил бы ДО того, как действие успело спросить право раздела.
        #
        # ЗАПИСЬ через эту же ручку НЕ расширена: `status.view` — право
        # чтения, и пускать по нему правку штатки, сотрудников и статусов
        # значило бы выдать больше, чем спрашивали. Кто пишет — пишет как
        # писал, кадровым правом.
        if (
            self.action == 'directorate_management'
            and self.request.method in permissions.SAFE_METHODS
        ):
            return [permissions.IsAuthenticated(), CanReadDirectorate()]
        return [permissions.IsAuthenticated(), CanViewStaffingTable()]

    def get_queryset(self):
        """Фильтрация queryset по области видимости пользователя"""
        user = self.request.user

        # Суперпользователь видит всё
        if user.is_superuser:
            return StaffUnit.objects.all()

        # Используем RBAC engine для фильтрации
        return get_user_scope_queryset(user, StaffUnit)

    # list() метод использует стандартную логику ModelViewSet
    # Фильтрация по ролям происходит в get_queryset()

    def retrieve(self, request, *args, **kwargs):
        """
        Получение детальной информации о штатной единице.
        Возвращает расширенный формат с дочерними единицами и статусами.
        """
        instance = self.get_object()
        serializer = StaffUnitDetailedSerializer(instance)
        return Response(serializer.data)

    def perform_create(self, serializer):
        """
        Проверка прав при создании штатной единицы
        - Пользователь может создавать только в своей области видимости
        """
        user = self.request.user
        division = serializer.validated_data.get('division')

        # Проверка что подразделение в области видимости пользователя
        if not user.is_superuser and hasattr(user, 'role_info'):
            # Создаем временный объект для проверки scope
            temp_obj = StaffUnit(division=division)
            if not check_permission(user, 'create_staffing_position', temp_obj):
                raise PermissionDenied(
                    "У вас нет прав для создания штатной единицы в этом подразделении"
                )

        serializer.save()

    def perform_update(self, serializer):
        """
        Проверка прав при обновлении штатной единицы
        - Пользователь может редактировать только в своей области видимости
        """
        user = self.request.user
        instance = self.get_object()

        # Проверка что объект в области видимости
        if not user.is_superuser:
            if not check_permission(user, 'edit_staffing_position', instance):
                raise PermissionDenied(
                    "У вас нет прав для редактирования этой штатной единицы"
                )

        serializer.save()

    def perform_destroy(self, instance):
        """
        Проверка прав при удалении штатной единицы
        - Пользователь может удалять только в своей области видимости
        """
        user = self.request.user

        # Проверка что объект в области видимости
        if not user.is_superuser:
            if not check_permission(user, 'delete_staffing_position', instance):
                raise PermissionDenied(
                    "У вас нет прав для удаления этой штатной единицы"
                )

        instance.delete()

    def update(self, request, *args, **kwargs):
        """
        Переопределенный метод UPDATE с поддержкой bulk update.

        Если в теле запроса есть поля 'children' или 'employee_statuses',
        используется bulk update. Иначе - стандартное обновление.
        """
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Проверка прав
        if not request.user.is_superuser:
            if not check_permission(request.user, 'edit_staffing_position', instance):
                raise PermissionDenied(
                    "У вас нет прав для редактирования этой штатной единицы"
                )

        # Проверяем, нужен ли bulk update
        if 'children' in request.data or 'employee_statuses' in request.data:
            return self._bulk_update(request, instance)

        # Стандартное обновление
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        # Возвращаем детальную информацию
        detailed_serializer = StaffUnitDetailedSerializer(instance)
        return Response(detailed_serializer.data)

    @transaction.atomic
    def _bulk_update(self, request, instance):
        """
        Bulk update штатной единицы, дочерних единиц и статусов сотрудников
        """
        bulk_serializer = StaffUnitBulkUpdateSerializer(data=request.data)
        bulk_serializer.is_valid(raise_exception=True)
        data = bulk_serializer.validated_data

        # 1. Обновляем основную штатную единицу
        if 'division' in data:
            instance.division = Division.objects.get(id=data['division'])
        if 'position' in data:
            from organization_management.apps.dictionaries.models import Position
            instance.position = Position.objects.get(id=data['position'])
        if 'employee' in data:
            from organization_management.apps.employees.models import Employee
            instance.employee = Employee.objects.get(id=data['employee']) if data['employee'] else None
        if 'vacancy' in data:
            instance.vacancy = Vacancy.objects.get(id=data['vacancy']) if data['vacancy'] else None
        if 'index' in data:
            instance.index = data['index']
        if 'parent_id' in data:
            instance.parent = StaffUnit.objects.get(id=data['parent_id']) if data['parent_id'] else None

        instance.save()

        # 2. Обновляем дочерние штатные единицы
        if 'children' in data:
            for child_data in data['children']:
                child_id = child_data.get('id')

                if child_id:
                    # Обновление существующей
                    try:
                        child = StaffUnit.objects.get(id=child_id)
                        # Проверка прав на дочернюю единицу
                        if not request.user.is_superuser:
                            if not check_permission(request.user, 'edit_staffing_position', child):
                                continue  # Пропускаем, если нет прав

                        if 'division' in child_data:
                            child.division = Division.objects.get(id=child_data['division'])
                        if 'position' in child_data:
                            from organization_management.apps.dictionaries.models import Position
                            child.position = Position.objects.get(id=child_data['position'])
                        if 'employee' in child_data:
                            from organization_management.apps.employees.models import Employee
                            child.employee = Employee.objects.get(id=child_data['employee']) if child_data['employee'] else None
                        if 'vacancy' in child_data:
                            child.vacancy = Vacancy.objects.get(id=child_data['vacancy']) if child_data['vacancy'] else None
                        if 'index' in child_data:
                            child.index = child_data['index']
                        if 'parent_id' in child_data:
                            child.parent = StaffUnit.objects.get(id=child_data['parent_id']) if child_data['parent_id'] else None

                        child.save()
                    except StaffUnit.DoesNotExist:
                        pass
                else:
                    # Создание новой дочерней единицы
                    division = Division.objects.get(id=child_data['division'])

                    # Проверка прав на создание
                    temp_obj = StaffUnit(division=division)
                    if not request.user.is_superuser:
                        if not check_permission(request.user, 'create_staffing_position', temp_obj):
                            continue  # Пропускаем, если нет прав

                    StaffUnit.objects.create(
                        division_id=child_data.get('division'),
                        position_id=child_data.get('position'),
                        employee_id=child_data.get('employee'),
                        vacancy_id=child_data.get('vacancy'),
                        index=child_data.get('index', 0),
                        parent_id=child_data.get('parent_id', instance.id)
                    )

        # 3. Обновляем статусы сотрудников
        if 'employee_statuses' in data:
            for status_data in data['employee_statuses']:
                employee_id = status_data['employee_id']

                try:
                    employee = Employee.objects.get(id=employee_id)

                    # Проверка прав на изменение статуса
                    if not request.user.is_superuser:
                        if not check_permission(request.user, 'change_employee_status', employee):
                            continue  # Пропускаем, если нет прав

                    # Создаем новый статус
                    EmployeeStatus.objects.create(
                        employee=employee,
                        status_type=status_data.get('status_type', 'in_service'),
                        state=status_data.get('state', 'active'),
                        start_date=status_data.get('start_date'),
                        end_date=status_data.get('end_date'),
                        comment=status_data.get('comment', ''),
                        created_by=request.user
                    )
                except Employee.DoesNotExist:
                    pass

        # Возвращаем обновленную штатную единицу с детальной информацией
        serializer = StaffUnitDetailedSerializer(instance)
        return Response(serializer.data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "search", str, description=(
                    "Отбор по ФИО, табельному номеру, должности и подразделению "
                    "(подстрока, без учёта регистра)."
                )
            ),
            OpenApiParameter("division_id", int, description="Только это подразделение."),
            OpenApiParameter(
                "status_not", str, description=(
                    "Исключить эти коды ДЕЙСТВУЮЩЕГО статуса (через запятую); строки без "
                    "статуса тоже исключаются. Так календарь берёт одни отсутствия."
                )
            ),
            OpenApiParameter(
                "employee_ids", str, description=(
                    "Только штатные единицы этих сотрудников: идентификаторы через "
                    "запятую, не больше 200."
                )
            ),
            OpenApiParameter(
                "position_level_max", int, description=(
                    "Должности не ниже уровня (`level <= N`; чем меньше число, тем выше "
                    "должность). Так отбирается руководство."
                )
            ),
            OpenApiParameter(
                "status", str, description=(
                    "Код ДЕЙСТВУЮЩЕГО статуса; `none` — те, у кого статуса нет."
                )
            ),
            OpenApiParameter(
                "page", int, description=(
                    "Номер страницы. БЕЗ него и без `page_size` ответ прежний — "
                    "весь состав подразделения (Plane №227)."
                )
            ),
            OpenApiParameter("page_size", int, description="Размер страницы; потолок 200."),
            OpenApiParameter(
                "with_summary", bool, description=(
                    "Добавить сводку по отбору: сколько людей, без статуса, "
                    "просрочено, запланировано."
                )
            ),
        ],
    )
    @action(detail=False, methods=['get', 'put', 'patch', 'post'], url_path='directorate')
    def directorate_management(self, request):
        """
        Эндпоинт для управления штатным расписанием своего подразделения.

        ROLE_3: Управляет своим управлением (level=2)
        ROLE_6: Управляет своим отделом (level=3)
        ROLE_7: Управляет своим департаментом (level=1)

        GET: Получить все штатные единицы своего подразделения
        PUT/PATCH/POST: Обновить штатные единицы, сотрудников и их статусы

        НЕ использует область видимости для GET эндпоинта - показывает только свое подразделение.
        """
        user = request.user

        # ── Кто сюда допущен (Plane №325, решение заказчика 30.08.2026) ────
        #
        # ДВА КАТАЛОГА РОЛЕЙ, И ОБА ОТКРЫВАЮТ ЭКРАН. Кадровый (`common.UserRole`,
        # ROLE_3/6/7) и каталог раздела ОМ (`operations`, права вида
        # `status.view`) не связаны между собой, а цикл расхода жил целиком в
        # первом. Из 38 учёток стенда экран проходили ЧЕТЫРЕ; не проходила ни
        # одна роль раздела — включая `role_department_expense_officer`, чьё
        # название буквально «ответственный за расход департамента», и
        # `role_division_operator`, который по замыслу и проставляет статусы.
        #
        # РАСШИРЯЕМ, НЕ ПОДМЕНЯЕМ: у кого кадровая роль ROLE_3/6/7 — доступ и
        # область прежние, строка в строку. Право раздела добавляется РЯДОМ
        # как второй ключ. Отвергнутые заказчиком варианты — выдавать кадровую
        # роль при заведении учётки (лечит симптом: следующая заведённая
        # руками снова окажется без доступа) и снять роли раздела с этого пути
        # вовсе.
        opened_by_ops_permission = False
        if not user.is_superuser:
            try:
                user_role = user.role_info  # OneToOneField
                role_code = user_role.get_role_code() if user_role else None
            except Exception:
                role_code = None
            if role_code not in ('ROLE_3', 'ROLE_6', 'ROLE_7'):
                # Право ЧТЕНИЯ СТАТУСОВ — то же, которым открыты борд расхода и
                # аналитика службы. Свой код права здесь не заводится: экран
                # показывает ровно то, что показывают они, и второе имя для
                # одного и того же разошлось бы с ними при первой же раздаче.
                opened_by_ops_permission = _has_ops_status_view(request)
                if not opened_by_ops_permission:
                    return Response(
                        {'error': (
                            'Доступ разрешен только для ROLE_3 (Начальник управления), '
                            'ROLE_6 (Начальник отдела), ROLE_7 (Начальник департамента) '
                            'или роли раздела с правом «Статусы: просмотр»'
                        )},
                        status=status.HTTP_403_FORBIDDEN
                    )

        # Признак «вошёл правом раздела» едет ВМЕСТЕ с запросом, а не считается
        # заново в каждом методе: резолюция прав стоит запросов, и второй счёт
        # мог бы разойтись с первым.
        request._directorate_by_ops_permission = opened_by_ops_permission

        if request.method == 'GET':
            return self._directorate_get(request, user)
        elif request.method == 'POST':
            return self._directorate_create(request, user)
        else:  # PUT, PATCH
            return self._directorate_update(request, user)

    def _directorate_get(self, request, user):
        """
        Получение всех штатных единиц своего подразделения с дочерними отделами.

        ROLE_3: управление + все дочерние отделы
        ROLE_6: отдел + все дочерние подразделения

        Возвращает ПЛОСКИЙ список (БЕЗ вложенного children), связи через parent_id.
        """
        # Подразделения, за которые отвечает пользователь: своё и дочерние, а у
        # суперпользователя — ВСЁ дерево, все корни (Plane №304).
        all_divisions = self._own_scope_divisions(user, request)

        if all_divisions is None:
            return Response(
                {'error': 'Не удалось определить подразделение пользователя'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Получаем штатные единицы из этих подразделений
        staff_units = StaffUnit.objects.filter(
            division__in=all_divisions
        ).select_related(
            # `employee__rank` — вместе с сотрудником: звание печатается в
            # КАЖДОЙ строке списка, без него был бы запрос на строку.
            'division', 'position', 'employee', 'employee__rank', 'vacancy'
        ).prefetch_related(
            # Правило «какой статус действующий» и его префетч — в
            # `statuses.selectors`, одним куском. Своя копия здесь уже
            # разъезжалась с копией в `staff_unit/serializers.py`.
            active_status_prefetch()
        ).order_by('tree_id', 'lft')

        # ── Отбор и страницы (Plane №227) ────────────────────────────────
        #
        # ОБА НЕОБЯЗАТЕЛЬНЫ, и это несущее решение, а не осторожность. Эту
        # ручку читают девять мест клиента, и календарю статусов и массовой
        # правке нужен ВЕСЬ состав подразделения: включи пагинацию по
        # умолчанию — восемь экранов молча получат первую страницу вместо
        # состава. Без параметров ответ прежний, строка в строку.
        #
        # ОТБОР СЧИТАЕТСЯ В БАЗЕ, а не в питоне: на пяти тысячах сотрудников
        # «загрузить всё и отфильтровать» стоит тех же мегабайт, ради которых
        # страницы и заводились.
        staff_units = self._directorate_filtered(staff_units, request)
        matched_count = staff_units.count()
        summary = (
            self._directorate_summary(staff_units)
            if request.query_params.get('with_summary') in ('1', 'true', 'True')
            else None
        )
        page, page_size = self._directorate_page(request)
        if page is not None:
            start = (page - 1) * page_size
            staff_units = staff_units[start:start + page_size]

        # Создаем плоский список с полной информацией (БЕЗ children)
        result = []
        for unit in staff_units:
            unit_data = {
                'id': unit.id,
                'division': {
                    'id': unit.division.id,
                    'name': unit.division.name,
                } if unit.division else None,
                'position': {
                    'id': unit.position.id,
                    'name': unit.position.name,
                    'level': unit.position.level,
                } if unit.position else None,
                'employee': None,
                'vacancy': None,
                'index': unit.index,
                'parent_id': unit.parent_id,
            }

            # Employee с current_status
            if unit.employee:
                # ЧТЕНИЕ НИЧЕГО НЕ ПИШЕТ. Здесь стояло
                # `EmployeeStatus.objects.create(...)` для сотрудников без
                # статуса — и работало это не так, как читается.
                #
                # `EmployeeStatus.save()` зовёт `full_clean()` (models.py:258),
                # а `created_by` объявлен без `blank=True`. Создание отсюда его
                # не передавало, поэтому ветка не создавала статус, а роняла
                # ВЕСЬ список: подразделение, где есть хоть один сотрудник без
                # действующего статуса, отвечало 500. В базе стенда её следов
                # нет ни одного — 0 записей с этим комментарием из 93.
                #
                # Если бы `created_by` передали, стало бы хуже, а не лучше:
                # запись при чтении делает GET неповторяемым (выдача меняет
                # выдачу следующего запроса), а `start_date=today` объявляет
                # «в строю с сегодня» тем, у кого статус был и завершён.
                #
                # Дефолтный «в строю» заводится там, где это осмысленно, —
                # `_directorate_create` при заведении сотрудника, с `created_by`.
                # Сотрудникам, заведённым мимо неё (сиды, импорт), статус ставит
                # разовая правка данных, а не ручка чтения.
                #
                # Прежний `.order_by('-created_at')` брал последний СОЗДАННЫЙ
                # статус независимо от состояния, и отменённый приезжал как
                # действующий. Теперь выбор — общий селектор; он же сам
                # подхватывает префетч и не делает лишнего запроса.
                current_status = active_status(unit.employee)

                unit_data['employee'] = {
                    'id': unit.employee.id,
                    'first_name': unit.employee.first_name,
                    'last_name': unit.employee.last_name,
                    # Кадровая подпись строки. Всё перечисленное лежит в
                    # модели `Employee` с самого начала и просто не клалось в
                    # ответ: список печатал под именем ПУСТУЮ строку (поле
                    # `manager`, захардкоженное `""`), а колонку с датой найма
                    # пришлось снять — вместо неё туда ехало начало текущего
                    # статуса.
                    #
                    # ИИН уходит только хвостом: списку он нужен, чтобы
                    # различить однофамильцев, и для этого достаточно четырёх
                    # цифр. Маскирует сервер — см. `employees.masking`.
                    'rank': (
                        unit.employee.rank.name if unit.employee.rank else None
                    ),
                    'iin_masked': mask_iin(unit.employee.iin),
                    # Адрес аватарки, а не путь файла: у списка нет и не должно
                    # быть знания о том, где лежит MEDIA_ROOT и какой у него
                    # префикс. Пусто — фотографии нет, и клиент рисует
                    # заглушку; выдумывать за него адрес «по соглашению» — это
                    # 404 в каждой строке при первой же смене хранилища.
                    'photo_url': unit.employee.photo.url if unit.employee.photo else None,
                    'hire_date': unit.employee.hire_date,
                    'birth_date': unit.employee.birth_date,
                    'personnel_number': unit.employee.personnel_number,
                    # Период едет вместе со статусом. Без него таблица статусов
                    # печатала «Не обновлено» и «Не указано» во ВСЕХ строках —
                    # две колонки на 362 px не несли ни бита, — а карточка
                    # сотрудника подставляла вместо даты сегодняшнее число.
                    # Даты в модели есть, их просто не клали в ответ; соседний
                    # EmployeeStatusBriefSerializer отдаёт все четыре поля.
                    'current_status': {
                        'status_type': current_status.status_type,
                        'state': current_status.state,
                        'start_date': current_status.start_date,
                        'end_date': current_status.end_date,
                    } if current_status else None
                }

            # Vacancy
            if unit.vacancy:
                unit_data['vacancy'] = {
                    'id': unit.vacancy.id,
                    'title': unit.vacancy.title,
                }

            result.append(unit_data)

        # `division` — подразделение, КОТОРЫМ описывается ответ. Пока область
        # это одно поддерево, оно и есть его корень; у суперпользователя,
        # видящего ВСЕ деревья, такого подразделения не существует, и раньше
        # сюда попадал первый корень из двух — ответ утверждал, что весь состав
        # службы лежит в «Службе», хотя четверо живут во втором корне (Plane
        # №304). Честный ответ на «каким одним подразделением это описать» в
        # таком случае — никаким: `null`. Читатель у поля один — диалог
        # заведения статуса, и у него есть запасной путь: подразделение
        # ШТАТНОЙ ЕДИНИЦЫ сотрудника, которое и без того точнее корня.
        scope_root = self._scope_single_root(user, all_divisions)

        return Response({
            'division': {
                'id': scope_root.id,
                'name': scope_root.name,
                'code': scope_root.code if hasattr(scope_root, 'code') else None,
            } if scope_root else None,
            'staff_units': result,
            # `total_count` — сколько строк В ОТВЕТЕ. Значение не менялось с
            # самого начала, и менять его нельзя: экран статусов печатает по
            # нему «сотрудников в подразделении».
            'total_count': len(result),
            # `matched_count` — сколько строк отвечает отбору. Без отбора и без
            # страниц равен `total_count`; со страницей по нему считается
            # «Показано N из M», и без него счётчик врал бы размером страницы.
            'matched_count': matched_count,
            # Сводка считается по ОТБОРУ и ДО страницы: экран статусов печатает
            # «нужно обновить / просрочено / запланировано» по всему
            # подразделению, и на странице в пятьдесят строк эти числа
            # означали бы совсем другое (Plane №231). Спрашивается явно —
            # тремя подзапросами платит только тот, кому сводка нужна.
            **({'summary': summary} if summary is not None else {}),
            **({
                'page': page,
                'page_size': page_size,
                'has_next': page * page_size < matched_count,
            } if page is not None else {}),
        })

    # ── отбор и страницы штатки (Plane №227) ─────────────────────────────

    #: Потолок страницы. Просьбу «дай десять тысяч» исполнять нельзя: она
    #: возвращает ровно ту нагрузку, ради которой страницы и заводились.
    DIRECTORATE_MAX_PAGE_SIZE = 200
    DIRECTORATE_DEFAULT_PAGE_SIZE = 50

    def _directorate_filtered(self, queryset, request):
        """Отбор списка штатки по параметрам запроса — целиком в базе."""
        search = (request.query_params.get('search') or '').strip()
        # ПОИСК ИДЁТ ПО СЛОВАМ, а не по строке целиком (Plane №312). Поле
        # подписано «Поиск по ФИО», и человек набирает «Абенов Канат» — а
        # подстрока целиком не совпадает НИ С ОДНИМ полем: фамилия и имя лежат
        # в разных колонках. Ответом был пустой список, и читался он как
        # «такого сотрудника нет».
        #
        # Каждое слово обязано найтись хоть где-то (И между словами, ИЛИ между
        # полями): так «Абенов Канат» сужает выборку до полных тёзок, а
        # «Абенов инспектор» — до Абеновых на должности инспектора. Обратное
        # правило (ИЛИ между словами) расширяло бы выдачу с каждым словом —
        # человек уточняет запрос и получает БОЛЬШЕ строк.
        for word in search.split():
            queryset = queryset.filter(
                Q(employee__last_name__icontains=word)
                | Q(employee__first_name__icontains=word)
                | Q(employee__middle_name__icontains=word)
                | Q(employee__personnel_number__icontains=word)
                | Q(position__name__icontains=word)
                | Q(division__name__icontains=word)
            )

        division_id = request.query_params.get('division_id')
        if division_id:
            queryset = queryset.filter(division_id=division_id)

        # Уровень должности («чем меньше число, тем выше»). Нужен полоске
        # руководства: ей десяток строк, а тянула она весь состав
        # подразделения — 2,7 МБ на пяти тысячах человек (Plane №235).
        # Отбор именно ПО УРОВНЮ, а не по списку кодов должностей: уровень —
        # серверная иерархия, а список кодов пришлось бы держать на клиенте и
        # чинить при каждой новой должности.
        # Точечный отбор по людям. Нужен диалогам статусов: им хватает одной
        # строки (или строк выбранных сотрудников), а тянули они весь состав
        # подразделения — 2,7 МБ ради одной строки на пяти тысячах человек
        # (Plane №234).
        employee_ids = (request.query_params.get('employee_ids') or '').strip()
        if employee_ids:
            try:
                wanted = [int(part) for part in employee_ids.split(',') if part.strip()]
            except (TypeError, ValueError):
                raise ValidationError(
                    {'employee_ids': 'Ожидается список целых чисел через запятую.'}
                )
            if len(wanted) > self.DIRECTORATE_MAX_PAGE_SIZE:
                raise ValidationError(
                    {'employee_ids': (
                        f'Не больше {self.DIRECTORATE_MAX_PAGE_SIZE} за раз — '
                        f'иначе это снова выгрузка всего состава.'
                    )}
                )
            queryset = queryset.filter(employee_id__in=wanted)

        level_max = request.query_params.get('position_level_max')
        if level_max not in (None, ''):
            try:
                queryset = queryset.filter(position__level__lte=int(level_max))
            except (TypeError, ValueError):
                # Мусор в параметре — это не «покажи всё»: молча отдать полный
                # состав значит вернуть ровно ту нагрузку, от которой отбор и
                # защищает.
                raise ValidationError(
                    {'position_level_max': 'Ожидается целое число.'}
                )

        # «Кроме этих статусов» — нужен календарю: он рисует ОТСУТСТВИЯ, то
        # есть всех, у кого текущий статус не «в строю» (Plane №236). Своего
        # агрегата ему не понадобилось: период календарь не спрашивает вовсе,
        # он раскладывает по дням ТЕКУЩИЕ статусы.
        status_not = (request.query_params.get('status_not') or '').strip()
        if status_not:
            excluded = [code.strip() for code in status_not.split(',') if code.strip()]
            queryset = queryset.annotate(
                excluded_status_type=Subquery(
                    EmployeeStatus.objects.filter(
                        employee_id=OuterRef('employee_id'),
                        state=EmployeeStatus.StatusState.ACTIVE,
                    )
                    .order_by(*CURRENT_STATUS_ORDER)
                    .values('status_type')[:1]
                )
            ).exclude(excluded_status_type__in=excluded).exclude(
                # «Нет статуса» — это тоже не отсутствие: у календаря такой
                # человек не даёт события, и тащить его строкой незачем.
                excluded_status_type__isnull=True
            )

        status_code = (request.query_params.get('status') or '').strip()
        if status_code:
            # Тип ДЕЙСТВУЮЩЕГО статуса берётся подзапросом в том же порядке,
            # что и `active_status` (`statuses.selectors`): у сотрудника может
            # быть несколько активных строк, и «есть статус такого типа» — это
            # ДРУГОЙ вопрос, чем «текущий статус такой». Экран показывает
            # второе, значит и отбирать надо по нему.
            current_type = Subquery(
                EmployeeStatus.objects.filter(
                    employee_id=OuterRef('employee_id'),
                    state=EmployeeStatus.StatusState.ACTIVE,
                )
                .order_by(*CURRENT_STATUS_ORDER)
                .values('status_type')[:1]
            )
            queryset = queryset.annotate(current_status_type=current_type)
            if status_code == 'none':
                queryset = queryset.filter(current_status_type__isnull=True)
            else:
                queryset = queryset.filter(current_status_type=status_code)

        return queryset

    def _directorate_summary(self, queryset):
        """Сводка по ОТБОРУ: сколько без статуса, просрочено, запланировано.

        Считается в базе одним проходом, а не обходом строк на клиенте: экран
        статусов раньше получал весь состав подразделения именно ради этих
        четырёх чисел (Plane №231).
        """
        active = EmployeeStatus.objects.filter(
            employee_id=OuterRef('employee_id'),
            state=EmployeeStatus.StatusState.ACTIVE,
        ).order_by(*CURRENT_STATUS_ORDER)
        # `localdate`, а не часы раздела ОМ: это портал, и деловая дата
        # раздела к сводке статусов отношения не имеет — тащить ради неё
        # зависимость от `operations` значило бы связать слои без нужды.
        today = timezone.localdate()
        rows = queryset.filter(employee__isnull=False).annotate(
            current_end=Subquery(active.values('end_date')[:1]),
            current_start=Subquery(active.values('start_date')[:1]),
            current_type=Subquery(active.values('status_type')[:1]),
        )
        return {
            'employees': rows.count(),
            'without_status': rows.filter(current_type__isnull=True).count(),
            'overdue': rows.filter(current_end__lt=today).count(),
            'scheduled': rows.filter(current_start__gt=today).count(),
        }

    def _directorate_page(self, request):
        """(номер страницы, размер) либо (None, размер) — если страниц не просили."""
        raw_page = request.query_params.get('page')
        raw_size = request.query_params.get('page_size')
        if raw_page is None and raw_size is None:
            return None, self.DIRECTORATE_DEFAULT_PAGE_SIZE

        def positive(raw, default):
            try:
                value = int(raw)
            except (TypeError, ValueError):
                return default
            return value if value > 0 else default

        page = positive(raw_page, 1)
        page_size = min(
            positive(raw_size, self.DIRECTORATE_DEFAULT_PAGE_SIZE),
            self.DIRECTORATE_MAX_PAGE_SIZE,
        )
        return page, page_size

    def _generate_personnel_number(self):
        """Генерация уникального табельного номера"""
        from django.db.models import Max

        # Находим максимальный существующий номер
        max_number = Employee.objects.filter(
            personnel_number__regex=r'^\d+$'  # Только числовые номера
        ).aggregate(
            max_num=Max('personnel_number')
        )['max_num']

        if max_number:
            try:
                next_number = int(max_number) + 1
            except (ValueError, TypeError):
                next_number = 1
        else:
            next_number = 1

        # Форматируем с ведущими нулями (6 цифр)
        return str(next_number).zfill(6)

    @transaction.atomic
    def _directorate_create(self, request, user):
        """Создание новых штатных единиц и сотрудников"""
        from django.utils import timezone
        from django.core.exceptions import ValidationError

        # Определяем СОБСТВЕННОЕ подразделение пользователя
        all_divisions = self._own_scope_divisions(user, request)

        if all_divisions is None:
            return Response(
                {'error': 'Не удалось определить подразделение пользователя'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Работа с управлением пользователя И всеми дочерними подразделениями;
        # у суперпользователя — со всем деревом (Plane №304).
        division_ids = list(all_divisions.values_list('id', flat=True))

        data = request.data
        created_items = {
            'employees': [],
            'staff_units': [],
        }
        errors = []

        # 1. СПЕРВА создаем всех сотрудников с savepoint для возможного отката
        if 'employees' in data:
            for employee_data in data['employees']:
                # Для создания - не должно быть ID
                if 'id' in employee_data:
                    errors.append({'employee': 'При создании не нужно указывать ID сотрудника'})
                    continue

                # Создаем savepoint для возможности отката если штатка не создастся
                sid = transaction.savepoint()

                try:
                    # Генерируем уникальный табельный номер
                    personnel_number = self._generate_personnel_number()

                    # Создаем сотрудника
                    employee = Employee(
                        personnel_number=personnel_number,
                        first_name=employee_data.get('first_name', ''),
                        last_name=employee_data.get('last_name', ''),
                        middle_name=employee_data.get('middle_name', ''),
                        iin=employee_data.get('iin', ''),
                    )

                    # Валидация перед сохранением (проверит ИИН)
                    employee.full_clean()
                    employee.save()

                    # Обработка rank если указан
                    if 'rank' in employee_data and employee_data['rank']:
                        from organization_management.apps.dictionaries.models import Rank
                        try:
                            rank = Rank.objects.get(id=employee_data['rank'])
                            employee.rank = rank
                            employee.save()
                        except Rank.DoesNotExist:
                            errors.append({'employee': f'Созданный ID {employee.id}: Звание с ID {employee_data["rank"]} не найдено'})

                    # Автоматически создаем статус "в строю"
                    EmployeeStatus.objects.create(
                        employee=employee,
                        status_type=EmployeeStatus.StatusType.IN_SERVICE,
                        start_date=timezone.now().date(),
                        state=EmployeeStatus.StatusState.ACTIVE,
                        comment='Автоматически создан при создании сотрудника',
                        created_by=user
                    )

                    # Сразу после создания сотрудника ищем его по ИИН и personnel_number
                    # чтобы получить ID для привязки к штатной единице
                    found_employee = Employee.objects.get(
                        iin=employee.iin,
                        personnel_number=employee.personnel_number
                    )
                    employee_id_for_staff_unit = found_employee.id

                    created_items['employees'].append({
                        'id': employee.id,
                        'personnel_number': employee.personnel_number,
                        'first_name': employee.first_name,
                        'last_name': employee.last_name,
                        'middle_name': employee.middle_name,
                        'iin': employee.iin,
                        '_employee_id_for_staff_unit': employee_id_for_staff_unit,
                        '_savepoint_id': sid,  # Сохраняем savepoint для возможного отката
                    })

                    # НЕ коммитим savepoint здесь - оставляем его открытым
                    # Он будет закоммичен автоматически при успешном создании штатной единицы
                    # Или откачен, если штатная единица не создастся

                except ValidationError as ve:
                    # Ошибка валидации - откатываем создание сотрудника
                    transaction.savepoint_rollback(sid)
                    errors.append({'employee': f'Ошибка валидации: {ve}'})
                except Exception as e:
                    # Любая ошибка - откатываем создание сотрудника
                    transaction.savepoint_rollback(sid)
                    errors.append({'employee': f'Ошибка создания сотрудника: {str(e)}'})

        # Вспомогательная функция для отката savepoint сотрудника
        def rollback_employee_savepoint(idx):
            """Откатывает savepoint сотрудника по индексу"""
            if idx < len(created_items['employees']):
                emp_data = created_items['employees'][idx]
                savepoint_id = emp_data.get('_savepoint_id')
                if savepoint_id:
                    try:
                        transaction.savepoint_rollback(savepoint_id)
                        # Удаляем из списка созданных
                        employee_id = emp_data.get('_employee_id_for_staff_unit')
                        created_items['employees'] = [
                            e for e in created_items['employees']
                            if e.get('_employee_id_for_staff_unit') != employee_id
                        ]
                    except Exception:
                        pass  # Игнорируем ошибки отката

        # 2. ПОТОМ создаем штатные единицы и привязываем сотрудников по ИИН
        if 'staff_units' in data:
            for idx, staff_unit_data in enumerate(data['staff_units']):
                # Для создания - не должно быть ID
                if 'id' in staff_unit_data:
                    rollback_employee_savepoint(idx)
                    errors.append({'staff_unit': 'При создании не нужно указывать ID штатной единицы'})
                    continue

                try:
                    # Проверяем что подразделение в области доступа
                    division_id = staff_unit_data.get('division')
                    if not division_id:
                        rollback_employee_savepoint(idx)
                        errors.append({'staff_unit': 'Не указано подразделение (division)'})
                        continue

                    if division_id not in division_ids:
                        rollback_employee_savepoint(idx)
                        errors.append({'staff_unit': f'Подразделение {division_id} не в вашей области доступа'})
                        continue

                    position_id = staff_unit_data.get('position')
                    if not position_id:
                        rollback_employee_savepoint(idx)
                        errors.append({'staff_unit': 'Не указана должность (position)'})
                        continue

                    # Генерируем уникальный index для этой комбинации division+position
                    from django.db.models import Max
                    max_index = StaffUnit.objects.filter(
                        division_id=division_id,
                        position_id=position_id
                    ).aggregate(max_idx=Max('index'))['max_idx']

                    if max_index is not None:
                        next_index = max_index + 1
                    else:
                        next_index = staff_unit_data.get('index', 1)

                    # Получаем employee_id из созданных сотрудников по индексу
                    employee_id = None
                    if idx < len(created_items['employees']):
                        # Берём ID сотрудника по тому же индексу
                        employee_id = created_items['employees'][idx].get('_employee_id_for_staff_unit')

                    # Если не нашли по индексу - пробуем найти по ИИН и personnel_number
                    if not employee_id:
                        iin = staff_unit_data.get('iin')
                        personnel_number = staff_unit_data.get('personnel_number')

                        if iin and personnel_number:
                            # Поиск по обоим полям для точности
                            try:
                                found_employee = Employee.objects.get(
                                    iin=iin,
                                    personnel_number=personnel_number
                                )
                                employee_id = found_employee.id
                            except Employee.DoesNotExist:
                                errors.append({'staff_unit': f'Индекс {idx}: Сотрудник с ИИН {iin} и табельным номером {personnel_number} не найден'})
                            except Employee.MultipleObjectsReturned:
                                errors.append({'staff_unit': f'Индекс {idx}: Найдено несколько сотрудников с ИИН {iin} и табельным номером {personnel_number}'})
                        elif iin:
                            # Поиск только по ИИН
                            try:
                                found_employee = Employee.objects.get(iin=iin)
                                employee_id = found_employee.id
                            except Employee.DoesNotExist:
                                errors.append({'staff_unit': f'Индекс {idx}: Сотрудник с ИИН {iin} не найден'})
                            except Employee.MultipleObjectsReturned:
                                errors.append({'staff_unit': f'Индекс {idx}: Найдено несколько сотрудников с ИИН {iin}'})

                    # Если сотрудник не найден - пропускаем создание штатной единицы
                    if not employee_id:
                        rollback_employee_savepoint(idx)
                        errors.append({'staff_unit': f'Индекс {idx}: Не удалось найти сотрудника для привязки. Штатная единица не создана.'})
                        continue

                    # Автоматическое определение родителя
                    parent_unit = None

                    try:
                        # 1. Получаем объект должности для проверки уровня
                        from organization_management.apps.dictionaries.models import Position
                        current_position = Position.objects.get(id=position_id)

                        # 2. Ищем начальника ВНУТРИ текущего подразделения
                        # Начальник - это тот, у кого уровень должности МЕНЬШЕ (выше ранг)
                        internal_boss = StaffUnit.objects.filter(
                            division_id=division_id,
                            position__level__lt=current_position.level
                        ).order_by('position__level').first()

                        if internal_boss:
                            parent_unit = internal_boss
                        else:
                            # 3. Если внутри начальника нет, ищем в РОДИТЕЛЬСКОМ подразделении
                            current_division = Division.objects.get(id=division_id)
                            if current_division.parent:
                                # В родительском подразделении ищем сотрудника с самым высоким рангом (min level)
                                parent_division_boss = StaffUnit.objects.filter(
                                    division=current_division.parent
                                ).order_by('position__level').first()

                                if parent_division_boss:
                                    parent_unit = parent_division_boss

                    except Exception as e:
                        # Логируем ошибку определения родителя, но не прерываем создание
                        print(f"Ошибка определения родителя: {e}")
                        pass

                    # Создаем штатную единицу
                    staff_unit = StaffUnit.objects.create(
                        division_id=division_id,
                        position_id=position_id,
                        index=next_index,
                        employee_id=employee_id,  # Привязываем сотрудника по найденному ID
                        parent_id=parent_unit.id if parent_unit else None
                    )

                    created_items['staff_units'].append({
                        'id': staff_unit.id,
                        'division': staff_unit.division_id,
                        'position': staff_unit.position_id,
                        'employee': staff_unit.employee_id,
                        'index': staff_unit.index,
                    })

                    # Штатная единица успешно создана - НЕ коммитим savepoint
                    # Он закоммитится автоматически в конце основной транзакции

                except Exception as e:
                    # Если штатная единица не создалась, откатываем создание связанного сотрудника через savepoint
                    if employee_id:
                        # Ищем сотрудника в списке созданных по employee_id
                        employee_found = False
                        for emp_data in created_items['employees']:
                            if emp_data.get('_employee_id_for_staff_unit') == employee_id:
                                employee_found = True
                                # Получаем savepoint этого сотрудника и откатываем его
                                savepoint_id = emp_data.get('_savepoint_id')
                                if savepoint_id:
                                    try:
                                        transaction.savepoint_rollback(savepoint_id)
                                        # Удаляем из списка созданных сотрудников
                                        created_items['employees'] = [
                                            emp for emp in created_items['employees']
                                            if emp.get('_employee_id_for_staff_unit') != employee_id
                                        ]
                                        errors.append({'staff_unit': f'Индекс {idx}: Штатная единица не создана, сотрудник откачен (ID {employee_id})'})
                                    except Exception as rollback_error:
                                        errors.append({'staff_unit': f'Индекс {idx}: Ошибка отката сотрудника (ID {employee_id}): {str(rollback_error)}'})
                                else:
                                    errors.append({'staff_unit': f'Индекс {idx}: Savepoint не найден для сотрудника (ID {employee_id})'})
                                break

                        if not employee_found:
                            errors.append({'staff_unit': f'Индекс {idx}: Сотрудник с ID {employee_id} не найден в списке созданных'})

                    errors.append({'staff_unit': f'Индекс {idx}: Ошибка создания штатной единицы: {str(e)}'})

        return Response({
            'success': True,
            'created': created_items,
            'errors': errors if errors else None,
        }, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def _directorate_update(self, request, user):
        """Обновление штатных единиц, сотрудников и статусов"""
        from organization_management.apps.employees.api.serializers import EmployeeSerializer
        from organization_management.apps.statuses.api.serializers import EmployeeStatusSerializer

        # Определяем СОБСТВЕННОЕ подразделение пользователя (НЕ область видимости)
        all_divisions = self._own_scope_divisions(user, request)

        if all_divisions is None:
            return Response(
                {'error': 'Не удалось определить подразделение пользователя'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Работа с управлением пользователя И всеми дочерними подразделениями;
        # у суперпользователя — со всем деревом (Plane №304).
        division_ids = list(all_divisions.values_list('id', flat=True))

        data = request.data
        updated_items = {
            'staff_units': 0,
            'employees': 0,
            'statuses': 0,
        }
        errors = []

        # 1. Обновление штатных единиц
        if 'staff_units' in data:
            for staff_unit_data in data['staff_units']:
                try:
                    staff_unit_id = staff_unit_data.get('id')
                    if not staff_unit_id:
                        errors.append({'staff_unit': 'ID штатной единицы обязателен'})
                        continue

                    # Проверяем что штатная единица принадлежит области видимости
                    staff_unit = StaffUnit.objects.get(id=staff_unit_id, division_id__in=division_ids)

                    # Обновляем поля штатной единицы
                    if 'division' in staff_unit_data and staff_unit_data['division'] in division_ids:
                        staff_unit.division = Division.objects.get(id=staff_unit_data['division'])
                    if 'position' in staff_unit_data:
                        from organization_management.apps.dictionaries.models import Position
                        staff_unit.position = Position.objects.get(id=staff_unit_data['position'])
                    if 'index' in staff_unit_data:
                        staff_unit.index = staff_unit_data['index']

                    staff_unit.save()
                    updated_items['staff_units'] += 1

                except StaffUnit.DoesNotExist:
                    errors.append({'staff_unit': f'Штатная единица {staff_unit_id} не найдена или нет доступа'})
                except Exception as e:
                    errors.append({'staff_unit': f'ID {staff_unit_id}: {str(e)}'})

        # 2. Обновление сотрудников
        if 'employees' in data:
            for employee_data in data['employees']:
                try:
                    employee_id = employee_data.get('id')
                    if not employee_id:
                        errors.append({'employee': 'ID сотрудника обязателен'})
                        continue

                    # Проверяем что сотрудник принадлежит области видимости
                    employee = Employee.objects.select_related('staff_unit__division').get(
                        id=employee_id,
                        staff_unit__division_id__in=division_ids
                    )

                    # Обновляем только разрешенные поля
                    allowed_fields = ['first_name', 'last_name', 'middle_name', 'iin']
                    for field in allowed_fields:
                        if field in employee_data:
                            setattr(employee, field, employee_data[field])

                    # Обработка rank отдельно (это ForeignKey)
                    if 'rank' in employee_data:
                        rank_id = employee_data['rank']
                        if rank_id:
                            from organization_management.apps.dictionaries.models import Rank
                            try:
                                rank = Rank.objects.get(id=rank_id)
                                employee.rank = rank
                            except Rank.DoesNotExist:
                                errors.append({'employee': f'ID {employee_id}: Звание с ID {rank_id} не найдено'})
                                continue
                        else:
                            employee.rank = None

                    employee.save()
                    updated_items['employees'] += 1

                except Employee.DoesNotExist:
                    errors.append({'employee': f'Сотрудник {employee_id} не найден или нет доступа'})
                except Exception as e:
                    errors.append({'employee': f'ID {employee_id}: {str(e)}'})

        # 3. Обновление/создание статусов сотрудников
        if 'employee_statuses' in data:
            for status_data in data['employee_statuses']:
                try:
                    employee_id = status_data.get('employee')
                    if not employee_id:
                        errors.append({'status': 'ID сотрудника обязателен'})
                        continue

                    # Проверяем что сотрудник принадлежит области видимости
                    employee = Employee.objects.select_related('staff_unit__division').get(
                        id=employee_id,
                        staff_unit__division_id__in=division_ids
                    )

                    status_id = status_data.get('id')

                    if status_id:
                        # Обновление существующего статуса
                        emp_status = EmployeeStatus.objects.get(
                            id=status_id,
                            employee=employee
                        )
                        serializer = EmployeeStatusSerializer(
                            emp_status,
                            data=status_data,
                            partial=True,
                            context={'request': request}
                        )
                        if serializer.is_valid():
                            serializer.save(created_by=user)
                            updated_items['statuses'] += 1
                        else:
                            errors.append({'status': f'Employee {employee_id}: {serializer.errors}'})
                    else:
                        # Создание нового статуса — ЧЕРЕЗ СЕРВИС, а не через
                        # сериализатор. Сериализатор кладёт строку РЯДОМ с
                        # действующим статусом, а модель пересечения запрещает:
                        # массовое обновление падало на каждом сотруднике, у
                        # которого статус уже был (то есть почти на каждом), и
                        # молча не делало ничего. Сервис сначала закрывает
                        # предыдущий статус — ровно как одиночная смена.
                        #
                        # Проверять данные сериализатором здесь тоже нельзя: он
                        # прогонит ту же проверку пересечений ДО закрытия
                        # предыдущего статуса и забракует корректный запрос.
                        # Валидируют модель и сервис, как на одиночном пути.
                        from organization_management.apps.statuses.application.services import (
                            StatusApplicationService,
                        )
                        # Даты приходят строками из JSON, а сервис и модель
                        # сравнивают их с датами.
                        start_date = _as_date(status_data.get('start_date'))
                        if start_date is None:
                            errors.append(
                                {'status': f'Employee {employee_id}: дата начала обязательна '
                                           f'и должна быть в формате ГГГГ-ММ-ДД'}
                            )
                            continue

                        StatusApplicationService().create_status(
                            employee_id=employee.id,
                            status_type=status_data.get('status_type'),
                            start_date=start_date,
                            end_date=_as_date(status_data.get('end_date')),
                            comment=status_data.get('comment') or '',
                            location=status_data.get('location') or '',
                            related_division_id=status_data.get('related_division'),
                            user=user,
                        )
                        updated_items['statuses'] += 1

                except Employee.DoesNotExist:
                    errors.append({'status': f'Сотрудник {employee_id} не найден или нет доступа'})
                except EmployeeStatus.DoesNotExist:
                    errors.append({'status': f'Статус {status_id} не найден'})
                except Exception as e:
                    errors.append({'status': f'Employee {employee_id}: {str(e)}'})

        # Формируем ответ
        #
        # `division` — то же поле и то же правило, что у GET (Plane №304): у
        # суперпользователя, распоряжающегося всеми деревьями, одного
        # описывающего подразделения нет, и вместо первого корня из двух здесь
        # честный `null`.
        scope_root = self._scope_single_root(user, all_divisions)
        response_data = {
            'success': True,
            'updated': updated_items,
            'division': {
                'id': scope_root.id,
                'name': scope_root.name,
            } if scope_root else None,
        }

        if errors:
            response_data['errors'] = errors
            response_data['success'] = len(errors) < sum(updated_items.values())

        return Response(response_data, status=status.HTTP_200_OK)

    def _get_user_division(self, user):
        """Определяет подразделение пользователя на основе его роли (для области видимости)"""
        if user.is_superuser:
            # Для суперпользователя можно вернуть корневое подразделение
            return Division.objects.filter(level=0).first()

        try:
            # Получаем роль пользователя (OneToOneField)
            user_role = user.role_info

            if not user_role:
                return None

            # Используем effective_scope_division из роли
            return user_role.effective_scope_division

        except Exception:
            return None

    def _scope_single_root(self, user, all_divisions):
        """Одно подразделение, описывающее область, либо `None`.

        Для обычного пользователя это его собственное подразделение. Для
        суперпользователя — единственный корень, если он один; при нескольких
        корнях одного такого подразделения НЕТ (Plane №304).
        """
        if not user.is_superuser:
            return self._get_user_own_division(user)

        roots = list(Division.objects.filter(level=0)[:2])
        return roots[0] if len(roots) == 1 else None

    def _own_scope_divisions(self, user, request=None):
        """Подразделения, которыми ручка `directorate` распоряжается за этого
        пользователя. `None` — подразделение не определено (ответ 400).

        🔴 У СУПЕРПОЛЬЗОВАТЕЛЯ ЭТО ВСЁ ДЕРЕВО, А НЕ ПЕРВЫЙ КОРЕНЬ (Plane №304).
        Раньше `_get_user_own_division` отдавала ему
        `Division.objects.filter(level=0).first()`, и слово «first» решало
        судьбу целой ветки: корней в базе бывает НЕСКОЛЬКО (на стенде их два —
        «Служба» и «Управление (стенд)»), а видел он один. Отсюда и брались два
        разных «состава» на экране статусов: шапка считала 436 занятых штатных
        единиц ПЕРВОГО корня, календарь — 440 активных сотрудников без деления
        на деревья. Четверо из второго корня не показывались в таблице вовсе,
        и никакая подпись этого не объясняла.

        У обычного пользователя область прежняя: своё подразделение и его
        потомки.
        """
        if user.is_superuser:
            return Division.objects.all()

        # ВОШЁЛ ПРАВОМ РАЗДЕЛА — И ОБЛАСТЬ БЕРЁТСЯ ОТТУДА ЖЕ (Plane №325).
        # Кадровый резолвер ниже читает `role_info` и штатную единицу; у
        # ролевой учётки раздела кадровая роль ROLE_1, и он либо вернул бы её
        # личное подразделение, либо ничего. Ни то, ни другое не описывает
        # область, которую даёт роль раздела: ответственному за расход
        # департамента положен департамент, а не комната, где он сидит.
        # Открыли дверь одним ключом — за ним и область.
        if request is not None and getattr(request, '_directorate_by_ops_permission', False):
            return _ops_scope_divisions(request)

        division = self._get_user_own_division(user)
        if not division:
            return None
        return division.get_descendants(include_self=True)

    def _get_user_own_division(self, user):
        """
        Определяет СОБСТВЕННОЕ подразделение пользователя (для directorate endpoint).

        НЕ использует область видимости - возвращает именно подразделение где работает сотрудник:
        - ROLE_3: управление (level=2) - поднимается до управления если сотрудник в отделе
        - ROLE_6: отдел (level=3) - возвращает отдел как есть
        - ROLE_7: департамент (level=1) - поднимается до департамента

        Для ROLE_7 scope_division имеет приоритет (может быть указан вручную).
        Для ROLE_3 и ROLE_6: если scope_division указан вручную и НЕ на уровне департамента - использует его.
        """
        if user.is_superuser:
            return Division.objects.filter(level=0).first()

        try:
            user_role = user.role_info
            if not user_role:
                return None

            role_code = user_role.get_role_code()

            # Для ROLE_7: приоритет у scope_division если указан на уровне департамента
            if role_code == 'ROLE_7':
                # Приоритет 1: Если scope_division указан вручную на уровне департамента (level=1)
                if user_role.scope_division and user_role.scope_division.level == 1:
                    return user_role.scope_division

                # Приоритет 2: Автоматическое определение - поднимаемся до департамента
                if hasattr(user, 'employee'):
                    employee = user.employee
                    if hasattr(employee, 'staff_unit') and employee.staff_unit:
                        division = employee.staff_unit.division
                        # Поднимаемся до департамента (level=1)
                        current = division
                        while current and current.level > 1:
                            current = current.parent
                        if current and current.level == 1:
                            return current
                        return division

                # Приоритет 3: Если scope_division на любом уровне
                if user_role.scope_division:
                    # Если не департамент - поднимаемся до департамента
                    current = user_role.scope_division
                    while current and current.level > 1:
                        current = current.parent
                    if current and current.level == 1:
                        return current
                    return user_role.scope_division

                return None

            # Для ROLE_3 и ROLE_6: старая логика
            # Приоритет 1: Если scope_division указан вручную И он НЕ департамент (level != 1)
            # то используем его (это управление или отдел)
            if user_role.scope_division and user_role.scope_division.level != 1:
                return user_role.scope_division

            # Приоритет 2: Автоматическое определение через Employee → StaffUnit → Division
            if hasattr(user, 'employee'):
                employee = user.employee
                if hasattr(employee, 'staff_unit') and employee.staff_unit:
                    division = employee.staff_unit.division

                    # Для ROLE_3 (Начальник управления): поднимаемся до управления (level=2)
                    if role_code == 'ROLE_3':
                        current = division
                        # Поднимаемся вверх пока не достигнем level=2 (управление)
                        while current and current.level > 2:
                            current = current.parent
                        if current and current.level == 2:
                            return current
                        # Если не нашли level=2, возвращаем как есть
                        return division

                    # Для ROLE_6 (Начальник отдела): возвращаем отдел как есть
                    return division

            # Приоритет 3: Если scope_division на уровне департамента, но больше нечего вернуть
            # возвращаем его (хотя это неправильно для directorate endpoint для ROLE_3 и ROLE_6)
            if user_role.scope_division:
                return user_role.scope_division

            return None

        except Exception:
            return None


class CanReadDirectorate(permissions.BasePermission):
    """Кадровое право ИЛИ право раздела — для ЧТЕНИЯ ручки `directorate`.

    Добавляется РЯДОМ с `CanViewStaffingTable`, а не вместо: у кого кадровое
    право есть, поведение прежнее, строка в строку. Второй ключ — право
    раздела `status.view` (Plane №325, решение заказчика 30.08.2026).
    """

    message = CanViewStaffingTable.message

    def has_permission(self, request, view):
        if CanViewStaffingTable().has_permission(request, view):
            return True
        return _has_ops_status_view(request)


def _has_ops_status_view(request):
    """Есть ли у актора право раздела «Статусы: просмотр» (Plane №325).

    Импорт локальный: `staff_unit` — старое приложение, и модульная связь с
    разделом ОМ протянула бы его зависимости во все его импорты. Отказ
    резолвера (нет актора, нет грантов) — это «нет права», а не пятисотка:
    гейт обязан оставаться fail-closed.
    """
    from organization_management.apps.operations.api.permissions import (
        effective_permissions,
    )

    try:
        perms = effective_permissions(request)
    except Exception:
        return False
    return '*' in perms or _OPS_READ_STATUS_PERMISSION in perms


def _ops_scope_divisions(request, permission_codes=(_OPS_READ_STATUS_PERMISSION,)):
    """Область подразделений, которую дают роли раздела (Plane №325, №339).

    Прав может быть НЕСКОЛЬКО: ручку статистики зовут и экраны расхода, и
    экран оргструктуры, и область актора — объединение областей всех прав,
    которыми ему эта ручка открыта. Одно право по умолчанию — чтобы читатели
    №325 остались прежними.

    `None` от резолвера означает «право без скоупа» (в т.ч. wildcard ADMIN) —
    разворачивается во ВСЁ дерево, как это делает `ops.daily`. Пустое
    множество означает «право есть, а области нет»: возвращаем пустую выборку,
    а не `None`, — иначе ответ 400 «не удалось определить подразделение» соврал
    бы про причину, которую №329 как раз научился отличать.
    """
    from organization_management.apps.operations.api.permissions import resolve_actor_id
    from organization_management.apps.operations.services import PermissionService

    actor_id = resolve_actor_id(request)
    if actor_id is None:
        return Division.objects.none()
    visible = set()
    for code in permission_codes:
        granted = PermissionService.visible_division_ids(actor_id, code)
        # None — грант без области (в т.ч. wildcard): накрывает всё дерево, и
        # объединять его с чем-либо дальше незачем.
        if granted is None:
            return Division.objects.all()
        visible |= set(granted)
    if not visible:
        return Division.objects.none()
    # Своё И потомки: область, выданная на департамент, обязана накрыть его
    # управления — иначе «ответственный за расход департамента» увидел бы одну
    # строку самого департамента и ни одного управления под ним.
    roots = Division.objects.filter(id__in=list(visible))
    ids = set(visible)
    for root in roots:
        ids.update(root.get_descendants(include_self=True).values_list('id', flat=True))
    return Division.objects.filter(id__in=ids)


def _ancestor_names(division):
    """Названия предков подразделения СВЕРХУ ВНИЗ, без корня организации.

    Зачем в ответе (Plane №214). Имена подразделений уникальны только внутри
    родителя: «Первое управление» законно есть в каждом департаменте, «Первый
    отдел» — в каждом управлении. Плоская таблица разреза печатала одно имя, и
    девять одинаковых строк «Первый отдел» различить было нечем. На шести
    подразделениях стенда это было невидимо — вылезло на 54.

    Корень отбрасывается сознательно: организация одна, и её имя в каждой
    строке — шум, а не сведения.
    """
    return [
        ancestor.name
        for ancestor in division.get_ancestors()
        if ancestor.division_type != Division.DivisionType.ORGANIZATION
    ]


class DivisionStatisticsViewSet(viewsets.ViewSet):
    """
    ViewSet для получения статистики по подразделениям в зависимости от роли пользователя.
    Показывает количество департаментов, управлений, отделов, штатных единиц, сотрудников и вакансий.
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = None  # ViewSet возвращает статистику в виде dict

    def list(self, request):
        """
        Возвращает статистику по области видимости пользователя.
        """
        user = request.user

        # ── Чья область (Plane №339) ──────────────────────────────────────
        #
        # ДВА КАТАЛОГА РОЛЕЙ, И ОБА ДАЮТ ОБЛАСТЬ — то же решение заказчика, что
        # в №325, применённое последовательно. Обход всех 28 ролевых учёток
        # 30.08.2026 показал: эта ручка отвечала 400 «Не удалось определить
        # область видимости пользователя» КАЖДОЙ из них, на ПЯТИ экранах
        # (`/dashboard`, `/employees` обоих видов, `/statuses`, `/organization`)
        # — 140 неудачных запросов за один обход. Причина та же: кадровый
        # резолвер читает `role_info`, а у ролевой учётки раздела кадровая роль
        # ROLE_1 и области у неё нет.
        #
        # Кадровый путь НЕ ТРОНУТ: у кого он даёт область, поведение прежнее,
        # строка в строку. Область раздела — запасной ключ, а не подмена.
        divisions_in_scope, scope_division = self._statistics_scope(request, user)

        if divisions_in_scope is None:
            return Response({
                'detail': 'Не удалось определить область видимости пользователя'
            }, status=status.HTTP_400_BAD_REQUEST)
        division_ids = list(divisions_in_scope.values_list('id', flat=True))

        # Подсчет по типам подразделений
        departments_count = divisions_in_scope.filter(division_type=Division.DivisionType.DEPARTMENT).count()
        directorates_count = divisions_in_scope.filter(division_type=Division.DivisionType.DIRECTORATE).count()
        divisions_count = divisions_in_scope.filter(division_type=Division.DivisionType.DIVISION).count()

        # Подсчет штатных единиц
        staff_units_count = StaffUnit.objects.filter(division_id__in=division_ids).count()

        # Подсчет сотрудников (штатные единицы с заполненным employee)
        employees_count = StaffUnit.objects.filter(
            division_id__in=division_ids,
            employee__isnull=False
        ).count()

        # Подсчет вакансий (штатные единицы без employee)
        vacancies_count = StaffUnit.objects.filter(
            division_id__in=division_ids,
            employee__isnull=True
        ).count()

        # Статистика по каждому департаменту
        departments_stats = []
        for dept in divisions_in_scope.filter(division_type=Division.DivisionType.DEPARTMENT):
            dept_descendants = dept.get_descendants(include_self=True)
            dept_division_ids = list(dept_descendants.values_list('id', flat=True))

            directorates_in_dept = dept_descendants.filter(division_type=Division.DivisionType.DIRECTORATE).count()
            divisions_in_dept = dept_descendants.filter(division_type=Division.DivisionType.DIVISION).count()
            staff_units_in_dept = StaffUnit.objects.filter(division_id__in=dept_division_ids).count()
            employees_in_dept = StaffUnit.objects.filter(
                division_id__in=dept_division_ids,
                employee__isnull=False
            ).count()
            vacancies_in_dept = StaffUnit.objects.filter(
                division_id__in=dept_division_ids,
                employee__isnull=True
            ).count()

            departments_stats.append({
                'department_id': dept.id,
                'department_name': dept.name,
                'ancestors': _ancestor_names(dept),
                'directorates_count': directorates_in_dept,
                'divisions_count': divisions_in_dept,
                'staff_units_count': staff_units_in_dept,
                'employees_count': employees_in_dept,
                'vacancies_count': vacancies_in_dept,
            })

        # Статистика по управлениям
        directorates_stats = []
        for directorate in divisions_in_scope.filter(division_type=Division.DivisionType.DIRECTORATE):
            dir_descendants = directorate.get_descendants(include_self=True)
            dir_division_ids = list(dir_descendants.values_list('id', flat=True))

            divisions_in_dir = dir_descendants.filter(division_type=Division.DivisionType.DIVISION).count()
            staff_units_in_dir = StaffUnit.objects.filter(division_id__in=dir_division_ids).count()
            employees_in_dir = StaffUnit.objects.filter(
                division_id__in=dir_division_ids,
                employee__isnull=False
            ).count()
            vacancies_in_dir = StaffUnit.objects.filter(
                division_id__in=dir_division_ids,
                employee__isnull=True
            ).count()

            directorates_stats.append({
                'directorate_id': directorate.id,
                'directorate_name': directorate.name,
                'ancestors': _ancestor_names(directorate),
                'divisions_count': divisions_in_dir,
                'staff_units_count': staff_units_in_dir,
                'employees_count': employees_in_dir,
                'vacancies_count': vacancies_in_dir,
            })

        # Статистика по отделам
        divisions_stats = []
        for division in divisions_in_scope.filter(division_type=Division.DivisionType.DIVISION):
            division_descendants = division.get_descendants(include_self=True)
            division_division_ids = list(division_descendants.values_list('id', flat=True))

            staff_units_in_division = StaffUnit.objects.filter(division_id__in=division_division_ids).count()
            employees_in_division = StaffUnit.objects.filter(
                division_id__in=division_division_ids,
                employee__isnull=False
            ).count()
            vacancies_in_division = StaffUnit.objects.filter(
                division_id__in=division_division_ids,
                employee__isnull=True
            ).count()

            divisions_stats.append({
                'division_id': division.id,
                'division_name': division.name,
                'ancestors': _ancestor_names(division),
                'staff_units_count': staff_units_in_division,
                'employees_count': employees_in_division,
                'vacancies_count': vacancies_in_division,
            })

        return Response({
            # `null`, когда область описывается НЕ ОДНИМ узлом (роль раздела
            # может видеть несколько поддеревьев). Тот же приём и тот же довод,
            # что у `division` в ручке `directorate` после №304: назвать такую
            # область первым попавшимся подразделением значило бы соврать, а
            # читатель обязан пережить `null` — он и переживает, поле
            # необязательное.
            'scope_division': None if scope_division is None else {
                'id': scope_division.id,
                'name': scope_division.name,
                'division_type': scope_division.division_type,
            },
            'summary': {
                'departments_count': departments_count,
                'directorates_count': directorates_count,
                'divisions_count': divisions_count,
                'staff_units_count': staff_units_count,
                'employees_count': employees_count,
                'vacancies_count': vacancies_count,
            },
            'departments': departments_stats,
            'directorates': directorates_stats,
            'divisions': divisions_stats,
        })

    def _statistics_scope(self, request, user):
        """Подразделения статистики и узел, ОДНИМ которым область описывается.

        Возвращает пару `(выборка, узел|None)`. Первое `None` — области нет
        вовсе (ответ 400). Второе `None` — область есть, но одного узла,
        который её называет, не существует.

        Порядок ровно тот же, что у ручки `directorate` после №325: сперва
        кадровая область, затем область РАЗДЕЛА. Права раздела принимаются два
        — `status.view` и `orgstructure.view`: ручку зовут и экраны расхода, и
        экран оргструктуры, и требовать от читателя оргструктуры право на
        статусы значило бы закрыть ему счётчики его же дерева.
        """
        scope_division = self._get_user_scope_division(user)
        if scope_division:
            return scope_division.get_descendants(include_self=True), scope_division

        from organization_management.apps.operations.api.permissions import (
            effective_permissions,
        )

        try:
            perms = effective_permissions(request)
        except Exception:
            perms = set()
        allowed = (
            '*' in perms
            or _OPS_READ_STATUS_PERMISSION in perms
            or _OPS_READ_ORGSTRUCTURE_PERMISSION in perms
        )
        if not allowed:
            return None, None
        divisions = _ops_scope_divisions(
            request,
            permission_codes=(
                _OPS_READ_STATUS_PERMISSION,
                _OPS_READ_ORGSTRUCTURE_PERMISSION,
            ),
        )
        # Пустая область — это НЕ «области нет»: право есть, подразделений под
        # ним нет. Ответ 400 соврал бы про причину, которую №329 как раз
        # научился отличать, поэтому отдаём пустую выборку и честные нули.
        #
        # Второе значение — `None`: область роли раздела может накрывать
        # несколько поддеревьев, и ОДНОГО подразделения, её описывающего, не
        # существует.
        return divisions, None

    def _get_user_scope_division(self, user):
        """Определяет область видимости пользователя"""
        if user.is_superuser:
            # Для суперпользователя возвращаем корневое подразделение
            return Division.objects.filter(parent__isnull=True).first()

        try:
            if hasattr(user, 'role_info'):
                user_role = user.role_info
                return user_role.effective_scope_division
        except Exception:
            pass

        return None
