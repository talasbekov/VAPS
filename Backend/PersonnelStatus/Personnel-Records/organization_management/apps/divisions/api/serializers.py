from typing import List, Dict, Any
from rest_framework import serializers
from rest_framework_recursive.fields import RecursiveField
from drf_spectacular.utils import extend_schema_field
from organization_management.apps.divisions.models import Division

class DivisionSerializer(serializers.ModelSerializer):
    """
    Сериализатор для модели Division.
    Использует рекурсивное поле для отображения дочерних подразделений.
    """
    children = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Division
        fields = (
            'id',
            'name',
            'code',
            'division_type',
            'parent',
            'is_active',
            'order',
            'children',
        )

    def validate_parent(self, parent):
        if self.instance is not None:
            if parent == self.instance:
                raise serializers.ValidationError(
                    'Подразделение не может быть родителем самому себе.'
                )
            if parent is not None and parent in self.instance.get_descendants():
                raise serializers.ValidationError(
                    'Нельзя перемещать подразделение в собственный потомок.'
                )

        future_depth = len(parent.get_ancestors()) + 1 if parent is not None else 0
        if future_depth > 5:
            raise serializers.ValidationError('Максимальная глубина иерархии — 5 уровней.')

        return parent

    @extend_schema_field(serializers.ListSerializer(child=serializers.DictField()))
    def get_children(self, obj) -> List[Dict[str, Any]]:
        """
        Рекурсивно сериализует дочерние подразделения.
        """
        return DivisionSerializer(obj.get_children(), many=True).data
