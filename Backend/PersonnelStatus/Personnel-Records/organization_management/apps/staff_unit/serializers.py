from typing import Any, Dict, Optional
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import Vacancy, StaffUnit
from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.dictionaries.api.serializers import PositionSerializer as DictionaryPositionSerializer
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import active_status


class VacancySerializer(serializers.ModelSerializer):
    class Meta:
        model = Vacancy
        fields = '__all__'

class DivisionBriefSerializer(serializers.ModelSerializer):
    """Краткий сериализатор подразделения для использования в StaffUnit"""
    class Meta:
        model = Division
        fields = ["id", "name"]


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ["id", "name"]

class EmployeeStatusBriefSerializer(serializers.ModelSerializer):
    """Краткий сериализатор статуса сотрудника для использования в StaffUnit"""
    class Meta:
        model = EmployeeStatus
        fields = ("status_type", "state", "start_date", "end_date")


class EmployeeSerializer(serializers.ModelSerializer):
    rank = serializers.PrimaryKeyRelatedField(queryset=Rank.objects.all())
    current_status = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Employee
        fields = ["id", "first_name", "last_name", "current_status", "rank"]
        extra_kwargs = {
            "first_name": {"required": True},
            "last_name": {"required": True},
        }

    @extend_schema_field(EmployeeStatusBriefSerializer(allow_null=True))
    def get_current_status(self, obj: Employee) -> Optional[Dict[str, Any]]:
        """Действующий статус сотрудника; `None` — такого нет.

        Правило «какой статус текущий» живёт в `statuses.selectors`: раньше оно
        было здесь СВОЕЙ копией (порядок `-start_date` без доводчика), а рядом
        в `staff_unit/views.py` — другой.

        Синтетического «в строю» больше нет. Отсутствие статуса — это факт, и
        подменять его правдоподобным объектом БЕЗ ДАТ значило врать дважды:
        экран показывал статус, которого нет в базе, и period-колонки при этом
        оставались пустыми. Теперь у каждого работающего сотрудника статус есть
        по-настоящему — его держит сигнал `give_new_employee_a_status` и
        команда `ensure_employee_statuses`.
        """
        status = active_status(obj)
        return EmployeeStatusBriefSerializer(status).data if status else None


class StaffUnitSerializer(serializers.ModelSerializer):
    # Вложенные объекты для чтения
    division_data = DivisionBriefSerializer(source='division', read_only=True)
    position_data = DictionaryPositionSerializer(source='position', read_only=True)
    employee_data = EmployeeSerializer(source='employee', read_only=True)
    vacancy_data = VacancySerializer(source='vacancy', read_only=True)

    # ID поля для записи
    division = serializers.PrimaryKeyRelatedField(
        queryset=Division.objects.all(),
        required=True,
        write_only=False
    )
    position = serializers.PrimaryKeyRelatedField(
        queryset=Position.objects.all(),
        required=True,
        write_only=False
    )
    employee = serializers.PrimaryKeyRelatedField(
        queryset=Employee.objects.all(),
        required=False,
        allow_null=True,
        write_only=False
    )
    vacancy = serializers.PrimaryKeyRelatedField(
        queryset=Vacancy.objects.all(),
        required=False,
        allow_null=True,
        write_only=False
    )

    class Meta:
        model = StaffUnit
        fields = [
            "id",
            "division", "division_data",
            "position", "position_data",
            "employee", "employee_data",
            "vacancy", "vacancy_data",
            "index", "parent_id"
        ]

    def to_representation(self, instance):
        """Кастомизация вывода - показываем полные объекты, а не ID"""
        representation = super().to_representation(instance)
        # Заменяем ID на полные объекты для удобства фронтенда
        representation['division'] = representation.pop('division_data')
        representation['position'] = representation.pop('position_data')
        representation['employee'] = representation.pop('employee_data')
        representation['vacancy'] = representation.pop('vacancy_data')
        return representation


