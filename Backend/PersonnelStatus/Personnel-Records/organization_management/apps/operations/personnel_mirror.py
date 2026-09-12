"""Проекция кадрового статуса в факт раздела ОМ (Plane №1209, 12.09.2026).

ЗАЧЕМ. Начальник управления ставит статусы в «Статусах сотрудников» — это
кадровая таблица `employee_statuses` (`apps.statuses`). Расход, снимок сдачи,
светофор и таблица ответственного читают ТОЛЬКО факты раздела
`ops_employee_statuses`, и кадровый статус туда не попадал вовсе: на стенде
12.09.2026 при 6192 кадровых строках в разделе жило 182 строки, все `USER`.
«Сдать день» со «Статусов» (№1197) сдавал не то, что начальник видел и правил —
кадровый больничный 08–18.09 в расходе на 13.09 читался как «в строю».
Заказчик (RAW/README §19.1): «ежедневный расход — это проставление статусов…
все статусы, которые есть».

ЧТО ДЕЛАЕТ. Каждой кадровой строке, у которой в каталоге раздела есть пара
(`StatusType.legacy_code`), соответствует не больше одной ЖИВОЙ строки
раздела с `source=PERSONNEL` и `source_ref=personnel:<pk>`. Расширение, а не
подмена: читатели раздела не меняются — они просто начинают видеть кадровые
факты; ручная правка проекции в разделе закрыта существующим гардом
`assert_user_editable` (правится кадровая строка, проекция идёт следом).

ПРАВИЛА.
- «В строю» в разделе — ОТСУТСТВИЕ факта, поэтому `in_service` (и любой тип
  без пары в каталоге) не проецируется; смена типа на такой — гасит проекцию.
- Раздел хранит полуинтервал `[date_start, date_end)`, кадровая `end_date`
  включительная → `date_end = end + 1`; досрочное завершение
  (`actual_end_date`) побеждает плановую дату. Без даты окончания (плановый без
  конца) проекции нет — выразить «до бесконечности» разделу нечем.
- `cancelled` и удаление кадровой строки → `cancelled_at` у проекции
  (append-once, как у раздела); `completed` остаётся живым фактом — он
  случился и обязан быть виден в расходе тех дней.
- Конфликт с ЖЁСТКИМ фактом раздела (GiST `excl_hard_status_overlap`,
  models_status.py) — проекция ПРОПУСКАЕТСЯ с записью в лог, кадровая запись не
  ломается: это фоновая проекция, а не запрос, и доменных ошибок она не
  поднимает (тот же договор, что у материализаторов catch_up).
- Поправки сданного дня проекция не требует: правка после сдачи даёт
  расхождение, которое индикатор уже показывает (`day_submission_service`),
  а пересдача остаётся поправкой начальника.

Функции принимают классы моделей параметрами: миграция бэкфилла зовёт их с
историческими моделями (`apps.get_model`), сигнал — с настоящими.
"""
import logging
from datetime import timedelta

from django.db import IntegrityError, transaction

logger = logging.getLogger(__name__)

SOURCE_REF_PREFIX = "personnel:"
#: Актор проекции: не число, чтобы не спутать со `str(User.pk)`.
SYSTEM_ACTOR = "system:personnel"
#: Кадровый код «В строю» — фон, а не факт.
IN_SERVICE_LEGACY = "in_service"
CANCEL_REASON = "Кадровый статус отменён или удалён"

OUTCOME_CREATED = "created"
OUTCOME_UPDATED = "updated"
OUTCOME_UNCHANGED = "unchanged"
OUTCOME_CANCELLED = "cancelled"
OUTCOME_SKIPPED = "skipped"
OUTCOME_CONFLICT = "conflict"


def source_ref_for(personnel_pk):
    return f"{SOURCE_REF_PREFIX}{personnel_pk}"


def projected_interval(status):
    """Полуинтервал раздела для кадровой строки либо None.

    Чистая функция: даты — единственное, что нужно знать, и на них
    держатся все пробы жизненного цикла.
    """
    start = status.start_date
    end = status.actual_end_date or status.end_date
    if start is None or end is None or end < start:
        return None
    return start, end + timedelta(days=1)


