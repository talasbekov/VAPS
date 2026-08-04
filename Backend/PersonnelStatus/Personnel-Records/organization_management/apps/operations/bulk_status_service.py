"""Массовое создание статусов раздела ОМ (порт apps/operations/statuses/
services/bulk_status_service.py из Backend/VAPS).

Единственный валидированный путь записи утреннего массового обновления
подразделения: список строк-отклонений, всё-или-ничего, с поразрядной
детализацией ошибок. Не перечисленные сотрудники записи НЕ получают — они
выводятся «в строю» проекцией расхода.

Число SQL-запросов ПОСТОЯННО и не зависит от количества строк: донор умер от
COUNT() в цикле, повторять это нельзя. Поэтому create_status в цикле НЕ
зовётся (он блокирует и опрашивает конфликты на каждую строку); вместо этого
одним запросом блокируются все сотрудники, одним — их подразделения, одним —
справочник упомянутых типов, одним — их живые статусы; вся валидация идёт В
ПАМЯТИ (переиспользуя _validate_interval и чистую detect_conflicts), затем
один bulk_create.

Порядок валидации: структурные и охранные ошибки — fail-fast (дубль → 400,
отсутствующий сотрудник → 404, вне области → 403), бизнес-ошибки строк —
агрегируются (422/409 собираются в detail.rows[]).

Отличия от источника:
- employee_id — целый pk старых employees; подразделение сотрудника берётся
  через штатную единицу (StaffUnit.employee), потому что у старого Employee
  нет прямой ссылки на подразделение. Сотрудник БЕЗ штатной единицы области
  видимости не принадлежит и получает 403 — гейт закрыт по умолчанию.
- Аудит: пишется record_many (одна вставка на всю пачку — иначе N записей
  журнала вернули бы ту самую зависимость числа запросов от числа строк).
  СВОДНОЙ строки, в отличие от источника, нет: класть в её entity_id нечего,
  а пачку и без неё видно — N событий одного актора с ОДНИМ временем
  (см. audit_service.ACTIONS).
- Обход мягкого конфликта (override) в массовом пути отсутствует так же, как
  в источнике: мягкое пересечение отклоняет ВСЮ пачку 409-м, оператор
  разводит такие строки поштучно через create_status.
"""
from collections import Counter

from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.conflict_matrix import detect_conflicts
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.selectors import StaffUnitSelector
from organization_management.apps.operations.status_service import (
    _conflict_details,
    _require_actor,
    _validate_interval,
)

# Ключи, которые обязана нести каждая строка payload. Ниже они читаются через
# `[]`, поэтому отсутствие ключа дало бы KeyError → 500; проверка формы
# заранее превращает это в 400.
_REQUIRED_ROW_KEYS = ("employee_id", "status_type_code", "date_start", "date_end")


def _lock_employees(employee_ids):
    """Блокировка всех сотрудников пачки ОДНИМ запросом (порт
    CoreEmployeeLockSelector.lock_employees).

    order_by("id") делает порядок захвата детерминированным: два оператора,
    пишущих одно подразделение в пик, не заклинят друг друга на разном
    порядке. Звать внутри транзакции. Возвращает {id: Employee}; отсутствующие
    id просто отсутствуют — решение о 404 принимает вызывающий.
    """
    rows = (
        Employee.objects.select_for_update()
        .filter(id__in=list(employee_ids))
        .order_by("id")
    )
    return {employee.id: employee for employee in rows}


def _divisions_of(employee_ids):
    """{employee_id: division_id} — ОДИН запрос через общий селектор.

    Одиночная правка через API резолвит область тем же селектором: правило
    «подразделение живёт в штатной единице, сотрудник без слота вне области»
    не должно разъехаться между массовым и поштучным путём.
    """
    return StaffUnitSelector.divisions_of(employee_ids)


def _overlaps(existing_rows, date_start, date_end):
    """Пересечение полуинтервалов, в памяти (предикат, который для одиночного
    пути живёт в запросе, для массового живёт здесь)."""
    return [
        row
        for row in existing_rows
        if row["date_start"] < date_end and row["date_end"] > date_start
    ]


