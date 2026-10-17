from django.db.models import Q
from rest_framework import serializers
from organization_management.apps.employees.models import Employee
from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.dictionaries.api.serializers import RankBriefSerializer

class EmployeeSerializer(serializers.ModelSerializer):
    """
    Сериализатор для модели Employee.
    """
    rank_detail = RankBriefSerializer(source='rank', read_only=True)
    # Неактивное звание закрыто для НОВОГО выбора (UC-REF-001); набор
    # уточняется в __init__ — своё текущее звание остаётся годным.
    rank = serializers.PrimaryKeyRelatedField(
        queryset=Rank.objects.filter(is_active=True), allow_null=True, required=False,
    )

    def __init__(self, *args, **kwargs):
        """Своё звание остаётся годным, даже если его деактивировали: полное
        обновление карточки не обязано спотыкаться о поле, которого никто не
        менял (UC-REF-001 §6 — существующие записи остаются)."""
        super().__init__(*args, **kwargs)
        current = getattr(self.instance, "rank_id", None)
        if current is not None:
            self.fields["rank"].queryset = Rank.objects.filter(
                Q(is_active=True) | Q(pk=current)
            )

    class Meta:
        model = Employee
        fields = '__all__'
