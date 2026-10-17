from typing import List, Dict, Any
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from organization_management.apps.dictionaries.models import (
    Position,
    Rank
)
from organization_management.apps.statuses.models import EmployeeStatus


class _LifecycleFields(serializers.ModelSerializer):
    """Общие поля жизненного цикла кадрового справочника (UC-REF-001).

    Только на чтение: активность меняется действием `set-active`, преемник —
    действием `supersede`. Так запись не может стать неактивной «мимоходом»
    при корректировке подписи, и дата неактуальности не расходится с
    событием, которое её поставило.
    """

    confirmSimilar = serializers.BooleanField(write_only=True, required=False, default=False)
    lastChange = serializers.SerializerMethodField()
    supersedes = serializers.PrimaryKeyRelatedField(read_only=True)

    def get_lastChange(self, obj):
        from organization_management.apps.dictionaries import lifecycle
        from organization_management.apps.dictionaries.review import change_metadata
        if "dictionary_changes" not in self.context:
            view = self.context.get("view")
            ids = list(view.get_queryset().values_list("pk", flat=True)) if view else [obj.pk]
            self.context["dictionary_changes"] = change_metadata(lifecycle._entity(obj), ids)
        return self.context["dictionary_changes"].get(obj.pk)

    def validate(self, attrs):
        if self.instance is not None:
            from organization_management.apps.operations.exceptions import DomainError
            if not self.instance.is_active:
                raise DomainError("DICTIONARY_ENTRY_INACTIVE", 409, message="Корректировать можно только активное значение.")
            if "code" in attrs and attrs["code"] != getattr(self.instance, "code", None):
                raise serializers.ValidationError({"code": "Код после создания не меняется. Используйте замену."})
        return attrs
    superseded_by = serializers.SerializerMethodField()
    usage = serializers.SerializerMethodField()

    def get_superseded_by(self, obj) -> int | None:
        # Через `.all()`, а не `.first()`: так предзагрузка вьюсета
        # (`prefetch_related("superseded_by")`) отвечает из памяти, и список
        # справочника не делает по запросу на строку.
        successor = next(iter(obj.superseded_by.all()), None)
        return successor.pk if successor else None

    def get_usage(self, obj) -> dict:
        from organization_management.apps.dictionaries import lifecycle
        return lifecycle.usage_of(obj)


class PositionSerializer(_LifecycleFields):
    """Должность. `code` в полях ОБЯЗАТЕЛЕН (Plane №274).

    Его тут не было, и пока ручка работала только на чтение, это не мешало.
    С открытием записи выяснилось: без `code` завести должность через API
    нельзя вообще — база отбивает пустой код ограничением
    `ck_position_code_not_blank`, и клиент получает 500 вместо формы с полем.
    """

    class Meta:
        model = Position
        fields = ["id", "name", "name_kk", "code", "level",
                  "is_active", "inactive_since", "supersedes", "superseded_by", "usage", "lastChange", "confirmSimilar"]
        read_only_fields = ["is_active", "inactive_since"]


class RankSerializer(_LifecycleFields):
    """Звание. Поля перечислены явно вместо `__all__` (UC-REF-001, §6):
    `created_at`/`updated_at` из ответа уходят — их никто не читал
    (`EmployeeSerializer.rank_detail` в том числе)."""

    class Meta:
        model = Rank
        fields = ["id", "name", "name_kk", "code", "level",
                  "is_active", "inactive_since", "supersedes", "superseded_by", "usage", "lastChange", "confirmSimilar"]
        read_only_fields = ["is_active", "inactive_since"]


class PositionBriefSerializer(serializers.ModelSerializer):
    """Должность ВЛОЖЕНИЕМ в чужой ответ (штатная единица).

    Отдельный сериализатор, а не `PositionSerializer`, ИЗ-ЗА СВЯЗЕЙ: `usage`
    и `superseded_by` стоят трёх запросов на строку, и штатное расписание на
    442 единицы платило бы за них больше тысячи запросов на один список.
    Потребителю связи не нужны — ему нужна подпись и признак активности
    (бейдж «неактивна»).
    """

    class Meta:
        model = Position
        fields = ["id", "name", "name_kk", "code", "level", "is_active", "inactive_since"]


class RankBriefSerializer(serializers.ModelSerializer):
    """Звание вложением в карточку сотрудника. Довод тот же, что у должности."""

    class Meta:
        model = Rank
        fields = ["id", "name", "name_kk", "code", "level", "is_active", "inactive_since"]


class StatusTypeListSerializer(serializers.Serializer):
    status_types = serializers.SerializerMethodField()

    @staticmethod
    @extend_schema_field({'type': 'array', 'items': {'type': 'object', 'properties': {
        'value': {'type': 'string'},
        'label': {'type': 'string'}
    }}})
    def get_status_types(obj) -> List[Dict[str, str]]:
        return [
            {"value": value, "label": label}
            for value, label in EmployeeStatus.StatusType.choices
        ]


from organization_management.apps.operations.models_geo import OpsCountry, OpsCity


class CountrySerializer(_LifecycleFields):
    class Meta:
        model = OpsCountry
        fields = ["id", "code", "name", "name_kk", "is_active", "inactive_since", "supersedes",
                  "superseded_by", "usage", "lastChange", "confirmSimilar"]
        read_only_fields = ["is_active", "inactive_since"]

    def validate_code(self, value):
        import re
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", value):
            raise serializers.ValidationError("Код страны — две латинские буквы ISO.")
        return value


class CitySerializer(_LifecycleFields):
    country_name = serializers.CharField(source="country.name", read_only=True)

    class Meta:
        model = OpsCity
        fields = ["id", "country", "country_name", "name", "name_kk", "is_active", "inactive_since",
                  "supersedes", "superseded_by", "usage", "lastChange", "confirmSimilar"]
        read_only_fields = ["is_active", "inactive_since"]

    def validate_country(self, value):
        if self.instance is not None and value.pk != self.instance.country_id:
            raise serializers.ValidationError("Изменение страны требует записи-преемника.")
        if not value.is_active and (self.instance is None or value.pk != self.instance.country_id):
            raise serializers.ValidationError("Выберите активную страну.")
        return value
