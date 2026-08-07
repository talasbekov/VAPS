"""Сервис статусов раздела ОМ (порт ядра apps/operations/statuses/services/
status_service.py из Backend/VAPS: create_status и cancel_status со всеми
валидациями).

Портировано дословно: гард откомандированного (FR-16), пессимистичная
блокировка сотрудника, проверка типа по справочнику, границы найма,
предельная длительность типа, детект конфликтов через матрицу (жёсткий →
422, мягкий → 409 с обходом), запись обхода только при реально обойдённом
конфликте, отмена только не начавшегося статуса с append-once фактами,
правка метаданных/интервала (update_status), продление (extend_status).

НЕ портировано (осознанно, отдельными кусками): догон материализации.

Каждая мутация пишет событие в журнал РАЗДЕЛА (audit_service) — в той же
транзакции, что и сама запись: откатился факт — откатилась и строка о нём.
Старый apps.audit при этом не трогается, он о другом (см. models_audit).
"""
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.amendment_enforcement import (
    enforce_amendment_on_retro_edit,
)
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

    Ограничение снимает РЕШЕНИЕ, а не календарь: нога с подтверждённым
    возвратом больше не блокирует, хотя и действует до конца сегодняшнего дня
    (возврат вступает в силу со следующего — см. secondment_service). Иначе
    спор двух подразделений считался бы неоконченным до полуночи, и штатный
    оператор не мог бы поставить вернувшемуся наряд на завтра.

    ОГРАНИЧИВАЮЩИЕ ТИПЫ ЗАДАЁТ СПРАВОЧНИК (restricts_editing), а не литерал.
    Раньше здесь стоял код DETACHED наизусть, а флаг справочника читал один
    сериализатор — то есть API объявлял клиенту свойство типа, которого бэк не
    исполнял: пометь администратор ограничивающим ещё один тип, экран показал
    бы замок, а правка прошла бы. Довод тот же, которым обосновано чтение
    признака заглушки из справочника (resolve_placeholder): сервис, знающий имя
    наизусть, не признаёт того, что завёл администратор.

    Пустой список ограничивающих типов — законное состояние (никто не закрыт),
    и запрос с пустым `__in` его и означает.
    """
    # Импорт внутри функции: селекторы ↔ сервисы иначе образуют цикл (тот же
    # приём, что у снимка).
    from organization_management.apps.operations.selectors import StatusTypeSelector

    today = Clock.today_local()
    # Пустой список ограничивающих типов — законное состояние (никто не
    # закрыт), и запрос с пустым `__in` его и означает. Ранняя ветка «если
    # список пуст — выйти» здесь стояла и снята: её удаление не роняло ни
    # одного теста, то есть наблюдаемого поведения у неё не было, зато она
    # ПРЯТАЛА от пробы возврат литерала — со снятой пометкой список пустел, и
    # до запроса дело не доходило вовсе.
    restricting = StatusTypeSelector.restricting_codes()
    if (
        OpsEmployeeStatus.objects.filter(
            employee_id=employee_id,
            status_type_code__in=restricting,
            cancelled_at__isnull=True,
            date_start__lte=today,
            date_end__gt=today,
        )
        .exclude(secondment_out__return_confirmed_at__isnull=False)
        .exists()
    ):
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"employee_id": str(employee_id)},
            message="Сотрудник откомандирован — редактирование статусов запрещено.",
        )


def assert_employee_is_employed(employee):
    """Уволенному статус не заводят.

    Дыру закрывает именно этот гвард, а не границы найма: те смотрят на
    dismissal_date, а уволить можно и НЕ проставив её — карточка позволяет
    пустую дату, и приёмник увольнения это прямо допускает (закрывает статусы
    «сегодняшним» числом). При пустой дате граница найма открыта, и до этого
    гварда уволенному можно было завести статус чем угодно.

    Вреда сразу не видно — уволенный выпадает из списочного состава, — и в этом
    вся неприятность: строка лежит тихо, а всплывает при восстановлении, когда
    человек возвращается в списки уже со статусами, которых ему никто не ставил.
    Плюс она противоречит записи журнала об увольнении, где сказано, что все
    статусы закрыты.

    Гвард зовут только пути СОЗДАНИЯ. Закрывать и отменять существующие строки
    уволенного по-прежнему можно: это уборка, и запрещать её значило бы оставить
    хвосты навсегда.

    Принимает УЖЕ ЗАГРУЖЕННУЮ карточку, а не идентификатор, и своего запроса не
    делает. Оба вызывающих держат её в руках (обоим она нужна под замком), а
    запрос по идентификатору дал бы у пачки по обращению НА СТРОКУ — ровно ту
    зависимость числа запросов от размера пачки, ради отсутствия которой пачка и
    написана. Поймано это не рассуждением: первый проход спрашивал базу, и два
    теста на постоянство числа запросов покраснели сразу.
    """
    from organization_management.apps.employees.models import Employee

    if employee.employment_status != Employee.EmploymentStatus.WORKING:
        raise DomainError(
            "EMPLOYEE_NOT_EMPLOYED",
            422,
            detail={"employee_id": str(employee.pk)},
            message="Сотрудник не работает: статус завести нельзя.",
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
    amendment_reason="",
):
    """Создать статус, принадлежащий оператору, со всеми валидациями.

    source жёстко USER: строки проекции пишет не этот путь. При override=True
    мягкий (409) конфликт обходится и записывается StatusOverride; override
    никогда не обходит жёсткий (422), а пустая причина — 400.

    `amendment_reason` нужен ТОЛЬКО когда интервал накрывает сданный день:
    новая строка задним числом меняет уже заявленный расход, и сданное
    обязано быть вытеснено поправкой (см. amendment_enforcement). Без
    причины такая правка — 422, обычная правка причины не требует.
    """
    _require_actor(actor)
    employee = _lock_employee(employee_id)
    assert_employee_is_employed(employee)
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
    #
    # Событие журнала — тоже ЗДЕСЬ, а не после блока: у create_status своей
    # внешней транзакции нет, и в автокоммите запись снаружи ушла бы отдельным
    # оператором — упав, она оставила бы уже закоммиченный статус без строки о
    # нём. ЧЕСТНО: тестом это не закреплено и закрепить нечем — под django_db
    # весь тест идёт в одной транзакции, и вынос вызова за savepoint остаётся
    # зелёным (проверено красной пробой). Держится доводом, не пробой.
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
        audit_service.record(
            actor=actor,
            action=audit_service.STATUS_CREATED,
            entity_type=audit_service.ENTITY_STATUS,
            entity_id=status.pk,
            new_value=audit_service.status_snapshot(status),
            # Причина обхода — часть рассказа о создании: строка записана
            # ПОВЕРХ предупреждения, и через год это единственный след того,
            # почему пересечение сочли допустимым.
            reason=override_reason if (override and bypassed_conflicts) else "",
        )
        # В ТОМ ЖЕ savepoint, что и сама строка: поправка обязана лечь одним
        # коммитом с правкой, иначе между ними существует момент, в котором
        # сданный день уже не соответствует данным, а объяснения ещё нет.
        enforce_amendment_on_retro_edit(
            employee_id,
            [(date_start, date_end)],
            actor=actor,
            reason=amendment_reason,
            triggered_by_status_id=status.pk,
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
    amendment_reason="",
):
    """Правка оператором своей строки: интервал и метаданные.

    Переходы жизненного цикла (отмена/досрочное закрытие/продление) сюда НЕ
    входят: отмена — cancel_status, досрочное закрытие —
    complete_status_early, продление — extend_status. Тип статуса и
    сотрудник не меняются — это другая строка, а не правка этой.

    Интервал перепроверяется ТОЛЬКО когда реально меняется дата: правка
    комментария не должна упираться в интервал, ставший «невалидным» уже
    после создания (тип деактивировали, границы найма или предел
    длительности ужесточили). Блокировка и гарды при этом отрабатывают на
    любой правке.

    Возвращает перечитанную под блокировкой строку — переданный объект НЕ
    мутируется (он мог быть устаревшим; его состояние не источник правды).
    Так же ведёт себя cancel_status.

    Поправка сданного требуется только при СМЕНЕ ДАТ — тем же доводом, что и
    перепроверка интервала: комментарий и основание расхода не меняют, и
    вытеснять сданное заявление из-за них было бы поправкой ни о чём.
    Затронуты ОБА интервала, старый и новый: правка снимает статус с одних
    дней и ставит на другие, и заявление неверно у тех и у других.
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

    # Снимок «до» снимается ДО первого setattr: после него locked уже несёт
    # новые значения, и «до» с «после» стали бы одинаковыми.
    before = audit_service.status_snapshot(locked)
    old_interval = (locked.date_start, locked.date_end)

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
            audit_service.record(
                actor=actor,
                action=audit_service.STATUS_UPDATED,
                entity_type=audit_service.ENTITY_STATUS,
                entity_id=locked.pk,
                old_value=before,
                new_value=audit_service.status_snapshot(locked),
            )
            new_interval = (locked.date_start, locked.date_end)
            if new_interval != old_interval:
                enforce_amendment_on_retro_edit(
                    locked.employee_id,
                    [old_interval, new_interval],
                    actor=actor,
                    reason=amendment_reason,
                    triggered_by_status_id=locked.pk,
                )
    # Правка, ничего не изменившая (PATCH без полей), события НЕ пишет:
    # журнал рассказывает о случившемся, а «до» и «после» тут совпадают —
    # такая строка засоряла бы ленту событием без содержания.
    return locked


