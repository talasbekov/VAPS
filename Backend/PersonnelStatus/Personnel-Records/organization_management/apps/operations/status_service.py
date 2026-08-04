"""Сервис статусов раздела ОМ (порт ядра apps/operations/statuses/services/
status_service.py из Backend/VAPS: create_status и cancel_status со всеми
валидациями).

Портировано дословно: гард откомандированного (FR-16), пессимистичная
блокировка сотрудника, проверка типа по справочнику, границы найма,
предельная длительность типа, детект конфликтов через матрицу (жёсткий →
422, мягкий → 409 с обходом), запись обхода только при реально обойдённом
конфликте, отмена только не начавшегося статуса с append-once фактами.

НЕ портировано в этом срезе (осознанно, отдельными кусками):
update_status/complete_status_early/extend_status, bulk-создание, догон
материализации, увольнение, прикомандирование, расчёт расхода. Аудит
мутаций (в источнике — record(...)) здесь НЕ вызывается: у старого проекта
свой apps.audit, склейка — отдельный срез; пока факты пишутся без
аудит-следа раздела.
"""
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.conflict_matrix import detect_conflicts
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    StatusOverride,
)


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")


def assert_employee_status_editable(employee_id):
    """Откомандированный сотрудник закрыт для правки статусов.

    Пока у сотрудника есть ЖИВОЙ статус DETACHED, попытка любого оператора
    создать/править его статусы — 403. Ограничение следует за СОТРУДНИКОМ, а
    не за областью правящего, поэтому действует и в штатном, и в принимающем
    подразделении. Прямой запрос существования (не «победитель дня»: статус
    с большим приоритетом замаскировал бы живой DETACHED). Пути возврата из
    прикомандирования и увольнения этот гард звать НЕ должны — они законно
    закрывают ограничивающий статус.
    """
    today = Clock.today_local()
    if OpsEmployeeStatus.objects.filter(
        employee_id=employee_id,
        status_type_code="DETACHED",
        cancelled_at__isnull=True,
        date_start__lte=today,
        date_end__gt=today,
    ).exists():
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"employee_id": str(employee_id)},
            message="Сотрудник откомандирован — редактирование статусов запрещено.",
        )


def _lock_employee(employee_id):
    """Пессимистичная блокировка; отсутствующий сотрудник → 404, не 500."""
    try:
        return Employee.objects.select_for_update().get(pk=employee_id)
    except ObjectDoesNotExist:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"employee_id": str(employee_id)},
            message="Сотрудник не найден.",
        ) from None


def _resolve_status_type(status_type_code):
    """Тип обязан существовать в справочнике и быть активным."""
    status_type = StatusType.objects.filter(
        code=status_type_code, is_active=True
    ).first()
    if status_type is None:
        raise DomainError(
            "INVALID_STATUS_TYPE",
            422,
            detail={"status_type_code": status_type_code},
            message="Тип статуса не найден в справочнике или неактивен.",
        )
    return status_type


def _employment_bounds(employee):
    """Границы найма сотрудника старой структуры.

    Отличие от источника: там у core.Employee поля hire_date/dismissal_date;
    здесь имена берутся через getattr — если в старой модели их нет, граница
    считается открытой, а не падает AttributeError.
    """
    return (
        getattr(employee, "hire_date", None),
        getattr(employee, "dismissal_date", None),
    )


def _validate_interval(*, date_start, date_end, employee, status_type):
    # Пустой/инвертированный интервал ловится ДО генерируемой колонки period,
    # иначе DataError ушёл бы 500-м. Полуинтервал [s, e): однодневный
    # [D, D+1) валиден.
    if date_start >= date_end:
        raise DomainError(
            "INVALID_DATE_RANGE",
            422,
            detail={"date_start": str(date_start), "date_end": str(date_end)},
            message="Интервал пуст или инвертирован (date_start >= date_end).",
        )
    hire_date, dismissal_date = _employment_bounds(employee)
    if hire_date is not None and date_start < hire_date:
        raise DomainError(
            "DATE_OUTSIDE_EMPLOYMENT",
            422,
            detail={"date_start": str(date_start), "hire_date": str(hire_date)},
            message="Начало статуса раньше даты приёма сотрудника.",
        )
    if dismissal_date is not None and date_end > dismissal_date:
        raise DomainError(
            "DATE_OUTSIDE_EMPLOYMENT",
            422,
            detail={
                "date_end": str(date_end),
                "dismissal_date": str(dismissal_date),
            },
            message="Конец статуса позже даты увольнения сотрудника.",
        )
    if status_type.max_duration_days is not None:
        duration = (date_end - date_start).days
        if duration > status_type.max_duration_days:
            raise DomainError(
                "MAX_DURATION_EXCEEDED",
                422,
                detail={
                    "days": duration,
                    "max_duration_days": status_type.max_duration_days,
                },
                message="Длительность статуса превышает лимит типа.",
            )


def _conflict_details(conflicts):
    return [
        {
            "status_type": c.other_status_type,
            "date_start": str(c.other_date_start),
            "date_end": str(c.other_date_end),
        }
        for c in conflicts
    ]


