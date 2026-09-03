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
from organization_management.apps.ops import security_events
from organization_management.apps.ops import vehicles as vehicles_service


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
    # Разрез — один на весь раздел (`security_events.visit_object_posts`):
    # так же считает согласование объекта (Plane №411) и экран этапа. Вторая
    # копия правила разошлась бы с первой при первой же правке.
    scoped = security_events.visit_object_posts(event, visit)
    unmarked = [p for p in posts if not str(p.get("visitObjectId") or "")]
    if unmarked:
        # НЕРАЗМЕЧЕННЫЕ строки и делают ответ неизвестным (Plane №409). У
        # единственного объекта они всё равно его — принадлежать другим
        # некому. У второго и последующих — неизвестно, и None честнее числа.
        if not single:
            return None, None
        # При единственном объекте `visit_object_posts` неразмеченные строки
        # уже вернул — доклеивать их второй раз значило бы посчитать дважды.
    # Разметка полная: объект без своих постов — это НОЛЬ, а не «неизвестно».
    # До №409 здесь возвращался None, и объект, которому ничего не расписали,
    # выглядел на экране так же, как объект, про который нечего сказать.
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
        # День посещения и примечание переехали из патча сводки ГВО («Реестр
        # ОМ-35.1»): null в `visitDay` — «в день мероприятия», а не «не
        # знаем».
        "visitDay": (
            visit.visit_day.isoformat() if visit.visit_day is not None else None
        ),
        "note": visit.note,
        # Старший ОБЪЕКТА («Реестр ОМ-35.2») — не старший мероприятия: у
        # визита иностранного ОЛ объектов несколько, ответственный у каждого
        # свой. null — не назначен, и это ответ.
        "chiefEmployeeId": (
            str(visit.chief_employee_id)
            if visit.chief_employee_id is not None
            else None
        ),
        "chiefName": visit.chief_name,
        # null — «неизвестно» (расчёт постов не размечен по объектам), 0 —
        # «посты не рассчитаны». Экран различает эти два случая словами.
        "placementNeed": need,
        "placementAssigned": assigned,
        # ── Согласование ОБЪЕКТА (Plane №411, Ш-5 плана №385) ──────────────
        # Требование `[МД-04]`: «У объекта свои этапы 1–5 и свой документ
        # „Расстановка сил“ с версиями». Одноимённые поля мероприятия ниже
        # остаются и до Ш-7 показывают состояние ПЕРВОГО объекта — старый
        # клиент ничего не теряет, новый читает разрез.
        "approvalStatus": visit.approval_status,
        "approvalComment": visit.approval_comment,
        "approvalRoute": visit.approval_route or [],
        "approvalRemarks": visit.approval_remarks or [],
        # ВЫВОД, а не поле: «расстановка объекта изменилась после отправки».
        "approvalStale": security_events.approval_is_stale(event, visit),
        # 0 — документ не уходил согласующим; растёт отправкой на согласование.
        # Историю версий ведёт №398 [СОГ-04].
        "documentVersion": visit.document_version,
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


def _primary_approval(event, field):
    """Поле согласования ПЕРВОГО объекта — то, чем отвечают поля мероприятия.

    Мост до Ш-7 (№413), который эти поля снимет. Объектов нет вовсе — ответ
    берётся у мероприятия: у таких строк согласование ещё лежит там, и
    подменять его пустотой значило бы стереть с экрана живые данные.
    """
    visit = security_events.primary_visit_object(event)
    if visit is None:
        return getattr(event, field)
    return getattr(visit, field)


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
        # Раскладка потребности по департаментам и её итог. Итог считает
        # сервер: «сколько ещё не разложено» — правило, по которому он же
        # отбивает перебор, и второй счёт на клиенте разошёлся бы с ним молча.
        #
        # ЛЮДИ В СТРОКАХ БЕРУТСЯ ИЗ СТАТУСОВ (Plane №274, Ш-5), а не только из
        # ручного набора штаба: начальник управления ставит статус участия в
        # своём расходе, и человек обязан появиться у ответственного за
        # департамент. Разбор — в `security_events.allocation_members_view`.
        "forceAllocation": security_events.allocation_members_view(event),
        # Состав мероприятия — принятые штабом люди (шаг «СС-5»): из него
        # расстановка берёт кандидатов.
        "forceRoster": security_events.force_roster_view(event),
        "forceDemandTotal": security_events.force_demand_total(event),
        # Назначения идут с подразделением и статусом дня — они считаются
        # на чтении (см. security_events.placement_assignments_view).
        "placementAssignments": security_events.placement_assignments_view(event),
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
        # ВЕСЬ список лиц бюллетеня (Plane №188). Поля выше остаются и означают
        # ГЛАВНОЕ лицо — колонка «ОЛ» бланка одна, и кто-то обязан в неё
        # попасть. Клиенты, написанные до №188, продолжают читать главное и
        # ничего не теряют; список — добавка рядом, а не подмена.
        #
        # Сортировка ПО ИМЕНИ, а не по порядку вставки: у M2M своего порядка
        # нет, и вывод «как легло» менялся бы от перезаписи списка, читаясь при
        # этом как значимый. Главное лицо названо отдельным полем, поэтому
        # старшинства в списке не требуется.
        "protectedPersons": [
            {"id": str(person.pk), "name": person.name}
            for person in sorted(
                event.protected_persons.all(), key=lambda p: p.name
            )
        ],
        "location": event.location,
        "chiefEmployeeId": (
            str(event.chief_employee_id)
            if event.chief_employee_id is not None
            else None
        ),
        "chiefName": event.chief_name,
        # 🔴 МАРШРУТ И ЗАМЕЧАНИЯ МЕРОПРИЯТИЯ — ВИД ПЕРВОГО ОБЪЕКТА (Plane
        # №411). Мутации согласования пишут в объект, а не в мероприятие;
        # столбцы `OpsSecurityEvent.approval_route/remarks/snapshot` остались
        # только под старых читателей и снимаются в Ш-7 (№413). Отдавать их
        # содержимое значило бы показывать состояние, которого уже никто не
        # правит, — поэтому здесь ответ ПЕРВОГО объекта: ровно его и показывал
        # экран до разреза, когда согласование было одно на мероприятие.
        "approvalRoute": _primary_approval(event, "approval_route") or [],
        "approvalRemarks": _primary_approval(event, "approval_remarks") or [],
        # ВЫВОД, а не поле: «расстановка изменилась после отправки» клиент
        # иначе считал бы сам — то есть завёл бы вторую реализацию правила,
        # по которой сервер завершение этапа не блокирует.
        "approvalStale": security_events.approval_is_stale(event),
        # Объекты посещения бюллетеня. Пустой список — только у строк, не
        # прошедших бэкфилл 0035 (их быть не должно); объект мероприятия сюда
        # перенесён как первый.
        "visitObjects": _serialize_visit_objects(event),
        # Выделенный транспорт из реестра ГОН (Plane №215). Свободный текст
        # «Выделяемый транспорт» в патче сводки ГВО ОСТАЁТСЯ и живёт своей
        # жизнью: у него есть читатели (сводка и документ сводных данных), и
        # снимать источник, пока его читают, правило раздела запрещает.
        "vehicles": vehicles_service.list_event_vehicles(event),
        "createdAt": event.created_at.isoformat(),
        "updatedAt": event.updated_at.isoformat(),
    }
