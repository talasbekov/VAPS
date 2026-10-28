"""Durable, bounded interpretation jobs. This module never executes domain actions."""
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied

from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_assistant import OpsAssistantTask, OpsAssistantMessage
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.services import PermissionService
from . import access, execution, planning, provider, guided_questions

MAX_MESSAGES = 256
MAX_CHARACTERS = 128000
LEASE_SECONDS = 180


def processing_state(task):
    data = task.processing or {}
    state = data.get("state", "ready")
    since = parse_datetime(data.get("startedAt") or data.get("queuedAt") or "")
    stale = bool(state in {"queued", "running"} and since and since < timezone.now() - timedelta(seconds=LEASE_SECONDS))
    return {"state": state, "attempt": data.get("attempt", 0), "error": data.get("error"),
            "retryable": state == "failed" or stale, "queuedAt": data.get("queuedAt"), "startedAt": data.get("startedAt")}


def within_limit(task, text=""):
    texts = list(task.messages.filter(role="user").values_list("text", flat=True))
    if not texts and task.message:
        texts = [task.message]
    return len(texts) < MAX_MESSAGES and sum(map(len, texts)) + len(text) <= MAX_CHARACTERS


def _key(data):
    key = data.get("requestKey")
    if not isinstance(key, str) or not key.strip() or len(key) > 80:
        execution.invalid("Укажите ключ запроса.", "requestKey")
    return key


def _owner(request, task):
    if task.initiated_by != resolve_actor_id(request):
        raise PermissionDenied("PERMISSION_DENIED")


def _revision(task, data):
    if type(data.get("revision")) is not int or data["revision"] != task.revision:
        execution.conflict()


def ensure_initial_message(task):
    if not task.messages.exists():
        OpsAssistantMessage.objects.create(task=task, role="user", text=task.message,
                                          request_key=task.request_key, payload_hash=task.request_hash,
                                          created_by=task.initiated_by)


def queue_task(task, *, patch=None, reference_at=None, guidance_binding=None):
    task.processing = {"state": "queued", "generation": str(uuid.uuid4()),
                       "attempt": task.processing.get("attempt", 0) + 1,
                       "queuedAt": timezone.now().isoformat(), "error": None,
                       "referenceAt": reference_at or clock.Clock.now().isoformat(),
                       "patch": patch or {}, "guidanceBinding": guidance_binding}
    task.revision += 1
    task.save(update_fields=["processing", "revision", "updated_at"])
    pk, generation = str(task.pk), task.processing["generation"]
    transaction.on_commit(lambda: dispatch(pk, generation))


def dispatch(pk, generation):
    try:
        from organization_management.apps.operations.tasks import interpret_assistant_task
        # Per-publish limits do not change the worker's reconnect policy.
        with interpret_assistant_task.app.connection_for_write(
            connect_timeout=3,
            transport_options={"socket_connect_timeout": 3, "socket_timeout": 3, "retry_on_timeout": False, "max_retries": 0},
        ) as connection:
            interpret_assistant_task.apply_async(args=[pk, generation], retry=False, connection=connection)
    except Exception:
        # Queue errors may contain credentials. Only a fixed public message is persisted.
        fail_task(pk, generation, "Не удалось поставить обработку в очередь. Сообщение сохранено; повторите обработку.")


@transaction.atomic
def add_message(request, pk, data):
    if not isinstance(data, dict) or set(data) != {"requestKey", "message", "revision"}:
        execution.invalid("Укажите сообщение, ключ запроса и версию поручения.")
    key = _key(data)
    text = data.get("message")
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        execution.invalid("Опишите уточнение текстом длиной до4000 знаков.", "message")
    task = access.lock_task(request, pk)
    _owner(request, task)
    previous = task.messages.filter(request_key=key).first()
    if previous:
        if previous.payload_hash != execution.digest(data):
            execution.conflict()
        return task, False
    _revision(task, data)
    if processing_state(task)["state"] in {"queued", "running"}:
        execution.conflict()
    if not within_limit(task, text):
        execution.invalid(f"Достигнут предел истории поручения ({MAX_MESSAGES} сообщений или {MAX_CHARACTERS} знаков). Сохранённый план доступен для проверки и ручного уточнения.", "message")
    # This selection happens under the same task lock and revision check as the
    # accepted message. Neither the browser nor the model can choose the target.
    current = guided_questions.select(task.plan, execution._task_questions(task))[0] if processing_state(task)['state'] == 'ready' else None
    binding = {'revision': task.revision, 'question': current} if current else None
    ensure_initial_message(task)
    OpsAssistantMessage.objects.create(task=task, role="user", text=text, request_key=key,
                                       payload_hash=execution.digest(data), created_by=task.initiated_by)
    queue_task(task, guidance_binding=binding)
    return task, True


