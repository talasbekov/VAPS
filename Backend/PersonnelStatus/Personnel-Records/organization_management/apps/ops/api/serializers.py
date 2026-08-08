"""Сериализаторы раздела «Охранные мероприятия».

Наружу — контракт клиента, который уже написан: SPA раздела
(PersonalRecordFront, features/objects/model/types.ts) ждёт `SecurityObject` с
полями в camelCase. Внутри — обычный snake_case модели. Перевод держится здесь
и только здесь: переименовывать поля модели ради формы ответа значило бы
тащить чужой стиль в схему базы.
"""
from rest_framework import serializers

from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)


class SecurityObjectSerializer(serializers.ModelSerializer):
    """Строка реестра охраняемых объектов в контракте клиента.

    ГРАНИЦА СРЕЗА. `sectors`, `passportVersions` и блоки `freshness`/`kpi`/
    `freshnessPolicy` списочного ответа сюда НЕ входят: под ними свои таблицы
    и своя настраиваемая политика, они приходят следующими срезами. Отдать их
    пустыми значило бы выдать «этой части ещё нет» за «у объекта нет
    паспорта» — клиент эти два случая не различил бы.

    `type` — имя контракта; в модели поле зовётся `object_type`, потому что
    `type` внутри питона затеняет встроенное имя.
    """

    type = serializers.CharField(source="object_type", read_only=True)
    objectState = serializers.CharField(source="object_state", read_only=True)
    passportState = serializers.CharField(source="passport_state", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = OpsSecurityObject
        fields = [
            "id",
            "name",
            "code",
            "type",
            "region",
            "address",
            "objectState",
            "passportState",
            "createdAt",
            "updatedAt",
        ]
        read_only_fields = fields
