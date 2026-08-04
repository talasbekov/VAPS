"""Прикомандирование: связанная пара DETACHED + ATTACHED и возврат из неё
(порт apps/operations/statuses/services/secondment_service.py из
Backend/VAPS).

Обе ноги и связь между ними пишутся ОДНОЙ транзакцией: пара либо есть
целиком, либо её нет вовсе. Полупара — это сотрудник, который нигде не
числится (или числится дважды), и разбирать такое состояние потом некому.

Переиспользует валидационный хребет создания статуса (_lock_employee /
_validate_interval / _assert_no_conflict), а не зовёт create_status дважды:
create_status — операция оператора со своим гардом откомандированного, и
второй вызов отказал бы сам себе на только что записанной первой ноге.

Возврат — рукопожатие из двух append-once фактов: штатное подразделение
запрашивает, принимающее подтверждает, и подтверждение закрывает обе ноги.
Хранимого признака «вернулся» нет: состояние сотрудника после возврата
выводится из статусов.

НЕ портировано (отдельными кусками): проекция «+N» в расход — как и в
источнике, где она отложена.

Журнал раздела ведётся по общему правилу покрытия (audit_service): событие на
каждую записанную СТРОКУ. Откомандирование пишет три (обе ноги и пару),
возврат — тоже три (закрытие каждой ноги и саму пару). Одной строки «на
операцию» мало: у ног пары тогда была бы пустая лента, хотя это обычные
статусы, которые видно в расходе и в карточке сотрудника.

Отличия от источника:
- штатное подразделение берётся из ШТАТНОЙ ЕДИНИЦЫ (у старого Employee своего
  division_id нет); сотрудник без слота откомандировать нельзя — «откуда»
  неизвестно, а выдумывать источник пары нельзя;
- принимающее подразделение проверяется через общий селектор дерева;
- возврат вступает в силу СО СЛЕДУЮЩЕГО дня, а не закрывает ноги сегодняшним
  числом (см. confirm_return): сданный расход за сегодня не переписывается.
"""
from datetime import timedelta

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector,
    StaffUnitSelector,
)
from organization_management.apps.operations.status_service import (
    _assert_no_conflict,
    _lock_employee,
    _require_actor,
    _resolve_status_type,
    _lock_for_edit,
    _validate_interval,
    assert_employee_status_editable,
    cancel_status,
)

DETACHED_CODE = "DETACHED"
ATTACHED_CODE = "ATTACHED"


