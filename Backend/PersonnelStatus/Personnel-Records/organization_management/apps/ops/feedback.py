"""Обратная связь (§28) — серверная реализация контракта клиента
(entities/ops-feedback): порт мок-слоя хоста ДОСЛОВНО.

Видимость: свои обращения — всегда; чужие — по праву «видеть все»; чужой
ЧЕРНОВИК не открывается никаким правом — отправки не было, показать
недописанный текст значило бы отдать его без ведома написавшего.

Конфиденциальность закрывает СОДЕРЖАНИЕ (описание, шаги, контакт, вложения,
техническую информацию), но не тему/тип/статус/модуль — иначе реестр
перестаёт быть реестром. Вырезает СЕРВЕР: спрятанное вёрсткой всё равно
приехало бы в браузер и легло в кэш запросов. Превью — производное описания
и вырезается ВМЕСТЕ с ним. Область поиска — только видимые смотрящему поля:
поиск по вырезанному описанию выдавал бы его содержимое фактом совпадения.

Лента (timeline + audit — ОДНА) пишется ДИФФОМ в единственной точке
(_commit_change): операции меняют поля и ничего не знают о ленте — забытое
событие иначе не сломало бы ни одного теста и молча оставило бы аудит
неполным.
"""
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_feedback import (
    OpsFeedbackComment,
    OpsFeedbackEvent,
    OpsFeedbackRegistry,
    OpsFeedbackRequest,
)

# §28: читать реестр — своих всегда, чужих только с view_all; завести
# обращение — отдельно от чтения (право пожаловаться ≠ право читать чужие
# жалобы); содержание чужого конфиденциального — своё разрешение; разбор и
# внутренние заметки — свои права (заметка пишется О ЧЕЛОВЕКЕ, обратившемся
# за помощью, и право её вести — не то же, что право менять статус).
VIEW_PERMISSION = "feedback.view"
CREATE_PERMISSION = "feedback.create"
VIEW_ALL_PERMISSION = "feedback.view_all"
VIEW_CONFIDENTIAL_PERMISSION = "feedback.view_confidential"
TRIAGE_PERMISSION = "feedback.triage"
INTERNAL_NOTE_PERMISSION = "feedback.internal_note"

MAX_SUBJECT = 160
MAX_DESCRIPTION = 4000
PREVIEW_LENGTH = 120
# Размер страницы намеренно мал — как в моке: при странице в полсотни строк
# вторая страница на живых данных не наступила бы, и пагинация жила бы
# непроверенной.
FEEDBACK_PAGE_SIZE = 4

# Тексты — канон контракта (entities/ops-feedback), дословно: их печатают
# экраны, и разошедшаяся строка ломала бы e2e-пины клиента.
RESTRICTED_REASON = (
    "Обращение помечено автором как конфиденциальное: содержание доступно "
    "автору и обладателю права ops.feedback.view_confidential."
)
CLOSED_LOCK_REASON = (
    "Обращение закрыто: изменения и комментарии в закрытое обращение не "
    "добавляются."
)
DRAFT_LOCK_REASON = (
    "Черновик не разбирают и не комментируют: он ещё не отправлен."
)
DRAFT_ACTION_REASON = (
    "Обращение ещё не отправлено: черновик не разбирают и не комментируют."
)
INTERNAL_NOTE_REASON = (
    "Внутренняя заметка требует отдельного права ops.feedback.internal_note: "
    "право отвечать автору его не включает."
)
TRIAGE_REASON = (
    "Разбор обращения требует права ops.feedback.triage: право читать "
    "обращения его не включает."
)
REPLY_REASON = (
    "Публичный ответ пишет разбирающий обращение (ops.feedback.triage) или "
    "его автор."
)

