"""Сериализаторы core: контракт нового бэка поверх старых моделей.

Порт полей из Backend/VAPS apps/core/api/serializers.py. Модель НЕ переносится:
у донора Division — своя таблица с FK на Organization и на справочник
DivisionType, здесь та же сущность уже живёт как divisions.Division (MPTT,
int-pk, division_type строкой). Наружу отдаём донорскую форму, читаем старую.
"""
from rest_framework import serializers

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee


class DivisionSerializer(serializers.ModelSerializer):
    """Донорский контракт: id, organization, parent, type_code, name, code,
    is_active.

    `type_code` у донора — FK на справочник DivisionType, здесь CharField с
    choices. Наружу оба отдают код строкой, поэтому расхождение остаётся
    внутри и клиента не касается.

    `organization` у донора — отдельная сущность. В старой структуре её нет:
    организация — это КОРЕНЬ дерева, узел с division_type='organization'.
    Поэтому поле вычисляется как корень поддерева, а не как parent: у узла
    глубже второго уровня это разные вещи.
    """

    type_code = serializers.CharField(source="division_type", read_only=True)
    organization = serializers.SerializerMethodField()

    class Meta:
        model = Division
        fields = [
            "id",
            "organization",
            "parent",
            "type_code",
            "name",
            "code",
            "is_active",
        ]
        read_only_fields = fields

    def get_organization(self, obj: Division) -> int:
        # get_root() у MPTT берёт корень СВОЕГО дерева. Брать «первый
        # organization в базе» нельзя: на стенде деревьев несколько, и узлы
        # чужого дерева получили бы чужую организацию.
        #
        # Корень отдаём даже если его division_type не 'organization':
        # подменять его на None значило бы прятать кривое дерево от клиента,
        # а чинить форму дерева — не дело сериализатора.
        return obj.get_root().id


class EmployeeSerializer(serializers.ModelSerializer):
    """Донорский контракт кадровой карточки поверх старой Employee.

    Три группы полей:

    СОБИРАЮТСЯ. `full_name` — из трёх частей; `rank_code`/`rank_index` — из
    справочника звания; `position_code` и `division` — ЧЕРЕЗ ШТАТНУЮ ЕДИНИЦУ:
    в старой схеме должность и подразделение висят на StaffUnit, а не на
    самой Employee.

    ИСТОЧНИКА НЕТ — `external_id`, `phone`, `height_cm`, `is_attached_force`,
    `data_source`. Отдаются null. Подставить сюда похожее поле было бы хуже
    молчания: `phone` рядом с work_phone выглядел бы заполненным, но означал
    бы не то, и клиент не отличил бы «нет данных» от «данные есть, но другие».

    ОСТАЛЬНОЕ читается напрямую.
    """

    full_name = serializers.SerializerMethodField()
    rank_code = serializers.SerializerMethodField()
    rank_index = serializers.SerializerMethodField()
    position_code = serializers.SerializerMethodField()
    division = serializers.SerializerMethodField()
    photo_file_path = serializers.SerializerMethodField()

    # Полей нет в старой схеме — отдаём null, но держим в контракте: клиент
    # SPA сгенерирован из схемы донора и ждёт именно этот набор ключей.
    external_id = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    height_cm = serializers.SerializerMethodField()
    is_attached_force = serializers.SerializerMethodField()
    data_source = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id", "external_id", "iin", "full_name", "last_name", "first_name",
            "middle_name", "rank_code", "rank_index", "position_code",
            "division", "phone", "gender", "height_cm", "is_active",
            "is_attached_force", "data_source", "personnel_number",
            "birth_date", "photo_file_path", "hire_date", "dismissal_date",
            "work_phone", "work_email", "personal_phone", "personal_email",
            "notes", "employment_status",
        ]
        read_only_fields = fields

    def get_full_name(self, obj: Employee) -> str:
        # filter() убирает пустое отчество: без него в имени остался бы
        # двойной пробел или хвост.
        return " ".join(
            part for part in (obj.last_name, obj.first_name, obj.middle_name)
            if part
        )

    def _staff_unit(self, obj: Employee):
        # OneToOne с related_name='staff_unit'; у непринятого на должность
        # сотрудника его нет, и это норма, а не ошибка данных.
        return getattr(obj, "staff_unit", None)

    def get_rank_code(self, obj: Employee):
        return obj.rank.code if obj.rank_id else None

    def get_rank_index(self, obj: Employee):
        # У донора это порядковый индекс звания в иерархии; здесь ту же роль
        # играет level («чем меньше число, тем выше звание»).
        return obj.rank.level if obj.rank_id else None

    def get_position_code(self, obj: Employee):
        unit = self._staff_unit(obj)
        return unit.position.code if unit and unit.position_id else None

    def get_division(self, obj: Employee):
        unit = self._staff_unit(obj)
        return unit.division_id if unit else None

    def get_photo_file_path(self, obj: Employee):
        # Путь файла, а не URL: контракт донора хранит именно путь.
        return obj.photo.name or None if obj.photo else None

    def get_external_id(self, obj: Employee) -> None:
        return None

    def get_phone(self, obj: Employee) -> None:
        return None

    def get_height_cm(self, obj: Employee) -> None:
        return None

    def get_is_attached_force(self, obj: Employee) -> None:
        return None

    def get_data_source(self, obj: Employee) -> None:
        return None


class PositionSerializer(serializers.ModelSerializer):
    """Донорский контракт справочника должностей: code, name, level,
    sort_order, is_active.

    Читаются напрямую `code` (заведён срезом 154a), `name` и `level` —
    последний совпадает и по смыслу: «чем меньше число, тем выше должность».

    ИСТОЧНИКА НЕТ — `sort_order` и `is_active`. Отдаются null по тому же
    доводу, что и null-поля EmployeeSerializer (срез 154b): подставить сюда
    похожее поле было бы хуже молчания. `sort_order` ← `level` выглядел бы
    заданным порядком, хотя порядка в старой схеме нет вовсе, а `is_active`
    со значением True объявил бы действующей строку, у которой признака нет.
    """

    # Полей нет в старой схеме — отдаём null, но держим в контракте: клиент
    # SPA сгенерирован из схемы донора и ждёт именно этот набор ключей.
    sort_order = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = ["code", "name", "level", "sort_order", "is_active"]
        read_only_fields = fields

    def get_sort_order(self, obj: Position) -> None:
        return None

    def get_is_active(self, obj: Position) -> None:
        return None