# Ноги пары прикомандирования: их закрытие не должно упираться в гард
# откомандированного (строка ограничивает — и заблокировала бы сама себя).
_SECONDMENT_LEG_CODES = ("DETACHED", "ATTACHED")


@transaction.atomic
def complete_status_early(status, *, actor, actual_end, amendment_reason=""):
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
    before = audit_service.status_snapshot(locked)
    # Освобождаются дни [фактический конец, прежний конец) — только они и
    # меняют расход; дни до фактического конца статус как нёс, так и несёт.
    released = (actual_end, locked.date_end)
    locked.date_end = actual_end
    # update_fields, а не голый save(): голый переписал бы source и
    # генерируемый period чужими значениями.
    locked.save(update_fields=["date_end", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.STATUS_COMPLETED,
        entity_type=audit_service.ENTITY_STATUS,
        entity_id=locked.pk,
        old_value=before,
        new_value=audit_service.status_snapshot(locked),
    )
    enforce_amendment_on_retro_edit(
        locked.employee_id,
        [released],
        actor=actor,
        reason=amendment_reason,
        triggered_by_status_id=locked.pk,
    )
    return locked


@transaction.atomic
def extend_status(
    status,
    *,
    actor,
    new_date_end,
    override=False,
    override_reason="",
    amendment_reason="",
):
    """Продлить статус строго более поздней датой конца.

    Продление — ОТДЕЛЬНАЯ операция, а не частный случай правки: оно
    монотонно (укорачивание — это досрочное завершение,
    complete_status_early) и рассказывает в журнале свою историю
    (STATUS_EXTENDED). Дата, не превышающая нынешнюю, — 422: «продление»,
    которое ничего не продлевает, это либо укорачивание чужим путём, либо
    ошибка вызывающего.

    Продлевается любая НЕ отменённая строка, в том числе уже завершённая
    (отпуск, который на деле длился дольше): полуинтервал просто съезжает
    вправо, факты остаются своими. Отменённую отсекает раньше общий гард
    _lock_for_edit — здешних проверок жизненного цикла на неё не нужно.

    Новый интервал перепроверяется целиком (границы найма, предел
    длительности типа) и заново прогоняется через детект конфликтов с
    исключением себя. Мягкий (409) обходится override=True + непустой
    причиной с записью StatusOverride в ТОМ ЖЕ savepoint, что и сама
    правка; жёсткий (422) не обходится никогда.

    ОТЛИЧИЯ ОТ ИСТОЧНИКА:
    1. Гард отменённой строки снят — его владелец один, _lock_for_edit
       (в источнике он продублирован здесь через state_on).
    2. Добавлен гард откомандированного (в источнике его у extend нет):
       продление — такая же операторская правка чужой строки, что и
       update_status, и на откомандированного оно распространяется по
       тому же доводу. Ноги пары продлевает не этот путь (возврат пишет
       свою дату сам, см. secondment_service).
    3. Порог сравнивается со СВЕЖЕЙ строкой под блокировкой, а не с
       переданным объектом: устаревшая копия объявила бы продлением
       откат уже записанного продления.
    4. Отдельного события OVERRIDE_APPLIED нет — причина обхода едет
       полем reason самого STATUS_EXTENDED, как и у create_status.
    """
    _require_actor(actor)
    employee, locked = _lock_for_edit(status)
    assert_employee_status_editable(locked.employee_id)
    # Причина обхода проверяется ДО (более дорогого) детекта конфликтов —
    # тот же порядок, что и у create_status.
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="При override обязательна непустая причина.",
        )
    if new_date_end <= locked.date_end:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={
                "new_date_end": str(new_date_end),
                "date_end": str(locked.date_end),
            },
            message="Продление требует более поздней даты конца.",
        )
    status_type = _resolve_status_type(locked.status_type_code)
    _validate_interval(
        date_start=locked.date_start,
        date_end=new_date_end,
        employee=employee,
        status_type=status_type,
    )
    bypassed_conflicts = _assert_no_conflict(
        employee_id=locked.employee_id,
        status_type_code=locked.status_type_code,
        date_start=locked.date_start,
        date_end=new_date_end,
        exclude_pk=locked.pk,
        override=override,
    )

    before = audit_service.status_snapshot(locked)
    # Добавляются дни [прежний конец, новый конец) — прежние дни статус нёс и
    # раньше, и их заявление продлением не изменилось.
    added = (locked.date_end, new_date_end)
    locked.date_end = new_date_end
    # Savepoint вокруг гоночной записи: продление может упереться в
    # excl_hard_status_overlap, и IntegrityError не должен отравлять
    # транзакцию вызывающего. Обход и событие — в том же savepoint.
    with transaction.atomic():
        locked.save(update_fields=["date_end", "updated_at"])
        if override and bypassed_conflicts:
            StatusOverride.objects.create(
                status=locked,
                employee_id=locked.employee_id,
                status_type_code=locked.status_type_code,
                reason=override_reason,
                conflicts=_conflict_details(bypassed_conflicts),
                created_by=actor,
            )
        audit_service.record(
            actor=actor,
            action=audit_service.STATUS_EXTENDED,
            entity_type=audit_service.ENTITY_STATUS,
            entity_id=locked.pk,
            old_value=before,
            new_value=audit_service.status_snapshot(locked),
            reason=override_reason if (override and bypassed_conflicts) else "",
        )
        enforce_amendment_on_retro_edit(
            locked.employee_id,
            [added],
            actor=actor,
            reason=amendment_reason,
            triggered_by_status_id=locked.pk,
        )
    return locked