UNAVAILABLE_CAPABILITIES = [
    {
        "code": "ATTACHMENT_CONTENT",
        "label": "Содержимое вложений",
        "reason": (
            "Blob-хранилища в проекте нет. §28 требует «attachment metadata» "
            "— сохраняются имя, размер и тип файла; содержимое не читается и "
            "не передаётся, поэтому и скачать вложение нельзя."
        ),
    },
    {
        "code": "NOTIFY_AUTHOR",
        "label": "Уведомление автора об ответе",
        "reason": (
            "Канал уведомлений раздела ОМ несёт события оценивания; события "
            "обратной связи появятся в нём отдельным срезом — обещать "
            "доставку раньше consumer'а значило бы обещать то, чего нет."
        ),
    },
]

UNAVAILABLE_CARD_BLOCKS = [
    {
        "code": "ATTACHMENT_CONTENT",
        "label": "Содержимое вложений",
        "reason": (
            "Blob-хранилища в проекте нет: карточка показывает имя, размер и "
            "тип файла. Кнопки скачивания нет — скачивать нечего."
        ),
    },
    {
        "code": "SLA",
        "label": "Срок реакции",
        "reason": (
            "Политики сроков (SLA) в модели нет, а срок, посчитанный по "
            "умолчанию, был бы обещанием, которого никто не давал."
        ),
    },
    {
        "code": "LINKED_ENTITY",
        "label": "Связанная сущность",
        "reason": (
            "«Related screen» карточка показывает маршрутом, с которого "
            "обращение завели. Связь с конкретной записью в модели не "
            "хранится: восстанавливать её по тексту значило бы угадывать."
        ),
    },
]


# ── Справочник ──────────────────────────────────────────────────────────────


def _registry():
    row = OpsFeedbackRegistry.objects.filter(singleton_key=1).first()
    if row is None:
        # Стенд без сида — дефект развёртывания, не ситуация данных.
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            message="Справочник обратной связи не засеян (seed_operations).",
        )
    return row


def _serialize_registry(row):
    return {
        "types": row.types,
        "priorities": row.priorities,
        "statuses": row.statuses,
        "modules": row.modules,
        "statusTransitions": row.status_transitions,
        "terminalStatuses": row.terminal_statuses,
        "registryVersion": row.version,
    }


def _allowed_transitions(row, from_code):
    for entry in row.status_transitions:
        if entry["from"] == from_code:
            return list(entry["to"])
    return []


def _is_terminal(row, status_code):
    return status_code in row.terminal_statuses


# ── Видимость и проекция ────────────────────────────────────────────────────


def _has(perms, code):
    return "*" in perms or code in perms


def _is_own(request, actor):
    return actor is not None and request.author_user_id == actor


def _is_visible(request, actor, perms):
    """Черновик — единственное, что НЕ открывается правом «видеть все»."""
    if _is_own(request, actor):
        return True
    if request.status_code == "DRAFT":
        return False
    return _has(perms, VIEW_ALL_PERMISSION)


def _content_visible(request, actor, perms):
    if not request.confidential:
        return True
    if _is_own(request, actor):
        return True
    return _has(perms, VIEW_CONFIDENTIAL_PERMISSION)


def _preview_of(description):
    single = " ".join(description.split())
    if len(single) <= PREVIEW_LENGTH:
        return single
    return f"{single[:PREVIEW_LENGTH].rstrip()}…"


def _iso(value):
    return value.isoformat() if value is not None else None


def _project(request, actor, perms):
    """Проекция наружу: тема/тип/приоритет/статус/модуль видимы и у
    конфиденциального — закрыто именно СОДЕРЖАНИЕ. Решения службы (рабочий
    приоритет, ответственный) — не содержание обращения, признак
    конфиденциальности их не закрывает."""
    visible = _content_visible(request, actor, perms)
    return {
        "feedbackId": str(request.pk),
        "subject": request.subject,
        "typeCode": request.type_code,
        "priorityCode": request.priority_code,
        "statusCode": request.status_code,
        "moduleCode": request.module_code,
        "authorLabel": request.author_label,
        "createdAt": _iso(request.created_at),
        "submittedAt": _iso(request.submitted_at),
        "confidential": request.confidential,
        "workingPriorityCode": request.working_priority_code,
        "assigneeLabel": request.assignee_label,
        "assigneeUserId": request.assignee_user_id,
        "isOwn": _is_own(request, actor),
        "description": request.description if visible else None,
        # Превью — производное описания: оставить его у вырезанного описания
        # значило бы вернуть первые сто двадцать символов закрытого текста
        # соседним полем ответа.
        "descriptionPreview": (
            _preview_of(request.description) if visible else None
        ),
        "expectedResult": request.expected_result if visible else None,
        "reproductionSteps": request.reproduction_steps if visible else None,
        "contact": request.contact if visible else None,
        "relatedRoute": request.related_route if visible else None,
        "attachments": list(request.attachments) if visible else None,
        "technicalInfo": request.technical_info if visible else None,
        "restrictedReason": None if visible else RESTRICTED_REASON,
    }


