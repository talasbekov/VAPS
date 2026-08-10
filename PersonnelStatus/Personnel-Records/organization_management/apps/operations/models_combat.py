"""Боевые группы на Трассе (§24.5-24.10) — смена-агрегат и свои реестры.

Процесс §24.1: формирование потребности (submission=null, «Требует подачи») →
подача составом → рассмотрение (принять/вернуть с причиной) → индивидуальное
ознакомление каждого из основного состава → заступление → сдача смены
(checkpoint §24.22) → факт несения (§24.23: фактический состав задаётся
отдельно). Подача целиком (состав, execution, история замен) — JSONB-документ
в форме контракта; писателей сериализует select_for_update строки смены
(мерка OpsSecurityEvent).

Реестр Трасс — СОБСТВЕННЫЙ (§24.9): не шарится с направлением «Трасса» внутри
ОМ — разные процессы, разные ID-пространства.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class OpsCombatDutyType(TimeStampedModel):
    duty_type_code = models.CharField(max_length=50, unique=True)
    safe_label = models.CharField(max_length=255)
    supports_multiple_routes = models.BooleanField()

    class Meta:
        db_table = "ops_combat_duty_types"
        verbose_name = "Вид дежурства боевой группы"
        verbose_name_plural = "Виды дежурств боевых групп"
        ordering = ["duty_type_code", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(duty_type_code__regex=r"\S"),
                name="chk_ops_combat_type_code",
            ),
        ]

    def __str__(self):
        return self.duty_type_code


class OpsCombatRoute(TimeStampedModel):
    route_code = models.CharField(max_length=50, unique=True)
    safe_label = models.CharField(max_length=255)

    class Meta:
        db_table = "ops_combat_routes"
        verbose_name = "Трасса"
        verbose_name_plural = "Трассы"
        ordering = ["route_code", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(route_code__regex=r"\S"),
                name="chk_ops_combat_route_code",
            ),
        ]

    def __str__(self):
        return self.safe_label


class OpsCombatDutyShift(TimeStampedModel):
    business_date = models.DateField()
    duty_type_code = models.CharField(max_length=50)
    # Снимок набора Трасс на момент заведения: правка реестра не переписывает
    # уже заведённые смены.
    route_set = models.JSONField()
    # null — «Требует подачи»; далее документ подачи целиком.
    submission = models.JSONField(null=True)
    required_employees = models.PositiveIntegerField(null=True)

    class Meta:
        db_table = "ops_combat_duty_shifts"
        verbose_name = "Смена боевой группы"
        verbose_name_plural = "Смены боевых групп"
        ordering = ["business_date", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(duty_type_code__regex=r"\S"),
                name="chk_ops_combat_shift_type_code",
            ),
        ]

    def __str__(self):
        return f"{self.business_date} {self.duty_type_code}"
