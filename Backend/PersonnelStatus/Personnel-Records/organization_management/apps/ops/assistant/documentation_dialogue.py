"""Expanded read-only dialogue. No task execution, arbitrary reads or role claims."""
import re
from . import conversation, provider, execution
from .answers import authority
from .knowledge import permitted_chunks
from .retrieval import retrieve
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.services import PermissionService


def validate_generated(result, selected):
    if not isinstance(result, dict) or set(result) != {"answer", "sourceIds", "needsClarification"}:
        raise ValueError("Invalid answer shape")
    text, ids, clarify = result["answer"], result["sourceIds"], result["needsClarification"]
    if (not isinstance(text, str) or not text.strip() or len(text) > 8000
            or not isinstance(clarify, bool) or not isinstance(ids, list) or len(ids) > 6
            or any(not isinstance(key, str) or key not in {row.id for row in selected} for key in ids)
            or (not ids and not clarify)):
        raise ValueError("Unverified answer")
    # Sources/links are constructed below by the server, never by model prose.
    if re.search(r"https?://|www\.|\]\s*\(|<[^>]+>|(?:я|мною)\s+(?:(?:успешно|уже)\s+)?(?:создал|сохранил|назначил|изменил|отправил|удалил)|\bI\s+(?:have\s+)?(?:created|saved|deleted|assigned)\b", text, re.I):
        raise ValueError("Untrusted links or write assertion")
    if re.search(r"\b(?:создан[аоы]?|сохран[её]н[аоы]?|назначен[аоы]?|измен[её]н[аоы]?|отправлен[аоы]?|удал[её]н[аоы]?|выполнен[аоы]?|подтвержд[её]н[аоы]?|created|saved|deleted|assigned|sent)\b", text, re.I):
        raise ValueError("No operation was performed by this documentation dialogue")
    return text.strip(), list(dict.fromkeys(ids)), clarify


def answer(request, data):
    if set(data) - {"mode", "message", "conversationToken", "readRequest"}:
        execution.invalid("Для диалога допустимы только сообщение и контекст разговора.")
    question = data.get("message")
    if not isinstance(question, str) or not question.strip() or len(question) > 4000:
        execution.invalid("Введите вопрос длиной до4000 знаков.", "message")
    question = question.strip()
    stamp, context, _ = authority(request)
    actor = str(resolve_actor_id(request))
    documents = permitted_chunks(PermissionService.effective_permissions(actor), PermissionService.unscoped_permissions(actor))
    turns, reset = conversation.load(data["conversationToken"], actor, stamp)
    from .read_spec import validate_spec
    from .read_router import resolve_spec
    spec = validate_spec(data['readRequest']) if 'readRequest' in data else resolve_spec(question, conversation.read_context(data['conversationToken'], actor, stamp))
    if spec:
        from .data_scope import DataAuthority
        from .live_data import execute
        from .reads import describe_live
        read_authority = DataAuthority(request)
        result = execute(read_authority, spec)
        if authority(request)[0] != stamp or DataAuthority(request).stamp != read_authority.stamp:
            execution.conflict()
        return {'answer': describe_live(result), 'mode': 'data',
            'notice': 'Текущие данные отобраны сервером по вашим правам и подразделению. LLM не получала записи.',
            'roleContext': context, 'needsClarification': False, 'conversationReset': reset,
            'conversationToken': conversation.retain(turns, actor, stamp, spec), 'readOnly': result,
            'sources': [{'id': 'live_' + spec['operation'], 'title': 'Текущие данные: ' + spec['operation'],
                'document':'Работающая система', 'section':'Серверное чтение в разрешённой области', 'href':result['href']}]}
    from .reads import resolve_read, execute_read, describe
    operation = resolve_read(question)
    if operation:
        from .data_scope import DataAuthority
        read_authority=DataAuthority(request)
        result = execute_read(request, *operation)
        if authority(request)[0] != stamp or DataAuthority(request).stamp != read_authority.stamp:
            execution.conflict()
        own = operation[0] == "own_profile"
        return {"answer": describe(result), "mode": "data", "notice": "Данные прочитаны сервером в вашей области доступа; модель не использовалась.",
                "roleContext": context, "needsClarification": False, "conversationReset": reset,
                "conversationToken": conversation.retain(turns, actor, stamp, {'operation': operation[0], 'page':operation[1]}), "readOnly": result,
                "sources": [{"id": "current_directory", "title": "Свой профиль" if own else "Доступный каталог сотрудников",
                    "document": "Текущие данные системы", "section": "Серверное чтение",
                    "href": "/security-ops/profile" if own else "/service-employees"}]}
    selected = retrieve(question, turns, documents)
    # A grant changed while constructing the context: do not send old content.
    if authority(request)[0] != stamp:
        execution.conflict()
    mode, notice, clarify = "documentation", None, False
    ids = [row.id for row in selected]
    text = ("По доступной документации:\n\n" + "\n\n".join(row.title + "\n" + row.text for row in selected)) if selected else (
        "Я помогу разобраться в Smart Josparlau в пределах ваших полномочий. Уточните раздел и задачу: подтверждённого ответа на этот вопрос в доступных инструкциях не найдено. Текущие данные проверяются в рабочих разделах.")
    if selected:
        try:
            result = provider.answer_from_context(question, turns,
                [{"id": row.id, "title": row.title, "text": row.text} for row in selected], context)
            text, ids, clarify = validate_generated(result, selected)
            mode = "llm"
        except (provider.ProviderUnavailable, ValueError, TypeError):
            notice = "Показана справка по документации: подтверждённый ответ LLM не получен."
    else:
        clarify = True
        notice = "Уточнение по доступным инструкциям; модель не использовалась."
    if authority(request)[0] != stamp:
        execution.conflict()
    sources = [row for row in selected if row.id in ids]
    return {"answer": text, "mode": mode, "notice": notice, "roleContext": context,
            "needsClarification": clarify, "conversationReset": reset,
            "conversationToken": conversation.issue(turns, question, text, actor, stamp),
            "sources": [{"id": row.id, "title": row.title, "document": row.source,
                         "section": row.section, "href": row.href} for row in sources]}
