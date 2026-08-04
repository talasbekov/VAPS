"""Увольнение: закрытие статусов и пар раздела ОМ (порт ops-части
apps/operations/statuses/services/dismissal.py из Backend/VAPS).

Портирована ТОЛЬКО сторона раздела. Само увольнение (карточка, штат, слот)
живёт в старом проекте и здесь не трогается: раздел ОМ приводит в порядок
СВОИ факты, узнав дату увольнения, а не переписывает чужую бизнес-логику.
Вызов из старого пути увольнения — отдельное решение и отдельный срез; пока
эта функция вызывается явно (командой, эндпоинтом или переносом данных).

Аудит раздела здесь не зовётся, как и во всех срезах переезда.

Отличия от источника:
- отменяются ВСЕ ещё не начавшиеся живые статусы, а не только ноги пары
  прикомандирования: одно правило вместо двух, и уволенный не уносит с собой
  запланированные наряды и отпуска;
- системное закрытие пары ставит ОБА факта рукопожатия (запрос и
  подтверждение). В источнике пишется одно подтверждение, но здесь порядок
  «запрос → подтверждение» держит CHECK базы, и одинокое подтверждение просто
  не записалось бы.
"""
from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.status_service import (
    _lock_employee,
    _require_actor,
)

# Причина закрытия фактов: она попадает в cancelled_reason и должна читаться
# человеком, разбирающим историю сотрудника через год.
DISMISSAL_REASON = "увольнение сотрудника"


@transaction.atomic
def close_statuses_on_dismissal(employee_id, *, dismissal_date, actor):
    """Закрыть статусы и пары уволенного сотрудника на дату увольнения.

    Возвращает {truncated, cancelled, secondments_closed} — что именно
    произошло, а не голое «готово»: вызывающий обязан уметь показать это в
    ответе или в логе переноса.

    Правила:

    - статус, НАКРЫВАЮЩИЙ дату (date_start < D < date_end), усекается до D.
      Полуинтервал [начало, D) означает «действовал по D-1»: D — верхняя
      граница найма ровно в том же смысле, в каком её понимает проверка
      интервала при создании статуса (date_end > dismissal_date → отказ).
      Усечение только СОКРАЩАЕТ период, поэтому ограничение непересечения
      жёстких статусов заведомо не нарушится;
    - статус, ещё НЕ НАЧАВШИЙСЯ на дату (date_start >= D), усечь нельзя —
      интервал стал бы пустым. Он отменяется с причиной: у уволенного не
      остаётся запланированных нарядов;
    - незакрытая пара прикомандирования штампуется закрытой системно (без
      запроса и подтверждения живыми людьми): её ноги только что закрылись
      правилами выше, и пара не должна ссылаться на живой возврат.

    Факты append-once: уже отменённый статус и уже подтверждённая пара не
    переписываются. Повторный вызов ничего не меняет.
    """
    _require_actor(actor)
    # Порядок захвата тот же, что всюду в разделе: сотрудник, затем строки.
    _lock_employee(employee_id)
    now = Clock.now()

    truncated = cancelled = 0
    # ОДИН проход под ОДНОЙ блокировкой: живые строки сотрудника берутся
    # целиком, а что с каждой делать — решает её интервал. Два прохода двумя
    # выборками брали бы блокировку на ту же таблицу дважды, и проба «строки
    # заблокированы» зеленела бы от второй, даже если первая её потеряла.
    for status_row in OpsEmployeeStatus.objects.select_for_update().filter(
        employee_id=employee_id, cancelled_at__isnull=True
    ):
        if status_row.date_start >= dismissal_date:
            # Усечь до D нельзя — интервал стал бы пустым; такой статус не
            # начался, и его отменяют.
            status_row.cancelled_at = now
            status_row.cancelled_by = actor
            status_row.cancelled_reason = DISMISSAL_REASON
            status_row.save(
                update_fields=[
                    "cancelled_at",
                    "cancelled_by",
                    "cancelled_reason",
                    "updated_at",
                ]
            )
            cancelled += 1
        elif status_row.date_end > dismissal_date:
            status_row.date_end = dismissal_date
            # update_fields, а не голый save(): голый переписал бы source и
            # генерируемый period чужими значениями.
            status_row.save(update_fields=["date_end", "updated_at"])
            truncated += 1
        # Строка, закончившаяся до D, — факт, который случился: не трогаем.

    secondments_closed = 0
    for secondment in Secondment.objects.select_for_update().filter(
        employee_id=employee_id, return_confirmed_at__isnull=True
    ):
        fields = ["return_confirmed_at", "return_confirmed_by", "updated_at"]
        if secondment.return_requested_at is None:
            # Запроса не было — его ставит система: подтверждение без запроса
            # не примет CHECK базы, и такое рукопожатие было бы нечитаемым.
            secondment.return_requested_at = now
            secondment.return_requested_by = actor
            fields += ["return_requested_at", "return_requested_by"]
        secondment.return_confirmed_at = now
        secondment.return_confirmed_by = actor
        secondment.save(update_fields=fields)
        secondments_closed += 1

    return {
        "truncated": truncated,
        "cancelled": cancelled,
        "secondments_closed": secondments_closed,
    }
