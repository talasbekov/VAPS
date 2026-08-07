"""Сериализаторы core: контракт нового бэка поверх старых моделей.

Порт полей из Backend/VAPS apps/core/api/serializers.py. Модель НЕ переносится:
у донора Division — своя таблица с FK на Organization и на справочник
DivisionType, здесь та же сущность уже живёт как divisions.Division (MPTT,
int-pk, division_type строкой). Наружу отдаём донорскую форму, читаем старую.
"""
from rest_framework import serializers

from organization_management.apps.divisions.models import Division


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
