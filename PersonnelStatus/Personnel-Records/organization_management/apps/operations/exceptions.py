"""Протокол доменных ошибок раздела ОМ (порт apps/core/exceptions.py из
Backend/VAPS).

DomainError — единственный способ раздела сигналить об осмысленной для HTTP
бизнес-ошибке. Обработчик DRF (api/exception_handler.py) рендерит её в
конверт {error_code, message, details, request_id, timestamp}.

Модуль чистый — ни Django, ни DRF, ни ORM: поднимать его может любой слой
без циклов импорта.
"""


class DomainError(Exception):
    """Бизнес-ошибка с явным HTTP-статусом и кодом.

    code: код ошибки (закрытый мир — новый код заводится осознанно).
    http_status: 400 форма / 422 бизнес-правило / 409 конфликт / 403 / 404.
    detail: структурированная нагрузка в поле details конверта; None → {}.
    overridable: True только для мягких 409 — клиент может повторить с
        причиной обхода.
    message: человекочитаемое сообщение; по умолчанию — сам код.
    """

    def __init__(self, code, http_status, detail=None, overridable=False, message=None):
        self.code = code
        self.http_status = http_status
        self.detail = detail if detail is not None else {}
        self.overridable = overridable
        self.message = message or code
        super().__init__(f"{code} ({http_status})")
