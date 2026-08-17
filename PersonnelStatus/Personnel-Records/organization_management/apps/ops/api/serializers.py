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
    hasSecurityEvents = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    sectors = serializers.SerializerMethodField()
    passportVersions = serializers.SerializerMethodField()

    def get_hasSecurityEvents(self, obj):
        """Вкладка «Объекты ОМ» реестра — ПРОИЗВОДНЫЙ признак, не хранимый.

        Читается из аннотации набора, а не через obj.security_events.exists():
        второе дало бы запрос на строку. Запасной путь оставлен для одиночного
        retrieve, где аннотации нет.
        """
        annotated = getattr(obj, "has_security_events", None)
        if annotated is not None:
            return annotated
        return obj.security_events.exists()

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
            "ownership",
            "hasSecurityEvents",
            "sectors",
            "passportVersions",
            "createdAt",
            "updatedAt",
        ]
        read_only_fields = fields


def serialize_security_event(event):
    """ОМ в форме контракта клиента (SecurityEvent, camelCase).

    Словарь руками, а не ModelSerializer: половина полей — JSONB уже В ФОРМЕ
    контракта (их не во что «переводить»), а вторая половина — переименования
    snake→camel; декларативный сериализатор здесь свёлся бы к тому же списку,
    только разнесённому по двум местам.
    """
    return {
        "id": str(event.pk),
        "code": event.code,
        "title": event.title,
        "objectId": (
            str(event.security_object_id)
            if event.security_object_id is not None
            else None
        ),
        "objectName": event.object_name,
        "passportBinding": event.passport_binding,
        "businessDate": event.business_date.isoformat(),
        "stage": event.stage,
        "readinessPercent": event.readiness_percent,
        "forceNeed": event.force_need,
        "conflictsCount": event.conflicts_count,
        "ownerName": event.owner_name,
        "briefDescription": event.brief_description,
        "initialTasks": event.initial_tasks,
        "reconChecklist": event.recon_checklist,
        "reconSectorPosts": event.recon_sector_posts,
        "demandRows": event.demand_rows,
        "demandApproved": event.demand_approved,
        "forceRequests": event.force_requests,
        "placementAssignments": event.placement_assignments,
        "approvalStatus": event.approval_status,
        "approvalComment": event.approval_comment,
        "journalEntries": event.journal_entries,
        "closureDirectionSummaries": event.closure_direction_summaries,
        "closedAt": (
            event.closed_at.isoformat() if event.closed_at is not None else None
        ),
        "approvalRoute": event.approval_route or [],
        "createdAt": event.created_at.isoformat(),
        "updatedAt": event.updated_at.isoformat(),
    }