def _serialize_full(request):
    """Полная запись — ответ create/submit (CreateFeedbackResponse). Уходит
    только автору операции: это его собственное обращение."""
    return {
        "feedbackId": str(request.pk),
        "subject": request.subject,
        "description": request.description,
        "typeCode": request.type_code,
        "priorityCode": request.priority_code,
        "statusCode": request.status_code,
        "moduleCode": request.module_code,
        "expectedResult": request.expected_result,
        "reproductionSteps": request.reproduction_steps,
        "attachments": list(request.attachments),
        "contact": request.contact,
        "confidential": request.confidential,
        "relatedRoute": request.related_route,
        "technicalInfo": request.technical_info,
        "workingPriorityCode": request.working_priority_code,
        "assignee": (
            None
            if request.assignee_user_id is None
            else {
                "userId": request.assignee_user_id,
                "safeLabel": request.assignee_label,
            }
        ),
        "duplicateOfId": (
            str(request.duplicate_of_id)
            if request.duplicate_of_id is not None
            else None
        ),
        "author": {
            "userId": request.author_user_id,
            "safeLabel": request.author_label,
        },
        "createdAt": _iso(request.created_at),
        "submittedAt": _iso(request.submitted_at),
        "updatedAt": _iso(request.updated_at),
    }


def _actor_label(actor):
    """Безопасная подпись актора — та же, что у реестра ОМ.

    Правило одно на оба раздела: разойдясь, они называли бы одного человека
    по-разному в обращении и в мероприятии.
    """
    from organization_management.apps.ops.security_events import (
        actor_display_name,
    )

    return actor_display_name(actor)


def _label_for_user_id(user_id):
    """Подпись для назначаемого ответственного: сначала уже известная в
    обращениях (сеяные demo-персоны живой учётки не имеют), затем живая
    учётка, затем сам идентификатор."""
    known = (
        OpsFeedbackRequest.objects.filter(assignee_user_id=user_id)
        .exclude(assignee_label=None)
        .values_list("assignee_label", flat=True)
        .first()
    )
    if known:
        return known
    known_comment = (
        OpsFeedbackComment.objects.filter(author_user_id=user_id)
        .values_list("author_label", flat=True)
        .first()
    )
    if known_comment:
        return known_comment
    return _actor_label(user_id)


# ── Реестр (§28 list) ───────────────────────────────────────────────────────


def _matches_search(request, query, content_visible):
    needle = query.strip().lower()
    if needle == "":
        return True
    if needle in request.subject.lower():
        return True
    if not content_visible:
        return False
    return needle in request.description.lower()