@transaction.atomic
def retry_task(request, pk, data):
    if not isinstance(data, dict) or set(data) != {"requestKey", "revision"}:
        execution.invalid("Укажите ключ повтора и версию поручения.")
    key = _key(data)
    task = access.lock_task(request, pk)
    _owner(request, task)
    for row in task.messages.filter(role="user"):
        if key in row.retries:
            if row.retries[key] != execution.digest(data):
                execution.conflict()
            return task, False
    _revision(task, data)
    if not processing_state(task)["retryable"]:
        execution.conflict()
    message = task.messages.filter(role="user").last()
    if message is None or len(message.retries) >= 20 or task.messages.filter(request_key=key).exists():
        execution.invalid("Повтор недоступен; уточните сведения вручную.")
    message.retries = {**message.retries, key: execution.digest(data)}
    message.save(update_fields=["retries", "updated_at"])
    queue_task(task, patch=task.processing.get("patch"), reference_at=task.processing.get("referenceAt") or message.created_at.isoformat(),
               guidance_binding=task.processing.get('guidanceBinding'))
    return task, True


def _permissions(task):
    if not task.initiated_by.isdigit() or not get_user_model().objects.filter(pk=task.initiated_by, is_active=True).exists():
        raise provider.ProviderUnavailable("Доступ автора поручения отозван. Обработка остановлена.")
    perms = PermissionService.effective_permissions(task.initiated_by)
    if not perms & {"*", "event.create", "event.manage", "event.bulletin", "forces.command"}:
        raise provider.ProviderUnavailable("Доступ автора поручения отозван. Обработка остановлена.")
    return perms


@transaction.atomic
def fail_task(pk, generation, error):
    task = OpsAssistantTask.objects.select_for_update().filter(pk=pk).first()
    if task is None or task.processing.get("generation") != generation or task.processing.get("state") not in {"queued", "running"}:
        return
    task.processing = {**task.processing, "state": "failed", "error": error}
    task.revision += 1
    task.save(update_fields=["processing", "revision", "updated_at"])


def process_task(pk, generation):
    """Claim briefly, call model without DB lock, fence result against any newer revision."""
    with transaction.atomic():
        task = OpsAssistantTask.objects.select_for_update().filter(pk=pk).first()
        if task is None or task.processing.get("generation") != generation or task.processing.get("state") != "queued":
            return
        task.processing = {**task.processing, "state": "running", "startedAt": timezone.now().isoformat()}
        task.save(update_fields=["processing", "updated_at"])
        revision = task.revision
        message = task.messages.filter(role="user").last()
        old_plan = task.plan
    try:
        perms = _permissions(task)
        if message is None:
            raise provider.ProviderUnavailable("Сообщение не найдено. Уточните сведения вручную.")
        history = list(task.messages.filter(role="user").exclude(pk=message.pk).values_list("text", flat=True))[-6:]
        # Only language interpretation uses the message's reference time. Both
        # authorization checks, temporary grants and domain execution stay live.
        reference = parse_datetime(task.processing.get("referenceAt", "")) or message.created_at
        with clock.override(reference):
            notice = None
            try:
                proposal = provider.interpret(message.text, context={"proposal": old_plan.get("proposal", {}), "messages": history})
            except provider.ProviderUnavailable as error:
                # Retain only deterministic explicit facts when the model is down.
                # The failed state remains visible and never permits execution.
                proposal, notice = {}, str(error)
            names = list(OpsSecurityObject.objects.values_list("name", flat=True)) if perms & {"*", "event.create", "event.manage", "gvo.manage"} else []
            plan = planning.merge_dialogue_plan(message.text, proposal, old_plan, actor_id=task.initiated_by, object_names=names,
                                                patch=task.processing.get("patch", {}), guidance_binding=task.processing.get('guidanceBinding'))
        with transaction.atomic():
            current = OpsAssistantTask.objects.select_for_update().get(pk=pk)
            if current.revision != revision or current.processing.get("generation") != generation or current.processing.get("state") != "running":
                return
            _permissions(current)
            planning.protect_committed_plan(current, plan)
            current.plan = plan
            current.processing = {**current.processing, "state": "failed" if notice else "ready", "error": notice}
            current.revision += 1
            current.save(update_fields=["plan", "processing", "revision", "updated_at"])
            text = ("Обработка моделью не завершена. " + notice if notice else
                    guided_questions.reply_text(plan))
            OpsAssistantMessage.objects.create(task=current, role="assistant", text=text[:6000])
    except (provider.ProviderUnavailable, planning.ProposalError) as error:
        fail_task(pk, generation, str(error))
    except Exception:
        fail_task(pk, generation, "Не удалось обработать сообщение. Оно сохранено; повторите обработку или уточните сведения вручную.")
