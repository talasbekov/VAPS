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
from organization_management.apps.ops.passport import snapshot_sectors


class SecurityObjectSerializer(serializers.ModelSerializer):
    """Объект в контракте клиента: строка реестра + паспорт (срез A2).

    `sectors` — действующая редакция-черновик (реляционные строки),
    `passportVersions` — неизменяемые снимки публикаций (JSONB). Блоки
    `freshness`/`kpi`/`freshnessPolicy` живут НЕ здесь, а в конверте
    списочного ответа: они считаются по всему реестру и бизнес-дате запроса,
    у строки объекта их нет.

    `type` — имя контракта; в модели поле зовётся `object_type`, потому что
    `type` внутри питона затеняет встроенное имя. `id` — строка: так его
    объявляет контракт клиента (mock раздавал строковые id, и форма/роутер
    экрана сравнивают их как строки).
    """

    id = serializers.CharField(source="pk", read_only=True)
    type = serializers.CharField(source="object_type", read_only=True)
    objectState = serializers.CharField(source="object_state", read_only=True)
    passportState = serializers.CharField(source="passport_state", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    sectors = serializers.SerializerMethodField()
    passportVersions = serializers.SerializerMethodField()

    def get_sectors(self, obj):
        # Та же форма, что у снимка версии, — черновик и снимок читает один
        # и тот же компонент формы паспорта.
        return snapshot_sectors(obj)

    def get_passportVersions(self, obj):
        return [
            {
                "id": str(version.pk),
                "versionNumber": version.version_number,
                "effectiveFrom": version.effective_from.isoformat(),
                "publishedAt": version.published_at.isoformat(),
                "publishedBy": version.published_by,
                "note": version.note,
                "sectors": version.sectors_snapshot,
            }
            for version in obj.passport_versions.all()
        ]

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
            "sectors",
            "passportVersions",
            "createdAt",
            "updatedAt",
        ]
        read_only_fields = fields