def list_feedback(actor, perms, filters):
    registry = _registry()
    rows = list(OpsFeedbackRequest.objects.all())
    visible = [r for r in rows if _is_visible(r, actor, perms)]
    mine = (
        [r for r in visible if _is_own(r, actor)]
        if filters.get("mine")
        else visible
    )

    def matches(row):
        if filters.get("type") and row.type_code != filters["type"]:
            return False
        if filters.get("status") and row.status_code != filters["status"]:
            return False
        if filters.get("module") and row.module_code != filters["module"]:
            return False
        return _matches_search(
            row,
            filters.get("search") or "",
            _content_visible(row, actor, perms),
        )

    matched = [r for r in mine if matches(r)]

    requested_page = filters.get("page") or 1
    page_count = max(
        1, -(-len(matched) // FEEDBACK_PAGE_SIZE)  # ceil без float
    )
    # Страница за пределами набора — не ошибка запроса: между открытием и
    # переходом реестр изменился; отдаём последнюю.
    page = min(max(1, requested_page), page_count)
    start = (page - 1) * FEEDBACK_PAGE_SIZE

    status_order = [entry["code"] for entry in registry.statuses]
    counts = {}
    for row in visible:
        counts[row.status_code] = counts.get(row.status_code, 0) + 1

    return {
        "results": [
            _project(r, actor, perms)
            for r in matched[start : start + FEEDBACK_PAGE_SIZE]
        ],
        # Сводка — по всему ВИДИМОМУ набору, до фильтров и до страниц:
        # итог по видимой части таблицы §22.3 запрещает.
        "stats": {
            "byStatus": [
                {"statusCode": code, "count": counts.get(code, 0)}
                for code in status_order
            ],
            "total": len(visible),
        },
        "registry": _serialize_registry(registry),
        "page": page,
        "pageSize": FEEDBACK_PAGE_SIZE,
        "pageCount": page_count,
        "totalMatched": len(matched),
        "totalVisible": len(visible),
        "unavailableCapabilities": [
            dict(item) for item in UNAVAILABLE_CAPABILITIES
        ],
        "serverTime": Clock.now().isoformat(),
    }


# ── Создание и отправка ─────────────────────────────────────────────────────


def _validate_create(body, registry):
    subject = (body.get("subject") or "").strip()
    description = body.get("description") or ""
    if subject == "":
        raise DomainError(
            "VALIDATION_ERROR", 422, message="Тема обращения обязательна."
        )
    if len(body.get("subject") or "") > MAX_SUBJECT:
        raise DomainError(
            "VALIDATION_ERROR",
            422,
            message=f"Тема длиннее {MAX_SUBJECT} символов.",
        )
    if description.strip() == "":
        raise DomainError(
            "VALIDATION_ERROR", 422, message="Описание обращения обязательно."
        )
    if len(description) > MAX_DESCRIPTION:
        raise DomainError(
            "VALIDATION_ERROR",
            422,
            message=f"Описание длиннее {MAX_DESCRIPTION} символов.",
        )
    # Коды сверяются со СПРАВОЧНИКОМ, а не с типом клиента: сюда приходит
    # тело запроса, а не наш код.
    if not any(e["code"] == body.get("typeCode") for e in registry.types):
        raise DomainError(
            "VALIDATION_ERROR", 422, message="Неизвестный тип обращения."
        )
    if not any(
        e["code"] == body.get("priorityCode") for e in registry.priorities
    ):
        raise DomainError(
            "VALIDATION_ERROR", 422, message="Неизвестный приоритет."
        )
    if not any(
        e["moduleCode"] == body.get("moduleCode") for e in registry.modules
    ):
        raise DomainError(
            "VALIDATION_ERROR", 422, message="Неизвестный модуль."
        )


def create_feedback(actor, body):
    registry = _registry()
    body = body or {}
    _validate_create(body, registry)
    draft = bool(body.get("saveAsDraft"))
    now = Clock.now()
    with transaction.atomic():
        request = OpsFeedbackRequest.objects.create(
            subject=(body.get("subject") or "").strip(),
            description=(body.get("description") or "").strip(),
            type_code=body["typeCode"],
            priority_code=body["priorityCode"],
            status_code="DRAFT" if draft else "NEW",
            module_code=body["moduleCode"],
            expected_result=body.get("expectedResult"),
            reproduction_steps=body.get("reproductionSteps"),
            # §28 «attachment metadata»: запись собирается ПОИМЁННО — любому
            # лишнему полю тела (в том числе содержимому файла) места
            # неоткуда взяться.
            attachments=[
                {
                    "fileName": item.get("fileName"),
                    "sizeBytes": item.get("sizeBytes"),
                    "mimeType": item.get("mimeType"),
                }
                for item in (body.get("attachments") or [])
            ],
            contact=body.get("contact"),
            confidential=bool(body.get("confidential")),
            related_route=body.get("relatedRoute"),
            # Согласие решает СЕРВЕР: присланная без согласия техническая
            # информация не сохраняется — иначе галочка ни на что не влияла бы.
            technical_info=(
                body.get("technicalInfo")
                if body.get("includeTechnicalInfo")
                else None
            ),
            # Разбор не начинался: не копия заявленного, а отсутствие решения.
            working_priority_code=None,
            assignee_user_id=None,
            assignee_label=None,
            duplicate_of=None,
            author_user_id=actor or "",
            author_label=_actor_label(actor),
            submitted_at=None if draft else now,
        )
        events = [("CREATED", None, None, None)]
        if not draft:
            events.append(("SUBMITTED", None, None, None))
        for kind, field, old, new in events:
            OpsFeedbackEvent.objects.create(
                request=request,
                kind=kind,
                actor_user_id=request.author_user_id,
                actor_label=request.author_label,
                at=now,
                field_code=field,
                old_value=old,
                new_value=new,
            )
    return _serialize_full(request)


def _locate_for_update(pk, actor, perms):
    """Строка под замком записи. Невидимое обращение — 404, а не 403: отказ
    по праву подтвердил бы, что обращение с таким идентификатором есть."""
    request = (
        OpsFeedbackRequest.objects.select_for_update().filter(pk=pk).first()
        if str(pk).isdigit()
        else None
    )
    if request is None or not _is_visible(request, actor, perms):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"id": str(pk)},
            message="Обращение не найдено.",
        )
    return request