@transaction.atomic
def initiate_secondment(
    employee_id,
    *,
    to_division_id,
    date_start,
    date_end,
    actor,
    document_basis="",
):
    """Откомандировать сотрудника: создать связанную пару DETACHED+ATTACHED.

    Возвращает Secondment. При любом отказе не записывается НИЧЕГО: пустой
    актор → 400; принимающее равно штатному → 400; принимающего нет → 404;
    сотрудника нет → 404; сотрудник уже откомандирован → 403; у сотрудника
    нет штатной единицы → 422; интервал или границы найма → 422; жёсткое
    пересечение → 422, мягкое → 409 (обхода у пары нет: откомандирование —
    не та операция, которую продавливают поверх предупреждения).
    """
    _require_actor(actor)
    employee = _lock_employee(employee_id)
    # Гард FR-16 до всего остального: уже откомандированного нельзя
    # откомандировать повторно, и это отказ права, а не формы.
    assert_employee_status_editable(employee_id)

    from_division_id = StaffUnitSelector.divisions_of([employee_id]).get(employee_id)
    if from_division_id is None:
        raise DomainError(
            "VALIDATION_ERROR",
            422,
            detail={"employee_id": str(employee_id)},
            message="У сотрудника нет штатной единицы — штатное подразделение "
            "неизвестно.",
        )
    if to_division_id == from_division_id:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"to_division_id": str(to_division_id)},
            message="Нельзя откомандировать в то же подразделение.",
        )
    if to_division_id not in DivisionTreeSelector.names_map([to_division_id]):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"to_division_id": str(to_division_id)},
            message="Принимающее подразделение не найдено.",
        )

    detached_type = _resolve_status_type(DETACHED_CODE)
    attached_type = _resolve_status_type(ATTACHED_CODE)
    # Интервал проверяется ОБОИМИ типами: предельная длительность — свойство
    # типа, и у ног она может быть разной.
    for status_type in (detached_type, attached_type):
        _validate_interval(
            date_start=date_start,
            date_end=date_end,
            employee=employee,
            status_type=status_type,
        )
    # Пересечение с ПРОЧИМИ живыми статусами сотрудника проверяется один раз
    # по ноге DETACHED: для любого стороннего типа обе ноги матрица
    # классифицирует одинаково, поэтому вторая проверка была бы той же самой.
    _assert_no_conflict(
        employee_id=employee_id,
        status_type_code=DETACHED_CODE,
        date_start=date_start,
        date_end=date_end,
    )

    # Транзакция у пары ОДНА — декоратор функции. Вложенного savepoint вокруг
    # вставок здесь нет намеренно: он не добавил бы ни отката (внешняя
    # транзакция откатывает всё), ни защиты вызывающему (ловить IntegrityError
    # и продолжать в этой транзакции всё равно некому), зато сделал бы пробу
    # атомарности зелёной при снятом декораторе — то есть замок без владельца.
    out_status = OpsEmployeeStatus.objects.create(
        employee_id=employee_id,
        status_type_code=DETACHED_CODE,
        date_start=date_start,
        date_end=date_end,
        source=OpsEmployeeStatus.Source.USER,
        document_basis=document_basis,
        created_by=actor,
    )
    # Вторая нога проверяется, КОГДА первая уже записана: детектор видит
    # DETACHED и обязан признать пару совместимой. Это несущая проверка — без
    # объявленной совместимости здесь возник бы ложный 409 на ровном месте.
    _assert_no_conflict(
        employee_id=employee_id,
        status_type_code=ATTACHED_CODE,
        date_start=date_start,
        date_end=date_end,
    )
    in_status = OpsEmployeeStatus.objects.create(
        employee_id=employee_id,
        status_type_code=ATTACHED_CODE,
        date_start=date_start,
        date_end=date_end,
        source=OpsEmployeeStatus.Source.USER,
        document_basis=document_basis,
        created_by=actor,
    )
    secondment = Secondment.objects.create(
        employee_id=employee_id,
        out_status=out_status,
        in_status=in_status,
        from_division_id=from_division_id,
        to_division_id=to_division_id,
        document_basis=document_basis,
        created_by=actor,
    )
    # Ноги пишутся как обычные созданные статусы: они и есть обычные статусы,
    # просто созданные не оператором поштучно, а этой операцией.
    for leg in (out_status, in_status):
        audit_service.record(
            actor=actor,
            action=audit_service.STATUS_CREATED,
            entity_type=audit_service.ENTITY_STATUS,
            entity_id=leg.pk,
            new_value=audit_service.status_snapshot(leg),
        )
    audit_service.record(
        actor=actor,
        action=audit_service.SECONDMENT_INITIATED,
        entity_type=audit_service.ENTITY_SECONDMENT,
        entity_id=secondment.pk,
        new_value=audit_service.secondment_snapshot(secondment),
    )
    return secondment


def _lock_secondment(secondment):
    """Связь под блокировкой и ПЕРЕЧИТАННАЯ: факты возврата append-once.

    Второй писатель, пришедший со своим устаревшим объектом (факты пустые),
    после блокировки видит канонические факты первого и получает отказ, а не
    переписывает их. Порядок захвата тот же, что всюду в разделе: сотрудник,
    затем строка — иначе два оператора встали бы во взаимную блокировку.
    """
    _lock_employee(secondment.employee_id)
    locked = (
        Secondment.objects.select_for_update().filter(pk=secondment.pk).first()
    )
    if locked is None:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"secondment_id": secondment.pk},
            message="Прикомандирование не найдено.",
        )
    return locked


def _end_leg_tomorrow(leg, *, actor, today):
    """Закрыть идущую ногу завтрашним днём — окончание её действия.

    Своя запись, а НЕ complete_status_early: то — фиксация факта, и её гард
    «факт не бывает в будущем» здесь сработал бы против правила «возврат
    вступает в силу со следующего дня». И не update_status: его гард
    откомандированного заблокировал бы снятие самой ограничивающей строки, а
    ослаблять операторский путь правки ради внутренней нужды нельзя — ноги
    правятся через возврат, не PATCH'ем.

    Блокировка, перечитка и гарды (строка проекции, отменённая терминальна)
    приходят из общей преамбулы правки. Идущая нога заканчивается позже
    сегодняшнего дня, поэтому запись здесь всегда СОКРАЩАЕТ интервал.
    """
    _require_actor(actor)
    _, locked = _lock_for_edit(leg)
    before = audit_service.status_snapshot(locked)
    locked.date_end = today + timedelta(days=1)
    # update_fields, а не голый save(): голый переписал бы source и
    # генерируемый period чужими значениями.
    locked.save(update_fields=["date_end", "updated_at"])
    # STATUS_COMPLETED, а не STATUS_UPDATED: нога не «поправлена», а закрыта —
    # это конец её действия. Пишется ЗДЕСЬ, у самой записи, чтобы у ноги,
    # закрытой возвратом, лента была такой же непустой, как у ноги отменённой
    # (её событие пишет cancel_status).
    audit_service.record(
        actor=actor,
        action=audit_service.STATUS_COMPLETED,
        entity_type=audit_service.ENTITY_STATUS,
        entity_id=locked.pk,
        old_value=before,
        new_value=audit_service.status_snapshot(locked),
    )
    return locked