class EmployeeStatusBulkSerializer(serializers.Serializer):
    """Сериализатор для bulk update статуса сотрудника"""
    employee_id = serializers.IntegerField(required=True)
    # Наборы берутся из СПРАВОЧНИКА, а не из списка в коде: переписанный
    # список уже расходился с моделью — в нём не было 'leave_by_report', и
    # массовое обновление молча не умело ставить отпуск по рапорту.
    #
    # 🔴 И НЕ `ChoiceField` (Plane №354 → №352). `choices` вычисляются ОДИН РАЗ
    # при импорте модуля, а каталог типов правится в админке на живой системе:
    # тип, заведённый заказчиком, модель уже принимает (choices с поля сняты),
    # а ручка отбивала бы его четырёхсоткой до перезапуска процесса. Проверка
    # перенесена в `validate_status_type` — она спрашивает справочник в момент
    # запроса.
    status_type = serializers.CharField(required=False, max_length=100)
    state = serializers.ChoiceField(
        choices=EmployeeStatus.StatusState.choices,
        required=False
    )
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False, allow_null=True)
    comment = serializers.CharField(required=False, allow_blank=True)

    def validate_status_type(self, value):
        """Код принимается, если его знает справочник — свой или legacy.

        Отказ называет ПРИЧИНУ и не перечисляет весь каталог: девятнадцать
        кодов в тексте ошибки не помогают тому, кто прислал опечатку, а
        помогают тому, кто перебирает.
        """
        from organization_management.apps.statuses import catalog

        if value not in catalog.known_codes():
            raise serializers.ValidationError(
                f"Тип статуса «{value}» не найден в справочнике типов статусов "
                "или деактивирован."
            )
        return value


class ChildStaffUnitBulkSerializer(serializers.Serializer):
    """Сериализатор для bulk update дочерних штатных единиц"""
    id = serializers.IntegerField(required=False, allow_null=True)  # None для создания новой
    division = serializers.IntegerField(required=False)
    position = serializers.IntegerField(required=False)
    employee = serializers.IntegerField(required=False, allow_null=True)
    vacancy = serializers.IntegerField(required=False, allow_null=True)
    index = serializers.IntegerField(required=False)
    parent_id = serializers.IntegerField(required=False, allow_null=True)


class StaffUnitBulkUpdateSerializer(serializers.Serializer):
    """
    Bulk update сериализатор для штатной единицы.
    Обновляет саму единицу, дочерние единицы, сотрудников и их статусы.
    """
    # Основные поля штатной единицы
    division = serializers.IntegerField(required=False)
    position = serializers.IntegerField(required=False)
    employee = serializers.IntegerField(required=False, allow_null=True)
    vacancy = serializers.IntegerField(required=False, allow_null=True)
    index = serializers.IntegerField(required=False)
    parent_id = serializers.IntegerField(required=False, allow_null=True)

    # Дочерние штатные единицы
    children = ChildStaffUnitBulkSerializer(many=True, required=False)

    # Обновление статусов сотрудников
    employee_statuses = EmployeeStatusBulkSerializer(many=True, required=False)


class StaffUnitDetailedSerializer(serializers.ModelSerializer):
    """
    Расширенный сериализатор для детального отображения штатной единицы.
    Включает полную информацию о дочерних единицах и сотрудниках.
    """
    # Вложенные объекты для чтения
    division = DivisionBriefSerializer(read_only=True)
    position = DictionaryPositionSerializer(read_only=True)
    employee = EmployeeSerializer(read_only=True)
    vacancy = VacancySerializer(read_only=True)

    # Дочерние штатные единицы (рекурсивно)
    children = serializers.SerializerMethodField()

    # Статусы сотрудника (если есть)
    employee_statuses = serializers.SerializerMethodField()

    class Meta:
        model = StaffUnit
        fields = [
            "id",
            "division",
            "position",
            "employee",
            "vacancy",
            "index",
            "parent_id",
            "children",
            "employee_statuses"
        ]

    def get_children(self, obj):
        """Получить всех дочерних с полной информацией"""
        children = obj.get_children()
        if children:
            # Используем упрощенную версию для дочерних
            return StaffUnitSerializer(children, many=True).data
        return []

    def get_employee_statuses(self, obj):
        """Получить последние статусы сотрудника"""
        if obj.employee:
            statuses = obj.employee.statuses.order_by('-created_at')[:5]
            return EmployeeStatusBriefSerializer(statuses, many=True).data
        return []


class DirectorateStaffUnitSerializer(StaffUnitDetailedSerializer):
    """
    Сериализатор для directorate endpoint.
    Фильтрует children чтобы показывать ТОЛЬКО штатные единицы из того же подразделения.
    """

    def get_children(self, obj):
        """
        Получить дочерние штатные единицы ТОЛЬКО из того же подразделения.
        Для directorate endpoint не показываем штатные единицы из дочерних подразделений.
        """
        # Получаем всех MPTT детей
        children = obj.get_children()

        if children:
            # Фильтруем только тех, кто в том же division
            children_same_division = children.filter(division=obj.division)
            if children_same_division.exists():
                # Рекурсивно используем тот же сериализатор
                return DirectorateStaffUnitSerializer(children_same_division, many=True).data

        return []
