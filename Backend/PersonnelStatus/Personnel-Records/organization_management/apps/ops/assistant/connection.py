"""Redacted connection settings and explicit credential destination policy."""
import ipaddress
import re
import uuid
from urllib.parse import unquote, urlsplit, urlunsplit

from django.conf import settings
from django.db import transaction
from django.views.decorators.debug import sensitive_variables
from rest_framework.exceptions import APIException, ValidationError

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from . import credentials


class RevisionConflict(APIException):
    status_code = 409
    default_detail = "Настройки изменены другим пользователем. Обновите страницу и повторите действие."


def invalid(message):
    raise ValidationError({"detail": message})


def normalize_url(value):
    """Admin-selected destinations may use private addresses and local DNS."""
    try:
        if not isinstance(value, str) or len(value) > 1000 or any(ord(c) < 32 or ord(c) == 127 for c in value) or "\\" in value:
            raise ValueError
        value = value.strip()
        address = urlsplit(value)
        host = address.hostname
        if address.scheme not in {"http", "https"} or not host or address.username is not None or address.password is not None or "?" in value or "#" in value:
            raise ValueError
        port = address.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError
        if "%" in host:
            raise ValueError
        try:
            ipaddress.ip_address(host)
        except ValueError:
            host = host.encode("idna").decode("ascii").lower()
            if len(host) > 253 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.rstrip(".").split(".")):
                raise ValueError
        decoded = unquote(address.path)
        if any(ord(c) < 32 or ord(c) == 127 for c in decoded) or "\\" in decoded or any(segment in {".", ".."} for segment in decoded.split("/")):
            raise ValueError
        netloc = f"[{host}]" if ":" in host else host
        if port is not None:
            netloc += f":{port}"
        return urlunsplit((address.scheme, netloc, address.path.rstrip("/"), "", ""))
    except (ValueError, UnicodeError):
        invalid("Укажите адрес сервера http:// или https:// без логина, пароля, параметров и фрагмента.")


def origin(value):
    if not value:
        return None
    address = urlsplit(value)
    return (address.scheme, address.hostname, address.port or (443 if address.scheme == "https" else 80))


def environment_configuration():
    enabled = getattr(settings, "OPS_ASSISTANT_PROVIDER", "disabled") == "ollama"
    return {"provider": "ollama" if enabled else "disabled",
            "baseUrl": getattr(settings, "OPS_ASSISTANT_OLLAMA_URL", "http://127.0.0.1:11434") if enabled else "",
            "model": getattr(settings, "OPS_ASSISTANT_MODEL", "qwen2.5:7b") if enabled else "",
            "apiKey": "", "revision": "0", "environmentOnly": True}


@sensitive_variables()
def configuration(row=None, *, tolerate_unreadable=False):
    if row is None:
        row = OpsAssistantConnection.objects.filter(pk=1).first()
    if row is None:
        return environment_configuration()
    result = {"provider": row.provider, "baseUrl": row.base_url, "model": row.model,
              "revision": str(row.revision), "_hasKey": bool(row.api_key)}
    try:
        result["apiKey"] = credentials.unseal(row.api_key, row.api_key_format)
    except credentials.CredentialUnavailable:
        if not tolerate_unreadable:
            raise
        result.update(apiKey="", keyError=credentials.UNAVAILABLE)
    return result


def public(config):
    result = {**{key: config[key] for key in ("provider", "baseUrl", "model", "revision")},
              "hasKey": config.get("_hasKey", bool(config["apiKey"]))}
    if config.get("keyError"):
        result["keyError"] = config["keyError"]
    return result


@sensitive_variables()
def validate_draft(data, current):
    allowed = {"provider", "baseUrl", "model", "revision", "apiKey", "clearKey"}
    if not isinstance(data, dict) or set(data) - allowed:
        invalid("Неизвестные поля настроек подключения.")
    if not isinstance(data.get("revision"), str):
        invalid("Обновите настройки перед сохранением или проверкой.")
    if data["revision"] != current["revision"]:
        raise RevisionConflict()
    name = data.get("provider")
    if not isinstance(name, str) or name not in {"disabled", "openai", "ollama"}:
        invalid("Выберите тип подключения.")
    url, model = data.get("baseUrl"), data.get("model")
    if not isinstance(url, str) or not isinstance(model, str) or len(model) > 200 or any(ord(c) < 32 for c in model):
        invalid("Укажите адрес сервера и название модели.")
    url = normalize_url(url) if url else ""
    model = model.strip()
    if name != "disabled" and (not url or not model):
        invalid("Для подключения требуются адрес сервера и название модели.")
    key, clear = data.get("apiKey", ""), data.get("clearKey", False)
    if not isinstance(key, str) or len(key) > 4096 or any(ord(c) < 32 or ord(c) > 126 for c in key) or type(clear) is not bool:
        invalid("Некорректный ключ доступа или признак удаления ключа.")
    key = key.strip()
    if key and clear:
        invalid("Задайте новый ключ или удалите сохранённый ключ одним действием.")
    if current.get("keyError") and not key and not clear:
        invalid(credentials.UNAVAILABLE)
    if current.get("_hasKey", bool(current["apiKey"])) and origin(url) != origin(current["baseUrl"]) and not key and not clear:
        invalid("Адрес сервера изменён. Задайте новый ключ или явно удалите сохранённый.")
    return {"provider": name, "baseUrl": url, "model": model, "apiKey": "" if clear else key or current["apiKey"], "revision": current["revision"]}


@transaction.atomic
@sensitive_variables()
def save(data, actor):
    fallback = environment_configuration()
    # get_or_create arbitrates the first save; select_for_update locks both the
    # existing row and the winner of a concurrent initial insert. Invalid drafts
    # roll back the provisional insert together with this transaction.
    row, _ = OpsAssistantConnection.objects.select_for_update().get_or_create(
        pk=1, defaults={"provider": fallback["provider"], "base_url": fallback["baseUrl"], "model": fallback["model"], "revision": "0"})
    before = configuration(row, tolerate_unreadable=True)
    after = validate_draft(data, before)
    try:
        encrypted = credentials.seal(after["apiKey"])
    except credentials.CredentialUnavailable:
        invalid("Серверный ключ шифрования ИИ настроен неверно. Настройки не сохранены.")
    row.provider, row.base_url, row.model, row.api_key = after["provider"], after["baseUrl"], after["model"], encrypted
    row.api_key_format = credentials.FORMAT
    row.updated_by, row.revision = actor, str(uuid.uuid4())
    row.save()
    after = configuration(row)
    audit_service.record(actor=actor, action=audit_service.SETTINGS_UPDATED, entity_type="assistant_connection", entity_id=1,
                         old_value=public(before), new_value={**public(after),
                         "keyChanged": bool(before.get("keyError")) or before["apiKey"] != after["apiKey"]})
    return public(after)
