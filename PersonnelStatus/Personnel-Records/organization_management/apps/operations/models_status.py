"""Статусы сотрудников раздела ОМ (порт EmployeeStatus из Backend/VAPS
apps/operations/statuses/models/employee_status.py).

ТАБЛИЦА РЯДОМ со старой employee_statuses (решение Bratan, 04.08.2026):
раздел ОМ пишет сюда, старые экраны продолжают жить на своей таблице; мост
словарей — StatusType.legacy_code. Перенос строк и гашение старой таблицы —
отдельный разговор.

Отличия от источника:
- employee_id — целое, плоская ссылка на employees.Employee старого проекта
  (в источнике UUID новой core-структуры). Без FK намеренно: контексты
  разделены, каскады старой структуры не должны утаскивать факты ОМ.
- cancelled_by/created_by несут str(User.pk) — как и весь RBAC переезда.

Требует PostgreSQL: ExclusionConstraint, GiST-индекс и генерируемая колонка
периода — те самые гарантии, ради которых стенд переведён на Postgres.
"""
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.contrib.postgres.indexes import GistIndex
from django.db import models
from django.db.models import Case, F, Func, Q, Value, When

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.conflict_matrix import (
    HARD_STATUS_TYPE_CODES,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import TimeStampedModel


class LifecycleState(models.TextChoices):
    """Выводимое состояние ОДНОЙ строки статуса (не победитель расхода)."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


def derive_state(date_start, date_end, cancelled_at, business_date):
    """Канон выводимого состояния — единственный источник правды и для
    @property, и для аннотации queryset (состояние не хранится).

    Полуинтервал [date_start, date_end), бизнес-дата через Clock (никогда не
    now()). CANCELLED — факт жизненного цикла, ортогональный датам, поэтому
    проверяется первым.
    """
    if cancelled_at is not None:
        return LifecycleState.CANCELLED
    if business_date < date_start:
        return LifecycleState.PLANNED
    if business_date < date_end:
        return LifecycleState.ACTIVE
    return LifecycleState.COMPLETED


class OpsEmployeeStatusQuerySet(models.QuerySet):
    def with_state(self, business_date=None):
        """Аннотация state_annotation (SQL Case/When), зеркалящая derive_state.

        Названа иначе, чем @property state: property — data descriptor и
        затенил бы одноимённую аннотацию.
        """
        if business_date is None:
            business_date = Clock.today_local()
        return self.annotate(
            state_annotation=Case(
                When(
                    cancelled_at__isnull=False,
                    then=Value(LifecycleState.CANCELLED.value),
                ),
                When(
                    date_start__gt=business_date,
                    then=Value(LifecycleState.PLANNED.value),
                ),
                When(
                    date_end__gt=business_date,
                    then=Value(LifecycleState.ACTIVE.value),
                ),
                default=Value(LifecycleState.COMPLETED.value),
                output_field=models.CharField(),
            )
        )


class OpsEmployeeStatus(TimeStampedModel):
    class Source(models.TextChoices):
        USER = "USER"  # создан оператором
        KU_SYNC = "KU_SYNC"  # синк из КУ (заглушка, КУ отложен)
        OM_AUTO = "OM_AUTO"  # принадлежит проекции дежурств/мероприятий

    # Плоская ссылка на сотрудника старой структуры, без FK.
    employee_id = models.IntegerField()
    # Код типа из справочника ops_status_types (валидируется сервисом).
    status_type_code = models.CharField(max_length=50)
    # Календарные дни, полуинтервал [date_start, date_end).
    date_start = models.DateField()
    date_end = models.DateField()
    # Факты отмены пишутся один раз и не переписываются на уровне сервиса.
    # cancelled_at также даёт состояние CANCELLED и выводит строку из
    # периметра конфликтов/ограничения.
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=255, null=True, blank=True)
    cancelled_reason = models.TextField(blank=True, default="")
    # Происхождение: проекция дежурств подключается через OM_AUTO/source_ref,
    # не вскрывая сервис.
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.USER
    )
    # Ключ владельца/идемпотентности для строк, написанных проекцией.
    source_ref = models.CharField(max_length=255, null=True, blank=True)
    comment = models.TextField(blank=True, default="")
    # Текстовое основание («Приказ №…»); файлы-вложения — отдельная тема.
    document_basis = models.CharField(max_length=255, blank=True, default="")
    period = models.GeneratedField(
        expression=Func(
            F("date_start"),
            F("date_end"),
            Value("[)"),
            function="daterange",
            output_field=DateRangeField(),
        ),
        output_field=DateRangeField(),
        db_persist=True,
    )

    objects = OpsEmployeeStatusQuerySet.as_manager()

    LifecycleState = LifecycleState

    def state_on(self, business_date):
        """Выводимое состояние на бизнес-дату (зеркало with_state)."""
        return derive_state(
            self.date_start, self.date_end, self.cancelled_at, business_date
        )

    @property
    def state(self):
        """Выводимое состояние на текущую бизнес-дату (Clock)."""
        return self.state_on(Clock.today_local())

    def assert_user_editable(self):
        """Гард: оператор правит только строки source=USER.

        Строки проекции (OM_AUTO/KU_SYNC) — 422: у проекции единственный
        писатель. Вне clean() намеренно: системное закрытие таких строк
        должно оставаться возможным.
        """
        if self.source != self.Source.USER:
            raise DomainError(
                "AUTO_STATUS_READONLY",
                422,
                detail={"source": self.source},
                message="Запись принадлежит проекции (source != USER); "
                "ручная правка запрещена.",
            )

    class Meta:
        db_table = "ops_employee_statuses"
        constraints = [
            models.CheckConstraint(
                condition=Q(date_start__lt=F("date_end")),
                name="chk_status_dates",
            ),
            # Неотменённые жёсткие статусы одного сотрудника не пересекаются;
            # IntegrityError отображается сервисом в 422
            # OVERLAPPING_HARD_STATUS по этому имени.
            ExclusionConstraint(
                name="excl_hard_status_overlap",
                expressions=[
                    (F("employee_id"), RangeOperators.EQUAL),
                    (F("period"), RangeOperators.OVERLAPS),
                ],
                condition=Q(status_type_code__in=HARD_STATUS_TYPE_CODES)
                & Q(cancelled_at__isnull=True),
            ),
        ]
        indexes = [
            # Полный (не частичный) GiST для выборок по всем типам: индекс
            # ограничения — частичный.
            GistIndex(
                fields=["employee_id", "period"],
                name="gist_status_employee_period",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id}:{self.status_type_code}"


class Secondment(TimeStampedModel):
    """Связь пары прикомандирования (порт Secondment из источника).

    Откомандирование заводит штатное подразделение: сотрудник получает
    DETACHED (остаётся «по списку» своего) И ATTACHED («+N» у принимающего).
    Эта запись СВЯЗЫВАЕТ обе ноги, чтобы возврат закрывал их как одно целое,
    и несёт принимающее подразделение: у строки статуса подразделения нет
    вообще, поэтому «+N» у принимающего читается отсюда.

    Отличия от источника: employee_id и оба подразделения — целые ссылки
    старой структуры (в источнике UUID новой core). Ноги — FK PROTECT: нога
    не исчезает из-под связи (как у StatusOverride). Проекция «+N» в расход
    отложена, как и в источнике.
    """

    employee_id = models.IntegerField()
    out_status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.PROTECT, related_name="secondment_out"
    )
    in_status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.PROTECT, related_name="secondment_in"
    )
    # Штатное подразделение на момент откомандирования: снимок, а не ссылка на
    # текущее место сотрудника — перевод по штату не должен задним числом
    # переписывать, ОТКУДА человека откомандировали.
    from_division_id = models.IntegerField()
    to_division_id = models.IntegerField()
    document_basis = models.TextField(blank=True, default="")

    class Meta:
        db_table = "ops_status_secondments"
        constraints = [
            # Инвариант на уровне БД, а не только сервиса: откомандирование
            # «в самого себя» бессмысленно, и второй писатель (импорт,
            # будущая проекция) не должен уметь его записать.
            models.CheckConstraint(
                condition=~Q(from_division_id=F("to_division_id")),
                name="chk_secondment_divisions_differ",
            ),
            models.CheckConstraint(
                condition=~Q(out_status=F("in_status")),
                name="chk_secondment_legs_differ",
            ),
        ]
        indexes = [
            models.Index(
                fields=["employee_id", "-created_at"],
                name="idx_secondment_emp_created",
            ),
        ]

    def __str__(self):
        return f"secondment:{self.employee_id}:{self.to_division_id}"


class StatusOverride(TimeStampedModel):
    """Запись обхода мягкого конфликта (порт Override из источника).

    Пишется ТОЛЬКО когда мягкий конфликт был реально обойдён: «нет конфликта —
    нет записи». Хранит снимок обойдённых пересечений, чтобы причина решения
    осталась читаемой после изменения самих статусов.
    """

    status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.CASCADE, related_name="overrides"
    )
    employee_id = models.IntegerField()
    status_type_code = models.CharField(max_length=50)
    reason = models.TextField()
    conflicts = models.JSONField(default=list)

    class Meta:
        db_table = "ops_status_overrides"

    def __str__(self):
        return f"override:{self.status_id}"