def submit_feedback(actor, perms, pk):
    """§28 «Черновик» → «Новое». Только СВОЙ черновик: чужой не виден вовсе,
    а свой отправленный второй отправки не имеет."""
    with transaction.atomic():
        request = _locate_for_update(pk, actor, perms)
        if not _is_own(request, actor):
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"id": str(pk)},
                message="Обращение не найдено.",
            )
        if request.status_code != "DRAFT":
            raise DomainError(
                "FEEDBACK_ALREADY_SUBMITTED",
                422,
                message="Обращение уже отправлено.",
            )
        now = Clock.now()
        request.status_code = "NEW"
        request.submitted_at = now
        request.save()
        OpsFeedbackEvent.objects.create(
            request=request,
            kind="SUBMITTED",
            actor_user_id=actor or "",
            actor_label=_actor_label(actor),
            at=now,
            field_code=None,
            old_value=None,
            new_value=None,
        )
    return _serialize_full(request)


# ── Карточка (§28 detail) ───────────────────────────────────────────────────


def _build_actions(request, actor, perms, registry):
    """Действия карточки считает СЕРВЕР. Замок закрытого обращения — ПЕРВЫМ
    и одинаково для всех действий: иначе причина отказа зависела бы от прав
    смотрящего, и один и тот же закрытый разговор объяснялся бы по-разному."""
    closed = _is_terminal(registry, request.status_code)
    draft = request.status_code == "DRAFT"
    triage = _has(perms, TRIAGE_PERMISSION)
    own = _is_own(request, actor)
    internal = _has(perms, INTERNAL_NOTE_PERMISSION)

    def action(code, allowed, reason):
        if closed:
            return {
                "code": code,
                "available": False,
                "reason": CLOSED_LOCK_REASON,
            }
        if draft:
            return {
                "code": code,
                "available": False,
                "reason": DRAFT_ACTION_REASON,
            }
        if allowed:
            return {"code": code, "available": True, "reason": None}
        return {"code": code, "available": False, "reason": reason}

    return [
        # Публичный ответ пишет разбирающий ИЛИ автор: обращение — разговор,
        # а не форма, отправленная в один конец.
        action("ADD_PUBLIC_REPLY", triage or own, REPLY_REASON),
        action("ADD_INTERNAL_NOTE", internal, INTERNAL_NOTE_REASON),
        action("TRIAGE", triage, TRIAGE_REASON),
        action("CLOSE", triage, TRIAGE_REASON),
    ]


