"""Обработчик исключений DRF (порт apps/core/api/exception_handler.py из
Backend/VAPS) — единственное место, где ошибки раздела ОМ становятся
ответами в конверте {error_code, message, details, request_id, timestamp}.

ГЛАВНОЕ ОТЛИЧИЕ ОТ ИСТОЧНИКА: там обработчик переформатирует В КОНВЕРТ ЛЮБОЙ
ответ DRF (400/401/403/404 всех вьюх). Здесь так нельзя: у старых экранов
свои ожидания формата ошибок, и молчаливая смена формы сломала бы их.
Поэтому:
- DomainError → конверт (его поднимает только код раздела ОМ);
- IntegrityError по ИЗВЕСТНОМУ ограничению раздела → конверт (иначе гонка
  превратилась бы в 500);
- всё остальное отдаётся штатному обработчику DRF БЕЗ изменений.

Регистрируется в REST_FRAMEWORK["EXCEPTION_HANDLER"].
"""
import logging
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError

logger = logging.getLogger(__name__)

# имя ограничения → (код ошибки, http-статус, обходима ли).
# Гонка, проскочившая предпроверку сервиса, обязана выглядеть как то же
# бизнес-правило, а не как 500.
CONSTRAINT_ERROR_MAP = {
    "excl_hard_status_overlap": ("OVERLAPPING_HARD_STATUS", 422, False),
}


def _timestamp():
    tz = ZoneInfo(getattr(settings, "OPS_LOCAL_TIMEZONE", settings.TIME_ZONE))
    return Clock.now().astimezone(tz).isoformat()


def _request_id(context):
    request = (context or {}).get("request")
    return getattr(request, "request_id", None)


def _envelope(error_code, message, details, http_status, context, overridable=False):
    payload = {
        "error_code": error_code,
        "message": message or error_code,
        "details": details if details is not None else {},
        "request_id": _request_id(context),
        "timestamp": _timestamp(),
    }
    if overridable:
        # Признак «можно повторить с причиной» несёт сам ответ: клиент не
        # должен угадывать обходимость по коду.
        payload["overridable"] = True
    return Response(payload, status=http_status)


def _constraint_name(exc):
    # psycopg отдаёт нарушенное ограничение в диагностике — устойчиво к
    # локали и переименованиям, в отличие от поиска подстроки в тексте.
    diag = getattr(getattr(exc, "__cause__", None), "diag", None)
    return getattr(diag, "constraint_name", None)


def ops_exception_handler(exc, context):
    if isinstance(exc, DomainError):
        return _envelope(
            exc.code,
            exc.message,
            exc.detail,
            exc.http_status,
            context,
            overridable=exc.overridable,
        )
    if isinstance(exc, IntegrityError):
        mapped = CONSTRAINT_ERROR_MAP.get(_constraint_name(exc))
        if mapped is not None:
            code, http_status, overridable = mapped
            logger.warning("ops constraint violation: %s", code)
            return _envelope(
                code,
                "Нарушено ограничение целостности раздела ОМ.",
                {},
                http_status,
                context,
                overridable=overridable,
            )
    # Чужие ошибки — штатный путь DRF, форма ответа не меняется.
    return drf_exception_handler(exc, context)
