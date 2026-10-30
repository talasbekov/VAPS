"""Read-only, actor-scoped documentation dialogue. No model-selected actions."""
import hashlib
import json
import re

from django.contrib.auth import get_user_model
from rest_framework.exceptions import PermissionDenied

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.models import Role, TemporaryDutyPermission
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.services import PermissionService
from . import execution, provider
from .documentation import permitted_excerpts


def authority(request):
    actor = resolve_actor_id(request)
    if not actor or not get_user_model().objects.filter(pk=request.user.pk, is_active=True).exists():
        raise PermissionDenied("PERMISSION_DENIED")
    # Fresh service queries, not request._ops_effective_permissions cached before
    # a potentially slow provider call. Rechecked again before returning content.
    permissions = PermissionService.effective_permissions(actor)
    globals_ = PermissionService.unscoped_permissions(actor)
    # Use the same permanent + temporary + derived grants as domain authorization.
    # Permission codes alone lose the scope of a temporary appointment.
    grants = sorted(PermissionService._active_grants(actor), key=lambda row: (row[1], row[0] if row[0] is not None else -1))
    names = dict(Role.objects.filter(code__in=[row[1] for row in grants], is_active=True).values_list("code", "name"))
    roles = [(code, names.get(code, code), scope) for scope, code in grants]
    scopes = list(Division.objects.filter(pk__in=[row[0] for row in grants if row[0] is not None])
                  .order_by("pk").values_list("name", flat=True))
    now = Clock.now()
    temporary = list(TemporaryDutyPermission.objects.filter(user_id=actor, is_active=True, starts_at__lte=now, ends_at__gte=now,
        duty_role_code__in=names).order_by("pk").values_list("pk", "duty_role_code", "scope_division_id", "event_id", "starts_at", "ends_at"))
    context = {"roles": list(dict.fromkeys(row[1] for row in roles)), "scopes": scopes}
    stamp = hashlib.sha256(json.dumps([actor, sorted(permissions), sorted(globals_), roles, scopes, temporary], ensure_ascii=False, default=str).encode()).hexdigest()
    return stamp, context, permitted_excerpts(permissions, globals_)


def fallback_selection(message, documents):
    words = [word[:5] for word in re.findall(r"[\w]+", message.lower().replace("ё", "е")) if len(word) > 3]
    scored = [(sum(word in (row.title + " " + row.text).lower().replace("ё", "е") for word in words), index, row.id)
              for index, row in enumerate(documents)]
    picked = [key for score, _, key in sorted(scored, key=lambda row: (-row[0], row[1])) if score > 0][:3]
    return picked or [row.id for row in documents if row.id in {"personal", "authority"}]


def answer_request(request, data):
    if isinstance(data, dict) and "conversationToken" in data:
        from .dialogue import answer
        return answer(request, data)
    if not isinstance(data, dict) or set(data) - {"mode", "message", "history"}:
        execution.invalid("Для вопроса допустимы только сообщение и история вопросов.")
    message, history = data.get("message"), data.get("history", [])
    if not isinstance(message, str) or not message.strip() or len(message) > 4000:
        execution.invalid("Введите вопрос длиной до4000 знаков.", "message")
    if not isinstance(history, list) or len(history) > 3 or any(not isinstance(item, str) or len(item) > 1000 for item in history):
        execution.invalid("История содержит не более трёх вопросов до1000 знаков.", "history")
    before, role_context, documents = authority(request)
    model_documents = [{"id": row.id, "title": row.title, "text": row.text} for row in documents]
    mode, notice = "llm", None
    try:
        selected = provider.select_documentation(message.strip(), history, model_documents, role_context)
        allowed = {row.id for row in documents}
        if (not isinstance(selected, list) or len(selected) > 3
                or any(not isinstance(key, str) or key not in allowed for key in selected)):
            raise ValueError("untrusted selection")
    except (provider.ProviderUnavailable, ValueError, TypeError):
        selected = fallback_selection(message, documents)
        mode = "documentation"
        notice = "Ответ подготовлен по документации без подтверждённого ответа модели. Доступность LLM проверьте в рабочей сети."
    after, _, _ = authority(request)
    if before != after:
        execution.conflict()
    selected = list(dict.fromkeys(selected))
    rows = [next(row for row in documents if row.id == key) for key in selected]
    answer = ("По документации для вашей роли:\n\n" + "\n\n".join(row.title + "\n" + row.text for row in rows)) if rows else (
        "В доступной документации не найдено подтверждённого ответа. Уточните раздел и задачу. Текущие данные и дополнительные полномочия я не выдумываю.")
    return {"answer": answer, "mode": mode, "notice": notice, "roleContext": role_context,
            "sources": [{"id": row.id, "title": row.title, "document": row.document,
                         "section": row.section, "href": row.href} for row in rows]}
