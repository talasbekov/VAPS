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
        read_only_fields = ('is_active',)
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
        children = obj.get_children()
        allowed = self.context.get("visible_division_ids")
        if allowed is not None:
            children = children.filter(pk__in=allowed)
        return DivisionSerializer(children, many=True, context=self.context).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        allowed = self.context.get("visible_division_ids")
        if allowed is not None and data["parent"] not in allowed:
            data["parent"] = None
        return data
