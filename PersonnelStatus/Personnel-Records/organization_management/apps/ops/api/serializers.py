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


def _visit_placement(event, visit, *, single):
    """Готовность расстановки объекта посещения: (need, assigned) или (None, None).

    Расчёт постов ведётся строками `recon_sector_posts`; строка МОЖЕТ нести
    `visitObjectId` — тогда посты объекта известны точно. Пока разметки нет, у
    ЕДИНСТВЕННОГО объекта мероприятия все посты — его (это не допущение: другим
    объектам принадлежать они не могут). У второго и последующих объектов без
    разметки ответ неизвестен, и тогда возвращается None — экран назовёт
    причину. Делить общий расчёт поровну между объектами значило бы выдумать
    число, которого в системе нет.
    """
    posts = event.recon_sector_posts or []
    scoped = [
        p for p in posts if str(p.get("visitObjectId") or "") == str(visit.pk)
    ]
    if not scoped:
        if not single:
            return None, None
        scoped = posts
    need = sum(int(p.get("need") or 0) for p in scoped)
    post_ids = {str(p.get("id")) for p in scoped}
    assigned = sum(
        1
        for a in (event.placement_assignments or [])
        if str(a.get("postId")) in post_ids
    )
    return need, assigned


def serialize_visit_object(event, visit, *, single):
    need, assigned = _visit_placement(event, visit, single=single)
    return {
        "id": str(visit.pk),
        "objectId": (
            str(visit.security_object_id)
            if visit.security_object_id is not None
            else None
        ),
        "objectName": visit.object_name,
        "passportBinding": visit.passport_binding,
        "protectedPersonId": (
            str(visit.protected_person_id)
            if visit.protected_person_id is not None
            else None
        ),
        "protectedPersonName": visit.protected_person_name,
        "position": visit.position,
        # null — «неизвестно» (расчёт постов не размечен по объектам), 0 —
        # «посты не рассчитаны». Экран различает эти два случая словами.
        "placementNeed": need,
        "placementAssigned": assigned,
        # Замещающие — часть строки объекта, а не отдельный запрос: экран
        # показывает их в том же раскрытии реестра, и второй круг за списком
        # на каждую строку превратил бы раскрытие в N+1.
        "deputies": [
            {
                "id": str(d.pk),
                "employeeId": str(d.employee_id),
                "employeeName": d.employee_name,
                "canEditPlacement": d.can_edit_placement,
                "assignedBy": d.assigned_by,
                "assignedAt": d.created_at.isoformat(),
            }
            for d in visit.deputies.all()
        ],
    }


def _serialize_visit_objects(event):
    """Список объектов посещения ОМ в форме контракта.

    `single` считается ОДИН раз по всему списку: от него зависит, можно ли
    отнести нерасписанный расчёт постов к объекту (см. `_visit_placement`).
    """
    visits = list(event.visit_objects.prefetch_related("deputies"))
    single = len(visits) == 1
    return [serialize_visit_object(event, v, single=single) for v in visits]


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
        # Запрос личного состава с рекогносцировки: число и МОМЕНТ отправки
        # штабу. Момент нужен «Сбору сил» — лента штаба ведётся по нему.
        "reconForceRequest": event.recon_force_request,
        "reconForceRequestedAt": (
            None
            if event.recon_force_requested_at is None
            else event.recon_force_requested_at.isoformat()
        ),
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
        "businessDateEnd": (
            str(event.business_date_end) if event.business_date_end else None
        ),
        # Поля бюллетеня эталона. null у kind/eventTime/protectedPersonId —
        # «не заполнено», а не «внутреннее»/«00:00»: заполнять их за автора
        # нечем (см. models_event.OpsSecurityEvent.kind).
        "kind": event.kind or None,
        "eventTime": (
            event.event_time.strftime("%H:%M") if event.event_time else None
        ),
        "protectedPersonId": (
            str(event.protected_person_id)
            if event.protected_person_id is not None
            else None
        ),
        "protectedPersonName": event.protected_person_name,
        "location": event.location,
        "chiefEmployeeId": (
            str(event.chief_employee_id)
            if event.chief_employee_id is not None
            else None
        ),
        "chiefName": event.chief_name,
        "approvalRoute": event.approval_route or [],
        # Объекты посещения бюллетеня. Пустой список — только у строк, не
        # прошедших бэкфилл 0035 (их быть не должно); объект мероприятия сюда
        # перенесён как первый.
        "visitObjects": _serialize_visit_objects(event),
        "createdAt": event.created_at.isoformat(),
        "updatedAt": event.updated_at.isoformat(),
    }