def _target_code(status, status_type_model):
    legacy = status.status_type
    if not legacy or legacy == IN_SERVICE_LEGACY:
        return None
    return (
        status_type_model.objects.filter(legacy_code=legacy, is_active=True)
        .exclude(code="IN_SERVICE")
        .values_list("code", flat=True)
        .first()
    )


def _models(ops_status_model, status_type_model):
    if ops_status_model is None:
        from organization_management.apps.operations.models_status import (
            OpsEmployeeStatus,
        )

        ops_status_model = OpsEmployeeStatus
    if status_type_model is None:
        from organization_management.apps.operations.status_types import StatusType

        status_type_model = StatusType
    return ops_status_model, status_type_model


def _now():
    # Часы раздела, а не настенные: момент отмены проекции обязан жить в том
    # же дне, что сдача и поправки (test_clock_discipline).
    from organization_management.apps.operations.clock import Clock

    return Clock.now()


def _cancel(row):
    row.cancelled_at = _now()
    row.cancelled_by = SYSTEM_ACTOR
    row.cancelled_reason = CANCEL_REASON
    row.save(update_fields=["cancelled_at", "cancelled_by", "cancelled_reason", "updated_at"])


def unmirror_personnel_status(personnel_pk, *, ops_status_model=None):
    """Погасить живую проекцию кадровой строки. Идемпотентно."""
    ops_status_model, _ = _models(ops_status_model, None)
    row = ops_status_model.objects.filter(
        source_ref=source_ref_for(personnel_pk), cancelled_at__isnull=True
    ).first()
    if row is None:
        return OUTCOME_SKIPPED
    _cancel(row)
    return OUTCOME_CANCELLED


def mirror_personnel_status(status, *, ops_status_model=None, status_type_model=None):
    """Привести проекцию кадровой строки в соответствие с ней.

    Возвращает исход (`created` / `updated` / `unchanged` / `cancelled` /
    `skipped` / `conflict`) — по нему бэкфилл считает, что сделал.
    """
    ops_status_model, status_type_model = _models(ops_status_model, status_type_model)
    ref = source_ref_for(status.pk)
    existing = ops_status_model.objects.filter(
        source_ref=ref, cancelled_at__isnull=True
    ).first()

    code = _target_code(status, status_type_model)
    interval = projected_interval(status)
    is_cancelled = getattr(status, "state", None) == "cancelled"
    if code is None or interval is None or is_cancelled or status.employee_id is None:
        if existing is None:
            return OUTCOME_SKIPPED
        _cancel(existing)
        return OUTCOME_CANCELLED

    date_start, date_end = interval
    if existing is not None:
        same = (
            existing.employee_id == status.employee_id
            and existing.status_type_code == code
            and existing.date_start == date_start
            and existing.date_end == date_end
        )
        if same:
            return OUTCOME_UNCHANGED
        existing.employee_id = status.employee_id
        existing.status_type_code = code
        existing.date_start = date_start
        existing.date_end = date_end
        try:
            # Savepoint: IntegrityError от GiST-ограничения не должен
            # уронить внешнюю транзакцию кадрового сохранения.
            with transaction.atomic():
                existing.save(
                    update_fields=[
                        "employee_id",
                        "status_type_code",
                        "date_start",
                        "date_end",
                        "updated_at",
                    ]
                )
        except IntegrityError:
            logger.warning(
                "Проекция кадрового статуса №%s не обновлена: конфликт с "
                "жёстким фактом раздела (%s %s–%s, сотрудник %s)",
                status.pk, code, date_start, date_end, status.employee_id,
            )
            return OUTCOME_CONFLICT
        return OUTCOME_UPDATED

    try:
        with transaction.atomic():
            ops_status_model.objects.create(
                employee_id=status.employee_id,
                status_type_code=code,
                date_start=date_start,
                date_end=date_end,
                source="PERSONNEL",
                source_ref=ref,
                comment="",
                document_basis=f"Кадровый статус №{status.pk}",
                created_by=SYSTEM_ACTOR,
            )
    except IntegrityError:
        logger.warning(
            "Проекция кадрового статуса №%s не создана: конфликт с жёстким "
            "фактом раздела (%s %s–%s, сотрудник %s)",
            status.pk, code, date_start, date_end, status.employee_id,
        )
        return OUTCOME_CONFLICT
    return OUTCOME_CREATED