def _duplicate_link(request, actor, perms):
    if request.duplicate_of_id is None:
        return None
    target = OpsFeedbackRequest.objects.filter(
        pk=request.duplicate_of_id
    ).first()
    # Тема оригинала — только если он и сам видим смотрящему: иначе ссылка
    # на дубликат стала бы обходным путём к чужому обращению.
    if target is None or not _is_visible(target, actor, perms):
        return {
            "feedbackId": str(request.duplicate_of_id),
            "subject": None,
            "hiddenReason": "Обращение-оригинал недоступно смотрящему.",
        }
    return {
        "feedbackId": str(target.pk),
        "subject": target.subject,
        "hiddenReason": None,
    }


def get_feedback(actor, perms, pk):
    registry = _registry()
    request = (
        OpsFeedbackRequest.objects.filter(pk=pk).first()
        if str(pk).isdigit()
        else None
    )
    if request is None or not _is_visible(request, actor, perms):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"id": str(pk)},
            message="Обращение не найдено.",
        )

    internal = _has(perms, INTERNAL_NOTE_PERMISSION)
    comments = [
        {
            "commentId": str(c.pk),
            "kind": c.kind,
            "body": c.body,
            "authorLabel": c.author_label,
            "createdAt": _iso(c.created_at),
        }
        for c in request.comments.all()
        # Внутренние заметки в ответ тому, кому они не видны, не попадают
        # ВООБЩЕ — не приходят «с вырезанным текстом».
        if c.kind == "PUBLIC_REPLY" or internal
    ]
    timeline = [
        {
            "eventId": str(e.pk),
            "kind": e.kind,
            "actorLabel": e.actor_label,
            "at": _iso(e.at),
            "fieldCode": e.field_code,
            "oldValue": e.old_value,
            "newValue": e.new_value,
        }
        for e in request.events.all()
        # Событие внутренней заметки скрывается ЦЕЛИКОМ: строка без текста
        # всё равно сообщила бы автору, что о нём что-то написали и когда.
        if e.kind != "INTERNAL_NOTE_ADDED" or internal
    ]

    # Кандидаты в ответственные — те, кто УЖЕ участвовал в обращениях:
    # справочника сотрудников поддержки нет, и выдумывать его значило бы
    # обещать роли, которых никто не назначал.
    candidates = {}
    for row in OpsFeedbackRequest.objects.exclude(assignee_user_id=None):
        candidates[row.assignee_user_id] = row.assignee_label
    for comment in OpsFeedbackComment.objects.all():
        candidates.setdefault(comment.author_user_id, comment.author_label)

    return {
        "request": _project(request, actor, perms),
        "comments": comments,
        "timeline": timeline,
        "actions": _build_actions(request, actor, perms, registry),
        "allowedStatuses": _allowed_transitions(
            registry, request.status_code
        ),
        "assigneeCandidates": [
            {"userId": user_id, "safeLabel": label}
            for user_id, label in candidates.items()
        ],
        "duplicateOf": _duplicate_link(request, actor, perms),
        "registry": _serialize_registry(registry),
        "unavailableBlocks": [dict(item) for item in UNAVAILABLE_CARD_BLOCKS],
        "serverTime": Clock.now().isoformat(),
    }


# ── Мутации карточки ────────────────────────────────────────────────────────


def _require_open(request, registry):
    if _is_terminal(registry, request.status_code):
        raise DomainError("FEEDBACK_CLOSED", 422, message=CLOSED_LOCK_REASON)
    if request.status_code == "DRAFT":
        raise DomainError("FEEDBACK_CLOSED", 422, message=DRAFT_LOCK_REASON)


