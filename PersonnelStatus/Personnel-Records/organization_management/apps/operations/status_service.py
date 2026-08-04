"""Сервис статусов раздела ОМ (порт ядра apps/operations/statuses/services/
status_service.py из Backend/VAPS: create_status и cancel_status со всеми
валидациями).

Портировано дословно: гард откомандированного (FR-16), пессимистичная
блокировка сотрудника, проверка типа по справочнику, границы найма,
предельная длительность типа, детект конфликтов через матрицу (жёсткий →
422, мягкий → 409 с обходом), запись обхода только при реально обойдённом
конфликте, отмена только не начавшегося статуса с append-once фактами,
правка метаданных/интервала (update_status).

НЕ портировано в этом срезе (осознанно, отдельными кусками):
complete_status_early/extend_status, догон материализации, увольнение,
прикомандирование. Аудит мутаций (в источнике — record(...)) здесь НЕ
вызывается: у старого проекта свой apps.audit, склейка — отдельный срез;
пока факты пишутся без аудит-следа раздела.
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


def _lock_for_edit(status):
    """Общая преамбула правки существующей строки: блокировка → перечитка →
    гарды. Возвращает (сотрудник, СВЕЖАЯ строка под блокировкой).

    Порядок захвата всюду один — сотрудник, затем строка статуса (так же
    берёт блокировки create_status и пачка), поэтому взаимной блокировки
    двух операторов не возникает. Блокировка СОТРУДНИКА сериализует правку с
    созданием (иначе правка интервала и параллельная вставка проверяли бы
    пересечения по разным снимкам); блокировка САМОЙ СТРОКИ плюс перечитка
    держат append-once: второй писатель, пришедший со своим устаревшим
    in-memory объектом (cancelled_at=None), после блокировки видит
    канонические факты первого и получает отказ, а не переписывает их.

    ЗДЕСЬ ЖЕ единственный владелец гарда «отменённая строка терминальна»:
    отменённый статус не правится и не отменяется повторно. Вызывающим
    остаётся их собственная часть жизненного цикла (cancel_status — что
    отменить можно только не начавшийся).

    ОТЛИЧИЕ ОТ ИСТОЧНИКА: там update_status идёт без перечитки и без гарда
    отменённой строки (блокирует только сотрудника) — известная дыра
    ретроспективы E3. При переезде она закрыта: путь правки и путь отмены
    делят одну преамбулу.
    """
    employee = _lock_employee(status.employee_id)
    try:
        locked = OpsEmployeeStatus.objects.select_for_update().get(pk=status.pk)
    except ObjectDoesNotExist:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"status_id": status.pk},
            message="Статус не найден.",
        ) from None
    locked.assert_user_editable()
    if locked.cancelled_at is not None:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": str(OpsEmployeeStatus.LifecycleState.CANCELLED)},
            message="Статус отменён — отменённая строка терминальна.",
        )
    return employee, locked


@transaction.atomic
def update_status(
    status,
    *,
    actor,
    date_start=None,
    date_end=None,
    comment=None,
    document_basis=None,
):
    """Правка оператором своей строки: интервал и метаданные.

    Переходы жизненного цикла (отмена/досрочное закрытие/продление) сюда НЕ
    входят: отмена — cancel_status, остальное — отдельный срез. Тип статуса и
    сотрудник не меняются — это другая строка, а не правка этой.

    Интервал перепроверяется ТОЛЬКО когда реально меняется дата: правка
    комментария не должна упираться в интервал, ставший «невалидным» уже
    после создания (тип деактивировали, границы найма или предел
    длительности ужесточили). Блокировка и гарды при этом отрабатывают на
    любой правке.

    Возвращает перечитанную под блокировкой строку — переданный объект НЕ
    мутируется (он мог быть устаревшим; его состояние не источник правды).
    Так же ведёт себя cancel_status.
    """
    _require_actor(actor)
    employee, locked = _lock_for_edit(status)
    # Гард откомандированного — по СОТРУДНИКУ строки, не по области актора.
    assert_employee_status_editable(locked.employee_id)

    if date_start is not None or date_end is not None:
        new_start = locked.date_start if date_start is None else date_start
        new_end = locked.date_end if date_end is None else date_end
        status_type = _resolve_status_type(locked.status_type_code)
        _validate_interval(
            date_start=new_start,
            date_end=new_end,
            employee=employee,
            status_type=status_type,
        )
        # Себя из периметра исключаем: строка всегда пересекается сама с
        # собой, иначе любая правка дат конфликтовала бы со своим оригиналом.
        _assert_no_conflict(
            employee_id=locked.employee_id,
            status_type_code=locked.status_type_code,
            date_start=new_start,
            date_end=new_end,
            exclude_pk=locked.pk,
        )

    changed = []
    for field, value in (
        ("date_start", date_start),
        ("date_end", date_end),
        ("comment", comment),
        ("document_basis", document_basis),
    ):
        if value is not None:
            setattr(locked, field, value)
            changed.append(field)
    if changed:
        changed.append("updated_at")
        # Savepoint вокруг гоночной записи: правка дат может упереться в
        # excl_hard_status_overlap, и IntegrityError не должен отравлять
        # транзакцию вызывающего. update_fields, а не голый save(): голый
        # переписал бы source и генерируемый period чужими значениями.
        with transaction.atomic():
            locked.save(update_fields=changed)
    return locked


# Ноги пары прикомандирования: их закрытие не должно упираться в гард
# откомандированного (строка ограничивает — и заблокировала бы сама себя).
_SECONDMENT_LEG_CODES = ("DETACHED", "ATTACHED")


@transaction.atomic
def complete_status_early(status, *, actor, actual_end):
    """Закрыть ИДУЩИЙ (ACTIVE) статус фактической датой окончания.

    Досрочно закрывается только ACTIVE: не начавшийся статус не случился —
    его отменяют, завершённый уже закрыт. Факт не бывает в будущем
    (actual_end ≤ сегодня), и интервал остаётся непустым: полуинтервал
    [начало, окончание) не умеет закрывать статус днём его начала — такая
    строка означала бы «не было вовсе», а это отмена, другая операция.

    Возвращает перечитанную под блокировкой строку; переданный объект НЕ
    мутируется — так же ведут себя update_status и cancel_status. ОТЛИЧИЕ ОТ
    ИСТОЧНИКА: там гарды читаются с блокированной строки, а сохраняется
    ПЕРЕДАННЫЙ объект — устаревшая копия переписала бы свежие факты.

    Гард откомандированного (FR-16) не зовётся для самих ног пары
    прикомандирования: закрытие ограничивающей строки заблокировало бы себя.
    Для ПРОЧИХ типов гард действует — откомандированному чужие статусы не
    закрывают, как и не правят.
    """
    _require_actor(actor)
    _, locked = _lock_for_edit(status)
    if locked.status_type_code not in _SECONDMENT_LEG_CODES:
        assert_employee_status_editable(locked.employee_id)
    today = Clock.today_local()
    state = locked.state_on(today)
    if state != OpsEmployeeStatus.LifecycleState.ACTIVE:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"state": str(state)},
            message="Досрочно завершить можно только идущий (ACTIVE) статус.",
        )
    if actual_end > today:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"actual_end": str(actual_end), "today": str(today)},
            message="Дата фактического завершения не может быть в будущем.",
        )
    if actual_end <= locked.date_start:
        raise DomainError(
            "INVALID_DATE_RANGE",
            422,
            detail={
                "actual_end": str(actual_end),
                "date_start": str(locked.date_start),
            },
            message="Дата завершения должна быть позже даты начала статуса.",
        )
    locked.date_end = actual_end
    # update_fields, а не голый save(): голый переписал бы source и
    # генерируемый period чужими значениями.
    locked.save(update_fields=["date_end", "updated_at"])
    return locked


@transaction.atomic
def cancel_status(status, *, actor, reason):
    """Отменить не начавшийся (PLANNED) статус — факты отмены append-once.

    Отменяется только PLANNED: начавшийся или завершённый статус — факт,
    который случился (его закрывают раньше срока, а не отменяют). Отменённую
    строку отсекает раньше общий гард в _lock_for_edit, поэтому здешняя
    проверка владеет ровно ACTIVE/COMPLETED. cancelled_at/by/reason пишутся
    один раз и на уровне сервиса не переписываются.
    """
    _require_actor(actor)
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="При отмене статуса обязательна непустая причина.",
        )
    _, locked = _lock_for_edit(status)
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
