"""Увольнение: закрытие статусов и пар раздела ОМ (порт ops-части
apps/operations/statuses/services/dismissal.py из Backend/VAPS).

Портирована ТОЛЬКО сторона раздела. Само увольнение (карточка, штат, слот)
живёт в старом проекте и здесь не трогается: раздел ОМ приводит в порядок
СВОИ факты, узнав дату увольнения, а не переписывает чужую бизнес-логику.
Вызов из старого пути увольнения — отдельное решение и отдельный срез; пока
эта функция вызывается явно (командой, эндпоинтом или переносом данных).

Журнал раздела ведётся по общему правилу покрытия (audit_service): событие на
каждую закрытую строку плюс одно EMPLOYEE_DISMISSED со сводкой. Актор здесь
как правило системный (метка сигнала), и построчные события — единственное,
что потом объяснит, почему у сотрудника разом оборвались отпуск и наряд.

Сданные дни, которых коснулось закрытие, ВЫТЕСНЯЮТСЯ поправкой — тем же
правилом, что и операторская правка (amendment_enforcement). Разница в том,
откуда берётся объяснение: у оператора причину знает только он и её приходится
спрашивать, а здесь событие известно целиком — увольнение с датой, — и санкция
ВЫВОДИТСЯ из него. Спрашивать причину у системного пути было бы некого, а
пропустить поправку значило бы оставить сданный день заявлять человека,
которого в нём уже нет.

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

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.amendment_enforcement import (
    enforce_amendment_on_retro_edit,
)
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
# Санкция поправки: то же событие, но фразой, которую читает разбирающий
# историю ДНЯ, а не историю сотрудника — ему нужна дата, иначе поправка не
# отличима от такой же за прошлый месяц.
DISMISSAL_SANCTION = "Увольнение сотрудника {date:%d.%m.%Y}."


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
    # Дни, чьё заявление закрытие изменило. У отменённой строки это весь её
    # период, у усечённой — только отрезанный хвост [D, прежний конец):
    # дни до даты увольнения статус нёс и несёт, и поправлять их значило бы
    # вытеснять заявление, которое не менялось.
    affected = []
    # ОДИН проход под ОДНОЙ блокировкой: живые строки сотрудника берутся
    # целиком, а что с каждой делать — решает её интервал. Два прохода двумя
    # выборками брали бы блокировку на ту же таблицу дважды, и проба «строки
    # заблокированы» зеленела бы от второй, даже если первая её потеряла.
    for status_row in OpsEmployeeStatus.objects.select_for_update().filter(
        employee_id=employee_id, cancelled_at__isnull=True
    ):
        before = audit_service.status_snapshot(status_row)
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
            affected.append((status_row.date_start, status_row.date_end))
            action = audit_service.STATUS_CANCELLED
        elif status_row.date_end > dismissal_date:
            affected.append((dismissal_date, status_row.date_end))
            status_row.date_end = dismissal_date
            # update_fields, а не голый save(): голый переписал бы source и
            # генерируемый period чужими значениями.
            status_row.save(update_fields=["date_end", "updated_at"])
            truncated += 1
            # STATUS_UPDATED, а не STATUS_COMPLETED: строка не закрыта фактом
            # своего окончания, у неё обрезан хвост по чужой причине. Причина
            # и лежит в reason — иначе усечение читалось бы как обычная правка
            # оператора.
            action = audit_service.STATUS_UPDATED
        else:
            # Строка, закончившаяся до D, — факт, который случился: не трогаем
            # и события не пишем, писать не о чем.
            continue
        audit_service.record(
            actor=actor,
            action=action,
            entity_type=audit_service.ENTITY_STATUS,
            entity_id=status_row.pk,
            old_value=before,
            new_value=audit_service.status_snapshot(status_row),
            reason=DISMISSAL_REASON,
        )

    secondments_closed = 0
    for secondment in Secondment.objects.select_for_update().filter(
        employee_id=employee_id, return_confirmed_at__isnull=True
    ):
        before = audit_service.secondment_snapshot(secondment)
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
        # SECONDMENT_RETURNED, потому что событие описывает СТРОКУ пары, а она
        # закрыта ровно тем же способом, что и при живом возврате. Отличие —
        # в reason: «увольнение», а не запрос с подтверждением от людей.
        audit_service.record(
            actor=actor,
            action=audit_service.SECONDMENT_RETURNED,
            entity_type=audit_service.ENTITY_SECONDMENT,
            entity_id=secondment.pk,
            old_value=before,
            new_value=audit_service.secondment_snapshot(secondment),
            reason=DISMISSAL_REASON,
        )

    summary = {
        "truncated": truncated,
        "cancelled": cancelled,
        "secondments_closed": secondments_closed,
    }
    # Событие сотрудника — СВЕРХ построчных: по нему видно, что обрыв статусов
    # был одной операцией, а не чередой отдельных решений. Пишется ВСЕГДА, в
    # том числе с нулевой сводкой: «увольнение случилось, закрывать было
    # нечего» — это тоже факт, и его отсутствие потом не отличить от
    # неотработавшей врезки.
    audit_service.record(
        actor=actor,
        action=audit_service.EMPLOYEE_DISMISSED,
        entity_type=audit_service.ENTITY_EMPLOYEE,
        entity_id=employee_id,
        new_value={"dismissal_date": str(dismissal_date), **summary},
        reason=DISMISSAL_REASON,
    )
    # После журнала и в той же транзакции: поправка ложится одним коммитом с
    # закрытием. Своей строки-виновника у увольнения нет — оно оборвало
    # сразу несколько, и pk любой из них был бы произвольным выбором.
    enforce_amendment_on_retro_edit(
        employee_id,
        affected,
        actor=actor,
        reason=DISMISSAL_SANCTION.format(date=dismissal_date),
    )
    return summary
