"""Откомандирование: связанная пара DETACHED + ATTACHED (порт
apps/operations/statuses/services/secondment_service.py из Backend/VAPS,
часть «инициация»).

Обе ноги и связь между ними пишутся ОДНОЙ транзакцией: пара либо есть
целиком, либо её нет вовсе. Полупара — это сотрудник, который нигде не
числится (или числится дважды), и разбирать такое состояние потом некому.

Переиспользует валидационный хребет создания статуса (_lock_employee /
_validate_interval / _assert_no_conflict), а не зовёт create_status дважды:
create_status — операция оператора со своим гардом откомандированного, и
второй вызов отказал бы сам себе на только что записанной первой ноге.

НЕ портировано в этом срезе (отдельными кусками): возврат из
прикомандирования (запрос/подтверждение) и проекция «+N» в расход — как и в
источнике, где она отложена. Аудит раздела здесь не зовётся, как и во всех
срезах переезда.

Отличия от источника:
- штатное подразделение берётся из ШТАТНОЙ ЕДИНИЦЫ (у старого Employee своего
  division_id нет); сотрудник без слота откомандировать нельзя — «откуда»
  неизвестно, а выдумывать источник пары нельзя;
- принимающее подразделение проверяется через общий селектор дерева.
"""
from django.db import transaction

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
    _validate_interval,
    assert_employee_status_editable,
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
    return Secondment.objects.create(
        employee_id=employee_id,
        out_status=out_status,
        in_status=in_status,
        from_division_id=from_division_id,
        to_division_id=to_division_id,
        document_basis=document_basis,
        created_by=actor,
    )