def _commit_change(request, before, actor, extra_events, now, registry):
    """Единственная точка записи ленты: сравнивает «до» и «после» и сама
    дописывает события. Явные события операции — первыми, диффы — следом."""
    actor_id = actor or ""
    label = _actor_label(actor)

    def emit(kind, field=None, old=None, new=None):
        OpsFeedbackEvent.objects.create(
            request=request,
            kind=kind,
            actor_user_id=actor_id,
            actor_label=label,
            at=now,
            field_code=field,
            old_value=old,
            new_value=new,
        )

    for kind in extra_events:
        emit(kind)
    if before["status_code"] != request.status_code:
        emit(
            # Закрытие — отдельный вид события, а не «ещё одна смена
            # статуса»: §28 называет close отдельным действием карточки.
            "CLOSED"
            if _is_terminal(registry, request.status_code)
            else "STATUS_CHANGED",
            field="statusCode",
            old=before["status_code"],
            new=request.status_code,
        )
    if before["working_priority_code"] != request.working_priority_code:
        emit(
            "WORKING_PRIORITY_SET",
            field="workingPriorityCode",
            old=before["working_priority_code"],
            new=request.working_priority_code,
        )
    if before["assignee_user_id"] != request.assignee_user_id:
        emit(
            "ASSIGNED",
            field="assignee",
            old=before["assignee_user_id"],
            new=request.assignee_user_id,
        )
    if before["duplicate_of_id"] != request.duplicate_of_id:
        emit(
            "MARKED_DUPLICATE",
            field="duplicateOfId",
            old=(
                str(before["duplicate_of_id"])
                if before["duplicate_of_id"] is not None
                else None
            ),
            new=(
                str(request.duplicate_of_id)
                if request.duplicate_of_id is not None
                else None
            ),
        )


def _snapshot(request):
    return {
        "status_code": request.status_code,
        "working_priority_code": request.working_priority_code,
        "assignee_user_id": request.assignee_user_id,
        "duplicate_of_id": request.duplicate_of_id,
    }


def add_comment(actor, perms, pk, body):
    body = body or {}
    registry = _registry()
    with transaction.atomic():
        request = _locate_for_update(pk, actor, perms)
        _require_open(request, registry)
        text = (body.get("body") or "").strip()
        if text == "":
            raise DomainError(
                "VALIDATION_ERROR", 422, message="Комментарий пуст."
            )
        kind = body.get("kind")
        if kind == "INTERNAL_NOTE" and not _has(
            perms, INTERNAL_NOTE_PERMISSION
        ):
            raise DomainError(
                "PERMISSION_DENIED", 403, message=INTERNAL_NOTE_REASON
            )
        if (
            kind == "PUBLIC_REPLY"
            and not _has(perms, TRIAGE_PERMISSION)
            and not _is_own(request, actor)
        ):
            raise DomainError("PERMISSION_DENIED", 403, message=REPLY_REASON)
        if kind not in ("PUBLIC_REPLY", "INTERNAL_NOTE"):
            raise DomainError(
                "VALIDATION_ERROR", 422, message="Неизвестный вид комментария."
            )
        now = Clock.now()
        OpsFeedbackComment.objects.create(
            request=request,
            kind=kind,
            body=text,
            author_user_id=actor or "",
            author_label=_actor_label(actor),
        )
        before = _snapshot(request)
        request.save()  # updated_at
        _commit_change(
            request,
            before,
            actor,
            [
                "PUBLIC_REPLY_ADDED"
                if kind == "PUBLIC_REPLY"
                else "INTERNAL_NOTE_ADDED"
            ],
            now,
            registry,
        )
    return {"feedbackId": str(request.pk)}