def _assert_no_conflict(
    *,
    employee_id,
    status_type_code,
    date_start,
    date_end,
    exclude_pk=None,
    override=False,
):
    # Классифицируем каждый живой пересекающийся статус декларативной
    # матрицей. Предикат пересечения полуинтервалов живёт ЗДЕСЬ (в запросе),
    # матрица остаётся чистой. Жёсткий → 422 (ограничение БД подстраховывает
    # именно гонку hard×hard; hard×soft ловится только тут); мягкий на
    # ACTIVE → 409 с обходом; мягкий с ещё не начавшимся — предупреждение.
    overlaps = OpsEmployeeStatus.objects.filter(
        employee_id=employee_id,
        cancelled_at__isnull=True,
        date_start__lt=date_end,
        date_end__gt=date_start,
    )
    if exclude_pk is not None:
        overlaps = overlaps.exclude(pk=exclude_pk)
    rows = list(overlaps.values("status_type_code", "date_start", "date_end"))
    report = detect_conflicts(
        new_type=status_type_code,
        existing_rows=rows,
        business_date=Clock.today_local(),
    )
    if report.hard:
        raise DomainError(
            "OVERLAPPING_HARD_STATUS",
            422,
            detail={
                "employee_id": str(employee_id),
                "conflicts": _conflict_details(report.hard),
            },
            message="Статус конфликтует с hard-статусом сотрудника.",
        )
    # Мягкий → 409 с возможностью обхода, ЕСЛИ вызывающий не передал
    # override=True: тогда конфликты возвращаются, чтобы записать обход.
    # Жёсткий не обходится никогда — до сюда он не доходит.
    if report.soft and not override:
        raise DomainError(
            "STATUS_OVERLAP_WARNING",
            409,
            overridable=True,
            detail={"conflicts": _conflict_details(report.soft)},
            message="Статус пересекает soft-статус (возможен override).",
        )
    return report.soft


@transaction.atomic
def create_status(
    *,
    employee_id,
    status_type_code,
    date_start,
    date_end,
    actor,
    comment="",
    document_basis="",
    source_ref=None,
    override=False,
    override_reason="",
):
    """Создать статус, принадлежащий оператору, со всеми валидациями.

    source жёстко USER: строки проекции пишет не этот путь. При override=True
    мягкий (409) конфликт обходится и записывается StatusOverride; override
    никогда не обходит жёсткий (422), а пустая причина — 400.
    """
    _require_actor(actor)
    employee = _lock_employee(employee_id)
    assert_employee_status_editable(employee_id)
    # Причина обхода проверяется ДО (более дорогого) детекта конфликтов.
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="При override обязательна непустая причина.",
        )
    status_type = _resolve_status_type(status_type_code)
    _validate_interval(
        date_start=date_start,
        date_end=date_end,
        employee=employee,
        status_type=status_type,
    )
    bypassed_conflicts = _assert_no_conflict(
        employee_id=employee_id,
        status_type_code=status_type_code,
        date_start=date_start,
        date_end=date_end,
        override=override,
    )

    status = OpsEmployeeStatus(
        employee_id=employee_id,
        status_type_code=status_type_code,
        date_start=date_start,
        date_end=date_end,
        source=OpsEmployeeStatus.Source.USER,
        comment=comment,
        document_basis=document_basis,
        source_ref=source_ref,
        created_by=actor,
    )
    # Savepoint вокруг гоночного INSERT: параллельная вставка, проскочившая
    # предпроверку, ловится excl_hard_status_overlap; savepoint откатывается
    # чисто, IntegrityError уходит наверх. Запись обхода — в ТОМ ЖЕ
    # savepoint: статус и обход коммитятся или откатываются вместе, и обход
    # создаётся ТОЛЬКО когда мягкий конфликт реально обойдён.
    with transaction.atomic():
        status.save()
        if override and bypassed_conflicts:
            StatusOverride.objects.create(
                status=status,
                employee_id=employee_id,
                status_type_code=status_type_code,
                reason=override_reason,
                conflicts=_conflict_details(bypassed_conflicts),
                created_by=actor,
            )
    return status


@transaction.atomic
def cancel_status(status, *, actor, reason):
    """Отменить не начавшийся (PLANNED) статус — факты отмены append-once.

    Отменяется только PLANNED: начавшийся или завершённый статус — факт,
    который случился (его закрывают раньше срока, а не отменяют), а
    отменённый терминален. cancelled_at/by/reason пишутся один раз и на
    уровне сервиса не переписываются.
    """
    _require_actor(actor)
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="При отмене статуса обязательна непустая причина.",
        )
    locked = OpsEmployeeStatus.objects.select_for_update().get(pk=status.pk)
    state = locked.state_on(Clock.today_local())
    if state != OpsEmployeeStatus.LifecycleState.PLANNED:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": str(state)},
            message="Отменить можно только не начавшийся (PLANNED) статус.",
        )
    locked.cancelled_at = Clock.now()
    locked.cancelled_by = actor
    locked.cancelled_reason = reason
    locked.save(
        update_fields=[
            "cancelled_at",
            "cancelled_by",
            "cancelled_reason",
            "updated_at",
        ]
    )
    return locked