@transaction.atomic
def cancel_status(status, *, actor, reason, amend=True):
    """Отменить не начавшийся (PLANNED) статус — факты отмены append-once.

    Отменяется только PLANNED: начавшийся или завершённый статус — факт,
    который случился (его закрывают раньше срока, а не отменяют). Отменённую
    строку отсекает раньше общий гард в _lock_for_edit, поэтому здешняя
    проверка владеет ровно ACTIVE/COMPLETED. cancelled_at/by/reason пишутся
    один раз и на уровне сервиса не переписываются.

    Отдельного `amendment_reason` здесь НЕТ: причина отмены обязательна и так,
    и она же объясняет поправку сданного дня. Второе поле «причина» на одном
    вызове означало бы, что у отмены бывают две разные правды.

    `amend=False` отдаёт поправку ВЫЗЫВАЮЩЕМУ и нужен оркестраторам, которые
    закрывают несколько строк одним актом (возврат из прикомандирования
    закрывает обе ноги пары). Владелец поправки — ОПЕРАЦИЯ, а не строка: у
    одного акта одна поправка, иначе день получил бы версии 2 и 3 за одно
    решение, и читатель истории увидел бы два возврата вместо одного.
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
    before = audit_service.status_snapshot(locked)
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
    audit_service.record(
        actor=actor,
        action=audit_service.STATUS_CANCELLED,
        entity_type=audit_service.ENTITY_STATUS,
        entity_id=locked.pk,
        old_value=before,
        new_value=audit_service.status_snapshot(locked),
        reason=reason,
    )
    # Отменённая строка перестаёт быть фактом на ВСЁМ своём интервале —
    # отсюда и затронутые дни. Отменяется только не начавшийся статус, но
    # «не начавшийся» не значит «не сданный»: день на завтра сдают штатно.
    if amend:
        enforce_amendment_on_retro_edit(
            locked.employee_id,
            [(locked.date_start, locked.date_end)],
            actor=actor,
            reason=reason,
            triggered_by_status_id=locked.pk,
        )
    return locked


@transaction.atomic
def resolve_placeholder(
    placeholder,
    *,
    resolved_type_code,
    date_start,
    date_end,
    actor,
    reason,
    override=False,
    override_reason="",
):
    """Разрешить строку-ЗАГЛУШКУ («уточняется») реальным статусом.

    Заглушка означает не факт, а его отсутствие: обстановка на день была
    неизвестна, и в расход человек попал колонкой «уточняется». Когда правда
    выясняется, заглушку НЕ правят — её закрывают и на её место кладут
    реальный статус. Правка превратила бы «мы не знали» в «мы знали и
    ошиблись», и след того, что день был неясен, исчез бы.

    Операция ЕДИНАЯ: закрытие и создание идут одной транзакцией и одним
    событием журнала. Разложенная на «отменил» плюс «создал», она читалась бы
    как два несвязанных решения оператора, а не как разрешение неясности.

    ПРИЧИНА (санкция) ОБЯЗАТЕЛЬНА ВСЕГДА — в отличие от обычной правки, где
    она требуется, только если задет сданный день. Разрешение заглушки по
    определению утверждает правду задним числом, и утверждение без основания
    здесь не бывает; она же уходит в cancelled_reason закрытой строки и
    санкцией в поправку сданного.

    ЗАГЛУШКУ ЗАДАЁТ СПРАВОЧНИК (is_placeholder), а не литерал в коде: в
    источнике код «уточняется» прибит константой, здесь словарь типов заводит
    администратор, и сервис, знающий одно имя наизусть, не признал бы
    заведённую заглушку. Разрешение обязано давать РЕАЛЬНЫЙ статус: заглушка
    вместо заглушки не разрешает ничего, только обнуляет след.

    Интервал разрешения СВОЙ и не обязан совпадать с интервалом заглушки:
    выяснилось может и то, что наряд был короче. Он проверяется целиком и
    прогоняется через детект конфликтов с исключением самой заглушки — иначе
    она конфликтовала бы с собственной заменой.

    Отказы: 400 (пустой актор, причина или причина обхода), 404 (строки нет),
    422 (не заглушка, разрешение в заглушку, отменённая строка, интервал,
    жёсткое пересечение), 409 (мягкое пересечение без обхода).
    """
    _require_actor(actor)
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="При разрешении заглушки обязательна непустая причина.",
        )
    # Причина обхода — до более дорогих проверок, тот же порядок, что всюду.
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="При override обязательна непустая причина.",
        )
    employee, locked = _lock_for_edit(placeholder)
    assert_employee_status_editable(locked.employee_id)
    # Гарда «уже отменённая» здесь НЕТ: её единственный владелец —
    # _lock_for_edit, и повторное разрешение упирается в него же.
    if not _resolve_status_type(locked.status_type_code).is_placeholder:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"status_type_code": locked.status_type_code},
            message="Ретро-заменой разрешается только строка-заглушка.",
        )
    resolved_type = _resolve_status_type(resolved_type_code)
    if resolved_type.is_placeholder:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"resolved_type_code": resolved_type_code},
            message="Разрешение должно давать реальный статус, а не заглушку.",
        )
    _validate_interval(
        date_start=date_start,
        date_end=date_end,
        employee=employee,
        status_type=resolved_type,
    )
    # Заглушку исключаем из периметра: без этого она пересекалась бы с
    # собственной заменой и разрешение было бы невозможно в принципе.
    bypassed_conflicts = _assert_no_conflict(
        employee_id=locked.employee_id,
        status_type_code=resolved_type_code,
        date_start=date_start,
        date_end=date_end,
        exclude_pk=locked.pk,
        override=override,
    )

    before = audit_service.status_snapshot(locked)
    locked.cancelled_at = Clock.now()
    locked.cancelled_by = actor
    locked.cancelled_reason = reason
    resolved = OpsEmployeeStatus(
        employee_id=locked.employee_id,
        status_type_code=resolved_type_code,
        date_start=date_start,
        date_end=date_end,
        source=OpsEmployeeStatus.Source.USER,
        created_by=actor,
    )
    # Savepoint вокруг гоночной записи: замена может упереться в
    # excl_hard_status_overlap, и IntegrityError не должен отравлять
    # транзакцию вызывающего. Закрытие, вставка, обход и событие — вместе:
    # разрешение либо состоялось целиком, либо не состоялось.
    with transaction.atomic():
        locked.save(
            update_fields=[
                "cancelled_at",
                "cancelled_by",
                "cancelled_reason",
                "updated_at",
            ]
        )
        resolved.save()
        if override and bypassed_conflicts:
            StatusOverride.objects.create(
                status=resolved,
                employee_id=locked.employee_id,
                status_type_code=resolved_type_code,
                reason=override_reason,
                conflicts=_conflict_details(bypassed_conflicts),
                created_by=actor,
            )
        audit_service.record(
            actor=actor,
            action=audit_service.STATUS_CLARIFICATION_RESOLVED,
            entity_type=audit_service.ENTITY_STATUS,
            # Лента ведётся по ЗАГЛУШКЕ: именно её судьбу ищет тот, кто
            # разбирает, чем кончилась неясность. У созданной строки своя
            # история начинается этим же событием через old/new.
            entity_id=locked.pk,
            old_value=before,
            new_value=audit_service.status_snapshot(resolved),
            reason=reason,
        )
        # Затронуты ОБА интервала: заглушка перестала накрывать свои дни, а
        # разрешение накрыло свои. Совпадать они не обязаны.
        enforce_amendment_on_retro_edit(
            locked.employee_id,
            [(locked.date_start, locked.date_end), (date_start, date_end)],
            actor=actor,
            reason=reason,
            triggered_by_status_id=resolved.pk,
        )
    return resolved