@transaction.atomic
def bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids):
    """Создать статусы, принадлежащие оператору (source=USER), атомарно.

    ``rows``: список словарей ``{employee_id, status_type_code, date_start,
    date_end, comment?, document_basis?, source_ref?}``. ``allowed_division_ids``
    — область видимости оператора (резолвит вызывающий из RBAC; сервис лишь
    обеспечивает 403). Любая неудача поднимает один DomainError и НЕ пишет
    ничего; при успехе возвращаются созданные строки.
    """
    _require_actor(actor)
    # Защита от будущего вызывающего (незаполненное поле сериализатора):
    # business_date=None дошёл бы до detect_conflicts как ``date > None`` →
    # TypeError → 500, и его НЕ поймал бы построчный ``except DomainError``.
    if business_date is None:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "business_date"},
            message="business_date обязателен для массового обновления.",
        )
    rows = list(rows)
    if not rows:
        raise DomainError(
            "VALIDATION_ERROR", 400, message="Пустой payload массового обновления."
        )

    # Проверка формы ДО любого ``row[...]``: строка без обязательного ключа
    # иначе упала бы KeyError → 500. Отдаём 400 с индексом строки.
    for index, row in enumerate(rows):
        missing = [key for key in _REQUIRED_ROW_KEYS if key not in row]
        if missing:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"index": index, "missing": missing},
                message="В строке payload отсутствуют обязательные поля.",
            )

    # Дубль сотрудника в payload — структурная ошибка, до любой работы с БД
    # (одна строка на сотрудника; иначе пачка конфликтовала бы сама с собой в
    # обход проверки, которая смотрит только на уже сохранённые статусы).
    employee_ids = [row["employee_id"] for row in rows]
    duplicates = sorted(
        {str(eid) for eid, count in Counter(employee_ids).items() if count > 1}
    )
    if duplicates:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "employee_id", "employee_ids": duplicates},
            message="Дубль сотрудника в payload (одна строка на сотрудника).",
        )

    # Блокировка пачки (1 запрос). Отсутствующий сотрудник → 404 (fail-fast).
    locked = _lock_employees(employee_ids)
    missing = [eid for eid in employee_ids if eid not in locked]
    if missing:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"employee_ids": [str(eid) for eid in missing]},
            message="Сотрудник не найден.",
        )

    # Область видимости (fail-fast, безопасность). Подразделение — по штатной
    # единице; сотрудник без штатной единицы не попадает ни в чью область.
    allowed = set(allowed_division_ids)
    divisions = _divisions_of(employee_ids)
    out_of_scope = [
        str(eid) for eid in employee_ids if divisions.get(eid) not in allowed
    ]
    if out_of_scope:
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"employee_ids": out_of_scope},
            message="Сотрудник вне области видимости оператора.",
        )

    # Справочник упомянутых типов (1 запрос) — дальше резолв в памяти.
    codes = {row["status_type_code"] for row in rows}
    types = {
        st.code: st for st in StatusType.objects.filter(code__in=codes, is_active=True)
    }

    # Живые статусы этих сотрудников (1 запрос), группировка в памяти.
    existing_by_employee = {}
    existing = OpsEmployeeStatus.objects.filter(
        employee_id__in=employee_ids, cancelled_at__isnull=True
    ).values("employee_id", "status_type_code", "date_start", "date_end")
    for row in existing:
        existing_by_employee.setdefault(row["employee_id"], []).append(row)

    # Гард откомандированного (живой DETACHED → сотрудник закрыт для правки).
    # Считается в памяти из уже вытащенных живых статусов — без лишнего
    # запроса; одиночный путь делает то же самое отдельным exists().
    today = Clock.today_local()
    detached = sorted(
        {
            str(eid)
            for eid, st_rows in existing_by_employee.items()
            for r in st_rows
            if r["status_type_code"] == "DETACHED"
            and r["date_start"] <= today < r["date_end"]
        }
    )
    if detached:
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"employee_ids": detached},
            message="Сотрудник откомандирован — массовое обновление запрещено.",
        )

    # Построчная бизнес-валидация, целиком в памяти. DomainError каждой строки
    # ловится и копится; пока не пишется ничего.
    row_errors = []
    for index, row in enumerate(rows):
        try:
            status_type = types.get(row["status_type_code"])
            if status_type is None:
                raise DomainError(
                    "INVALID_STATUS_TYPE",
                    422,
                    detail={"status_type_code": row["status_type_code"]},
                    message="Тип статуса не найден в справочнике или неактивен.",
                )
            _validate_interval(
                date_start=row["date_start"],
                date_end=row["date_end"],
                employee=locked[row["employee_id"]],
                status_type=status_type,
            )
            overlaps = _overlaps(
                existing_by_employee.get(row["employee_id"], ()),
                row["date_start"],
                row["date_end"],
            )
            report = detect_conflicts(
                new_type=row["status_type_code"],
                existing_rows=overlaps,
                business_date=business_date,
            )
            if report.hard:
                raise DomainError(
                    "OVERLAPPING_HARD_STATUS",
                    422,
                    detail={"conflicts": _conflict_details(report.hard)},
                    message="Статус конфликтует с hard-статусом сотрудника.",
                )
            if report.soft:
                raise DomainError(
                    "STATUS_OVERLAP_WARNING",
                    409,
                    overridable=True,
                    detail={"conflicts": _conflict_details(report.soft)},
                    message="Статус пересекает soft-статус сотрудника.",
                )
        except DomainError as exc:
            row_errors.append(
                {
                    "index": index,
                    "employee_id": str(row["employee_id"]),
                    "code": exc.code,
                    "http_status": exc.http_status,
                    "message": exc.message,
                }
            )

    if row_errors:
        # Агрегация: статус и код конверта повторяют САМУЮ тяжёлую строку
        # (422 > 409), а detail.rows[] несёт код каждой строки.
        worst = max(row_errors, key=lambda err: err["http_status"])
        raise DomainError(
            worst["code"],
            worst["http_status"],
            detail={"rows": row_errors},
            message="Массовое обновление отклонено: см. detail.rows.",
        )

    # Все строки валидны → одна массовая вставка. Savepoint: параллельная
    # вставка, задевшая excl_hard_status_overlap, откатывается чисто.
    objects = [
        OpsEmployeeStatus(
            employee_id=row["employee_id"],
            status_type_code=row["status_type_code"],
            date_start=row["date_start"],
            date_end=row["date_end"],
            source=OpsEmployeeStatus.Source.USER,
            comment=row.get("comment", ""),
            document_basis=row.get("document_basis", ""),
            source_ref=row.get("source_ref"),
            created_by=actor,
        )
        for row in rows
    ]
    with transaction.atomic():
        created = OpsEmployeeStatus.objects.bulk_create(objects)
        # Журнал — в ТОМ ЖЕ savepoint: пачка и рассказ о ней либо есть вместе,
        # либо нет вовсе. Событие на КАЖДУЮ строку (а не одна сводка): лента
        # статуса ищется по entity_id, и у созданного пачкой она обязана
        # отвечать так же, как у созданного поштучно.
        audit_service.record_many(
            {
                "actor": actor,
                "action": audit_service.STATUS_CREATED,
                "entity_type": audit_service.ENTITY_STATUS,
                "entity_id": row.pk,
                "new_value": audit_service.status_snapshot(row),
            }
            for row in created
        )
    return created