@transaction.atomic
def request_return(secondment, *, actor):
    """Шаг 1: штатное подразделение запрашивает возврат — факт append-once.

    Повторный запрос или запрос по уже подтверждённому возврату — 422:
    рукопожатие не начинают заново, иначе первый запросивший стирается из
    следа. Кто вправе запрашивать (штатный оператор) — вопрос гейта на
    границе HTTP, здесь actor это просто строка.
    """
    _require_actor(actor)
    locked = _lock_secondment(secondment)
    if (
        locked.return_requested_at is not None
        or locked.return_confirmed_at is not None
    ):
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": locked.pk},
            message="Возврат уже запрошен или подтверждён.",
        )
    before = audit_service.secondment_snapshot(locked)
    locked.return_requested_at = Clock.now()
    locked.return_requested_by = actor
    locked.save(
        update_fields=["return_requested_at", "return_requested_by", "updated_at"]
    )
    audit_service.record(
        actor=actor,
        action=audit_service.SECONDMENT_RETURN_REQUESTED,
        entity_type=audit_service.ENTITY_SECONDMENT,
        entity_id=locked.pk,
        old_value=before,
        new_value=audit_service.secondment_snapshot(locked),
    )
    return locked


@transaction.atomic
def confirm_return(secondment, *, actor, reason=""):
    """Шаг 2: принимающее подразделение подтверждает — закрывает ОБЕ ноги.

    Подтверждение без запроса — 422 (рукопожатие одностороннее не бывает),
    повторное подтверждение — 422. Каждая нога закрывается по своему
    состоянию: идущая — досрочно сегодняшним числом, не начавшаяся —
    отменяется (её не было), уже закрытая пропускается. Признака «вернулся»
    не пишется: состояние сотрудника после возврата выводится из статусов.

    Возврат вступает в силу СО СЛЕДУЮЩЕГО дня: сегодня сотрудник ещё числится
    прикомандированным, с завтрашнего — дома. Два довода против «закрыть
    сегодняшним числом» (так делает источник): расход за сегодня уже сдан с
    прикомандированным — закрытие задним числом переписало бы сданный день; и
    полуинтервал не умеет пустых фактов, поэтому ногу, начавшуюся сегодня,
    сегодняшним числом закрыть нельзя вовсе. Одна дата для обоих случаев —
    одно правило, а не два поведения в зависимости от даты начала.
    """
    _require_actor(actor)
    locked = _lock_secondment(secondment)
    if locked.return_requested_at is None:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": locked.pk},
            message="Нельзя подтвердить возврат без запроса.",
        )
    if locked.return_confirmed_at is not None:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            detail={"secondment_id": locked.pk},
            message="Возврат уже подтверждён.",
        )
    today = Clock.today_local()
    for leg in (locked.out_status, locked.in_status):
        state = leg.state_on(today)
        if state == OpsEmployeeStatus.LifecycleState.ACTIVE:
            _end_leg_tomorrow(leg, actor=actor, today=today)
        elif state == OpsEmployeeStatus.LifecycleState.PLANNED:
            cancel_status(
                leg, actor=actor, reason=reason or "возврат из прикомандирования"
            )
        # Завершённая или отменённая нога уже закрыта — закрывать нечего.
    before = audit_service.secondment_snapshot(locked)
    locked.return_confirmed_at = Clock.now()
    locked.return_confirmed_by = actor
    locked.save(
        update_fields=["return_confirmed_at", "return_confirmed_by", "updated_at"]
    )
    # События самих ног пишут закрывшие их вызовы выше (_end_leg_tomorrow и
    # cancel_status) — здесь только событие ПАРЫ. Дублировать их тут значило
    # бы записать закрытие ноги дважды разными словами.
    audit_service.record(
        actor=actor,
        action=audit_service.SECONDMENT_RETURNED,
        entity_type=audit_service.ENTITY_SECONDMENT,
        entity_id=locked.pk,
        old_value=before,
        new_value=audit_service.secondment_snapshot(locked),
        reason=reason,
    )
    return locked
