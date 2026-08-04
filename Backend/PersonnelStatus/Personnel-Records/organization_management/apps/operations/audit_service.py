"""Единственная точка записи в журнал раздела ОМ (порт apps/audit/services.py
из Backend/VAPS).

Правило источника сохранено дословно: НИ ОДИН модуль вне этого файла не
создаёт строки журнала напрямую. Иначе словарь событий, формат снимков и
источник времени разъедутся по вызывающим, и журнал перестанет быть одним
рассказом об одной системе.

Запись СИНХРОННА и идёт в транзакции вызывающего: откатилась мутация —
откатилась и запись о ней. Журнал рассказывает о СЛУЧИВШЕМСЯ, а не о попытках;
попытки видит HTTP-слой (старый middleware) и логи. Отложенная запись
(on_commit, очередь, отдельное соединение) здесь запрещена именно поэтому — а
не «своя транзакция запрещена»: вложенный atomic в Django всё равно откатится
вместе с внешним, и такое правило было бы недоказуемым.

Отличие от источника: словарь событий проверяется НА ЗАПИСИ, а не только
тестом покрытия. Опечатка в коде события иначе создаёт «новое» событие,
которое никто никогда не найдёт фильтром, — а найти пропажу в журнале можно
лишь тогда, когда уже поздно.
"""
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_audit import OpsAuditLog

# ── Закрытый словарь событий ─────────────────────────────────────────────
# Коды взяты из docs/registries/audit-events.yaml источника; здесь остаются
# только те, чьи мутации в раздел уже переехали. Новое событие заводится
# осознанно — добавлением сюда, а не строкой на месте вызова.

STATUS_CREATED = "STATUS_CREATED"
STATUS_UPDATED = "STATUS_UPDATED"
STATUS_CANCELLED = "STATUS_CANCELLED"
STATUS_COMPLETED = "STATUS_COMPLETED"
STATUSES_BULK_CREATED = "STATUSES_BULK_CREATED"
SECONDMENT_INITIATED = "SECONDMENT_INITIATED"
SECONDMENT_RETURN_REQUESTED = "SECONDMENT_RETURN_REQUESTED"
SECONDMENT_RETURNED = "SECONDMENT_RETURNED"
EMPLOYEE_DISMISSED = "EMPLOYEE_DISMISSED"

ACTIONS = frozenset(
    {
        STATUS_CREATED,
        STATUS_UPDATED,
        STATUS_CANCELLED,
        STATUS_COMPLETED,
        STATUSES_BULK_CREATED,
        SECONDMENT_INITIATED,
        SECONDMENT_RETURN_REQUESTED,
        SECONDMENT_RETURNED,
        EMPLOYEE_DISMISSED,
    }
)

# Типы сущностей журнала — тоже закрытый мир: по ним ищут ленту объекта, и
# «employee_status» против «status» развалили бы поиск надвое.
ENTITY_STATUS = "employee_status"
ENTITY_SECONDMENT = "secondment"
ENTITY_EMPLOYEE = "employee"

ENTITY_TYPES = frozenset({ENTITY_STATUS, ENTITY_SECONDMENT, ENTITY_EMPLOYEE})


def record(
    *,
    actor,
    action,
    entity_type,
    entity_id,
    old_value=None,
    new_value=None,
    reason="",
):
    """Добавить строку журнала и вернуть её.

    actor — идентичность, которую вызывающий УЖЕ держит (из контракта
    аутентификации или системная метка); читать её из запроса здесь нельзя,
    сервисы раздела о запросе не знают вовсе.

    Пустой актор, незнакомое действие или незнакомый тип сущности — ValueError
    и никакой записи: это дефекты вызывающего кода, а не ситуация данных, и
    молчаливо записанный мусор в журнале хуже его отсутствия.
    """
    if not actor or not str(actor).strip():
        raise ValueError("запись в журнал требует непустого актора")
    if action not in ACTIONS:
        raise ValueError(f"неизвестное событие журнала: {action!r}")
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"неизвестный тип сущности журнала: {entity_type!r}")
    return OpsAuditLog.objects.create(
        actor_user_id=str(actor),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        # Время — через часы раздела, никогда не auto_now_add.
        created_at=Clock.now(),
    )


def status_snapshot(status):
    """Снимок строки статуса для полей old_value/new_value.

    JSON-безопасный и ПЛОСКИЙ: даты строками, никаких объектов модели —
    журнал переживает и удаление типа из справочника, и смену схемы, потому
    что хранит значения, а не ссылки.
    """
    return {
        "status_id": status.pk,
        "employee_id": status.employee_id,
        "status_type_code": status.status_type_code,
        "date_start": str(status.date_start),
        "date_end": str(status.date_end),
        "source": status.source,
        "comment": status.comment,
        "document_basis": status.document_basis,
        "cancelled_at": (
            status.cancelled_at.isoformat() if status.cancelled_at else None
        ),
        "cancelled_by": status.cancelled_by,
        "cancelled_reason": status.cancelled_reason,
    }


def secondment_snapshot(secondment):
    """Снимок пары прикомандирования — по тому же правилу, что и статус."""
    return {
        "secondment_id": secondment.pk,
        "employee_id": secondment.employee_id,
        "out_status_id": secondment.out_status_id,
        "in_status_id": secondment.in_status_id,
        "from_division_id": secondment.from_division_id,
        "to_division_id": secondment.to_division_id,
        "return_requested_at": (
            secondment.return_requested_at.isoformat()
            if secondment.return_requested_at
            else None
        ),
        "return_requested_by": secondment.return_requested_by,
        "return_confirmed_at": (
            secondment.return_confirmed_at.isoformat()
            if secondment.return_confirmed_at
            else None
        ),
        "return_confirmed_by": secondment.return_confirmed_by,
    }
