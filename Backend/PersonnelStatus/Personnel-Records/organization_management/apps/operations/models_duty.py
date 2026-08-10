"""План дежурств: реестр видов, индивидуальные смены, месячный план, политика.

Контракт — клиент раздела ОМ (entities/duty-shift): смена = один календарный
день, линейный цикл PLANNED → ACKNOWLEDGED → ACTIVE → COMPLETED, CANCELLED —
тупик из непочатых состояний (отменённая остаётся в данных — удаление стёрло
бы след планирования). Снимки (цель, привязка паспорта, след отмены) — JSONB
в форме контракта, как у агрегата ОМ; производный DutyPassportStatus не
хранится — пересчитывается на каждом чтении.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel

_TARGET_TYPES = ("OWN_OBJECT", "PROTECTED_OBJECT")
_SHIFT_STATES = ("PLANNED", "ACKNOWLEDGED", "ACTIVE", "COMPLETED", "CANCELLED")
_PLAN_STATES = ("DRAFT", "APPROVED")
_REST_MODES = ("HARD_BLOCK", "SOFT_OVERRIDE")


class OpsDutyType(TimeStampedModel):
    """Вид дежурства — реестр, а не хардкод страницы (данные «с сервера»)."""

    duty_type_code = models.CharField(max_length=50, unique=True)
    safe_label = models.CharField(max_length=255)
    target_type = models.CharField(max_length=20)
    default_duration_minutes = models.PositiveIntegerField()
    requires_senior = models.BooleanField()
    # Срок отдыха — свойство ВИДА; режим реакции — глобальная политика.
    rest_after_minutes = models.PositiveIntegerField()
    requires_current_passport = models.BooleanField()

    class Meta:
        db_table = "ops_duty_types"
        verbose_name = "Вид дежурства"
        verbose_name_plural = "Виды дежурств"
        ordering = ["duty_type_code", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(target_type__in=_TARGET_TYPES),
                name="chk_ops_duty_type_target",
            ),
            models.CheckConstraint(
                condition=models.Q(duty_type_code__regex=r"\S"),
                name="chk_ops_duty_type_code",
            ),
        ]

    def __str__(self):
        return self.duty_type_code


class OpsDutyShift(TimeStampedModel):
    business_date = models.DateField()
    duty_type_code = models.CharField(max_length=50)
    # Снимок цели {targetType, objectId, safeLabel}: переименование объекта не
    # переписывает уже спланированные смены.
    target = models.JSONField()
    employee_name = models.CharField(max_length=255)
    # Строка, не FK: исполнитель может быть вне справочника (контракт
    # допускает null), а живой Employee подтверждается сервисом на создании.
    employee_id = models.CharField(max_length=50, null=True)
    state_code = models.CharField(max_length=20)
    acknowledged_at = models.DateTimeField(null=True)
    actual_start = models.DateTimeField(null=True)
    actual_end = models.DateTimeField(null=True)
    passport_binding = models.JSONField(null=True)
    note = models.TextField(null=True)
    cancellation = models.JSONField(null=True)
    override_reason = models.TextField(null=True)

    class Meta:
        db_table = "ops_duty_shifts"
        verbose_name = "Смена дежурства"
        verbose_name_plural = "Смены дежурств"
        ordering = ["business_date", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(state_code__in=_SHIFT_STATES),
                name="chk_ops_duty_shift_state",
            ),
            models.CheckConstraint(
                condition=models.Q(duty_type_code__regex=r"\S"),
                name="chk_ops_duty_shift_type_code",
            ),
        ]

    def __str__(self):
        return f"{self.business_date} {self.employee_name}"


class OpsDutyMonthlyPlan(TimeStampedModel):
    """План на месяц один (ключ — месяц). Утверждённый закрыт для планирующих
    мутаций; REOPEN поднимает revision и возвращает DRAFT. История только
    дополняется."""

    month = models.CharField(max_length=7, unique=True)
    state_code = models.CharField(max_length=20)
    revision = models.PositiveIntegerField()
    last_validation = models.JSONField(null=True)
    approved_at = models.DateTimeField(null=True)
    approved_by = models.CharField(max_length=255, blank=True)
    history = models.JSONField()

    class Meta:
        db_table = "ops_duty_monthly_plans"
        verbose_name = "Месячный план дежурств"
        verbose_name_plural = "Месячные планы дежурств"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(state_code__in=_PLAN_STATES),
                name="chk_ops_duty_plan_state",
            ),
            models.CheckConstraint(
                condition=models.Q(revision__gte=1),
                name="chk_ops_duty_plan_revision_floor",
            ),
            models.CheckConstraint(
                condition=models.Q(month__regex=r"^\d{4}-\d{2}$"),
                name="chk_ops_duty_plan_month_format",
            ),
        ]

    def __str__(self):
        return f"{self.month} r{self.revision}"


class OpsDutyConflictPolicy(TimeStampedModel):
    """Действующие правила конфликтов — хранимая строка-синглтон (владелец —
    «Настройки»; мерка OpsPassportFreshnessPolicy): каждый посчитанный
    конфликт несёт версию политики, по которой посчитан."""

    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True)
    version = models.CharField(max_length=50)
    rest_after_duty_mode = models.CharField(max_length=20)

    class Meta:
        db_table = "ops_duty_conflict_policy"
        verbose_name = "Политика конфликтов дежурств"
        verbose_name_plural = "Политика конфликтов дежурств"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(rest_after_duty_mode__in=_REST_MODES),
                name="chk_ops_duty_policy_mode",
            ),
            models.CheckConstraint(
                condition=models.Q(version__regex=r"\S"),
                name="chk_ops_duty_policy_version",
            ),
        ]

    def __str__(self):
        return f"conflict policy {self.version}"