def triage_feedback(actor, perms, pk, body):
    """Разбор — ОДНА операция: ответственный, рабочий приоритет и статус
    меняются вместе, потому что вместе и решаются. Отсутствие ключа в теле —
    «не трогать», null — «снять»: снятие ответственного — такое же событие
    ленты, как назначение."""
    body = body or {}
    registry = _registry()
    with transaction.atomic():
        request = _locate_for_update(pk, actor, perms)
        _require_open(request, registry)
        before = _snapshot(request)

        if "statusCode" in body:
            status_code = body["statusCode"]
            # Переход сверяется с КАРТОЙ справочника, а не с «любым непустым
            # статусом»: порядок разбора принадлежит службе, а не запросу.
            if status_code not in _allowed_transitions(
                registry, request.status_code
            ):
                raise DomainError(
                    "FEEDBACK_TRANSITION_NOT_ALLOWED",
                    422,
                    message="Такой переход статуса не разрешён справочником.",
                )
            # Закрытие — отдельная операция со своим публичным ответом:
            # разрешить его здесь значило бы закрыть обращение молча.
            if _is_terminal(registry, status_code):
                raise DomainError(
                    "FEEDBACK_USE_CLOSE",
                    422,
                    message=(
                        "Закрытие обращения оформляется отдельным действием "
                        "с ответом автору."
                    ),
                )
            request.status_code = status_code
        if "assigneeUserId" in body:
            assignee = body["assigneeUserId"]
            if assignee is None:
                request.assignee_user_id = None
                request.assignee_label = None
            else:
                request.assignee_user_id = assignee
                request.assignee_label = _label_for_user_id(assignee)
        if "workingPriorityCode" in body:
            working = body["workingPriorityCode"]
            if working is not None and not any(
                e["code"] == working for e in registry.priorities
            ):
                raise DomainError(
                    "VALIDATION_ERROR", 422, message="Неизвестный приоритет."
                )
            request.working_priority_code = working

        now = Clock.now()
        request.save()
        _commit_change(request, before, actor, [], now, registry)
    return {"feedbackId": str(request.pk)}


def close_feedback(actor, perms, pk, body):
    """Закрытие: только терминальный статус карты переходов, с обязательным
    публичным ответом автору — человек узнаёт причину, а не только статус."""
    body = body or {}
    registry = _registry()
    with transaction.atomic():
        request = _locate_for_update(pk, actor, perms)
        _require_open(request, registry)
        status_code = body.get("statusCode")
        if not _is_terminal(registry, status_code):
            raise DomainError(
                "VALIDATION_ERROR",
                422,
                message="Закрыть обращение можно только терминальным статусом.",
            )
        if status_code not in _allowed_transitions(
            registry, request.status_code
        ):
            raise DomainError(
                "FEEDBACK_TRANSITION_NOT_ALLOWED",
                422,
                message="Такой переход статуса не разрешён справочником.",
            )
        reply = (body.get("publicReply") or "").strip()
        if reply == "":
            raise DomainError(
                "VALIDATION_ERROR",
                422,
                message="Закрытие сопровождается ответом автору.",
            )
        before = _snapshot(request)
        if status_code == "DUPLICATE":
            target_id = body.get("duplicateOfId")
            if target_id is None:
                raise DomainError(
                    "VALIDATION_ERROR",
                    422,
                    message=(
                        "Признание дубликатом требует указать "
                        "обращение-оригинал."
                    ),
                )
            if str(target_id) == str(request.pk):
                raise DomainError(
                    "VALIDATION_ERROR",
                    422,
                    message="Обращение не может быть дубликатом самого себя.",
                )
            # Оригинал обязан быть ВИДИМ закрывающему: сослаться на то, чего
            # он не видит, значит утверждать о содержимом вслепую.
            target = (
                OpsFeedbackRequest.objects.filter(pk=target_id).first()
                if str(target_id).isdigit()
                else None
            )
            if target is None or not _is_visible(target, actor, perms):
                raise DomainError(
                    "ENTITY_NOT_FOUND",
                    404,
                    detail={"id": str(target_id)},
                    message="Обращение не найдено.",
                )
            request.duplicate_of = target

        now = Clock.now()
        request.status_code = status_code
        request.save()
        OpsFeedbackComment.objects.create(
            request=request,
            kind="PUBLIC_REPLY",
            body=reply,
            author_user_id=actor or "",
            author_label=_actor_label(actor),
        )
        _commit_change(
            request, before, actor, ["PUBLIC_REPLY_ADDED"], now, registry
        )
    return {"feedbackId": str(request.pk)}
