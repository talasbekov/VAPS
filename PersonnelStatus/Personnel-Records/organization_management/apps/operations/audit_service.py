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

ПРАВИЛО ПОКРЫТИЯ (срез врезки). Событие пишется на КАЖДУЮ записанную строку,
а не на каждую «операцию»: мутация строки статуса даёт событие статуса,
мутация пары прикомандирования — событие пары. Поэтому возврат из
прикомандирования кладёт три строки (обе ноги и сама пара), а увольнение —
по строке на каждый закрытый статус плюс одну на сотрудника.

Соблазн писать «одну строку на операцию» отвергнут: тогда лента КОНКРЕТНОГО
статуса (entity_type+entity_id — главный разрез журнала, под него заведён
индекс) оказалась бы пуста у всего, что создано не поштучно — у ног пары, у
всей утренней пачки, — и на вопрос «кто и когда тронул вот эту строку»
журнал отвечал бы «никто». Событие операции при этом не теряется: пара и
увольнение пишут СВОЮ строку сверх построчных.
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
STATUS_EXTENDED = "STATUS_EXTENDED"
SECONDMENT_INITIATED = "SECONDMENT_INITIATED"
SECONDMENT_RETURN_REQUESTED = "SECONDMENT_RETURN_REQUESTED"
SECONDMENT_RETURNED = "SECONDMENT_RETURNED"
EMPLOYEE_DISMISSED = "EMPLOYEE_DISMISSED"
DAILY_SUBMISSION_SUBMITTED = "DAILY_SUBMISSION_SUBMITTED"
DAILY_SUBMISSION_AMENDED = "DAILY_SUBMISSION_AMENDED"
TOMORROW_BLOCK_OVERRIDDEN = "TOMORROW_BLOCK_OVERRIDDEN"
# Сводка — та же сущность сдачи, но СВОЁ событие: «собрал из версий детей» и
# «сдал свой день» отвечают на разные вопросы, и один код на оба лишил бы
# ленту возможности их различить.
DAILY_SUMMARY_ASSEMBLED = "DAILY_SUMMARY_ASSEMBLED"
# Пересборка «взамен» — своё событие, а не поправка сдачи: поправляют СВОЙ
# день, пересобирают ЧУЖИЕ версии, и в ленте это разные истории.
DAILY_SUMMARY_REBUILT = "DAILY_SUMMARY_REBUILT"

# СНЯТО в срезе врезки: STATUSES_BULK_CREATED (сводка массового обновления).
# Класть в entity_id (NOT NULL, целое) у сводки нечего — «пачка» не сущность и
# своего идентификатора не имеет, а подсунуть туда чужой id значило бы солгать
# о том, чья это лента. Сама пачка при этом из журнала не пропала: она пишется
# N строками STATUS_CREATED с ОДНИМ актором и ОДНИМ временем (record_many
# ставит момент однажды), и это ровно то, что сводка и утверждала бы. Событие,
# которого никто не пишет, — обещание фильтра, возвращающего пустоту.
ACTIONS = frozenset(
    {
        STATUS_CREATED,
        STATUS_UPDATED,
        STATUS_CANCELLED,
        STATUS_COMPLETED,
        STATUS_EXTENDED,
        SECONDMENT_INITIATED,
        SECONDMENT_RETURN_REQUESTED,
        SECONDMENT_RETURNED,
        EMPLOYEE_DISMISSED,
        DAILY_SUBMISSION_SUBMITTED,
        DAILY_SUBMISSION_AMENDED,
        TOMORROW_BLOCK_OVERRIDDEN,
        DAILY_SUMMARY_ASSEMBLED,
        DAILY_SUMMARY_REBUILT,
    }
)

# Типы сущностей журнала — тоже закрытый мир: по ним ищут ленту объекта, и
# «employee_status» против «status» развалили бы поиск надвое.
ENTITY_STATUS = "employee_status"
ENTITY_SECONDMENT = "secondment"
ENTITY_EMPLOYEE = "employee"
ENTITY_SUBMISSION = "daily_submission"
# Обход блокировки — СВОЯ сущность, а не событие сдачи: у него нет ни
# подразделения, ни версии, и в ленте конкретной сдачи он рассказывал бы о
# решении, принятом не про неё.
ENTITY_TOMORROW_BLOCK_OVERRIDE = "tomorrow_block_override"

ENTITY_TYPES = frozenset(
    {
        ENTITY_STATUS,
        ENTITY_SECONDMENT,
        ENTITY_EMPLOYEE,
        ENTITY_SUBMISSION,
        ENTITY_TOMORROW_BLOCK_OVERRIDE,
    }
)


def _build(
    *,
    actor,
    action,
    entity_type,
    entity_id,
    created_at,
    old_value=None,
    new_value=None,
    reason="",
):
    """Проверить событие и собрать (НЕ сохранённую) строку журнала.

    Пустой актор, незнакомое действие или незнакомый тип сущности — ValueError
    и никакой записи: это дефекты вызывающего кода, а не ситуация данных, и
    молчаливо записанный мусор в журнале хуже его отсутствия. Проверка живёт
    здесь, а не в record(), чтобы пачка не могла записаться в обход неё.
    """
    if not actor or not str(actor).strip():
        raise ValueError("запись в журнал требует непустого актора")
    if action not in ACTIONS:
        raise ValueError(f"неизвестное событие журнала: {action!r}")
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"неизвестный тип сущности журнала: {entity_type!r}")
    return OpsAuditLog(
        actor_user_id=str(actor),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        created_at=created_at,
    )


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
    """
    entry = _build(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        # Время — через часы раздела, никогда не auto_now_add.
        created_at=Clock.now(),
    )
    entry.save()
    return entry


def record_many(entries):
    """Добавить строки журнала ОДНИМ запросом и вернуть их.

    Существует ради путей с постоянным числом запросов (массовое обновление):
    там record() в цикле дал бы N вставок и вернул бы ровно ту зависимость
    числа запросов от числа строк, от которой умер донор. Проверка события та
    же самая и на КАЖДУЮ строку — пачка не льгота, а способ доставки.

    Время ставится ОДНАЖДЫ на всю пачку, а не построчно: это одна операция
    одного актора, и одинаковый момент — то единственное, чем строки пачки
    отличимы от N независимых записей (сводной строки у пачки нет, см. ACTIONS).
    """
    entries = list(entries)
    if not entries:
        return []
    now = Clock.now()
    rows = [_build(created_at=now, **entry) for entry in entries]
    return OpsAuditLog.objects.bulk_create(rows)


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


def submission_snapshot(submission):
    """Снимок версии сдачи дня — по тому же правилу, что и статус.

    Сам снимок ДНЯ сюда не кладётся: он иммутабельно живёт в своей строке, а
    в журнале раздулся бы до сотен килобайт на событие. Для восстановления
    достаточно ссылки на строку.

    Атрибуты поправки входят БЕЗУСЛОВНО, хотя у первичной сдачи они пусты
    (отличие от источника: там они надстраиваются вызывающим только над
    версиями-поправками). Условная форма означала бы, что две записи об одном
    типе сущности несут разный набор ключей, и читатель ленты не смог бы
    опереться ни на один — отсутствие ключа неотличимо от «причины не было».
    """
    return {
        "submission_id": submission.pk,
        "division_id": submission.division_id,
        "business_date": str(submission.business_date),
        "version": submission.version,
        "event": submission.event,
        "late": submission.late,
        "is_current": submission.is_current,
        "submitted_at": submission.submitted_at.isoformat(),
        "reason": submission.reason,
        "sanction": submission.sanction,
        "triggered_by_status_id": submission.triggered_by_status_id,
    }
