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
    duty_type_code = models.CharField(max_length=50)
    safe_label = models.CharField(max_length=255)
    supports_multiple_routes = models.BooleanField()
    division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, null=True, blank=True, related_name="combat_duty_types")
    shift_kind = models.CharField(max_length=10, choices=[("DAY", "Дневное"), ("NIGHT", "Ночное"), ("DAILY", "Суточное")], default="DAY")
    rest_day_after = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

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
            models.UniqueConstraint(fields=["division", "duty_type_code"], name="uq_combat_type_owner_code"),
            models.UniqueConstraint(fields=["duty_type_code"], condition=models.Q(division__isnull=True), name="uq_combat_legacy_type_code"),
        ]

    def __str__(self):
        return self.duty_type_code


class OpsCombatRoute(TimeStampedModel):
    route_code = models.CharField(max_length=50)
    safe_label = models.CharField(max_length=255)
    division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, null=True, blank=True, related_name="combat_routes")
    is_active = models.BooleanField(default=True)
    description = models.CharField(max_length=500, blank=True)

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
            models.UniqueConstraint(fields=["division", "route_code"], name="uq_combat_route_owner_code"),
            models.UniqueConstraint(fields=["route_code"], condition=models.Q(division__isnull=True), name="uq_combat_legacy_route_code"),
        ]

    def __str__(self):
        return self.safe_label


class OpsCombatGroup(TimeStampedModel):
    """Permanent catalogue identity; the roster is always owned by a dated shift."""

    name = models.CharField(max_length=64)
    division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, related_name="combat_groups")
    max_members = models.PositiveIntegerField(default=4)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_combat_groups"
        ordering = ["division_id", "name", "pk"]
        verbose_name = "Боевая группа"
        verbose_name_plural = "Боевые группы"
        constraints = [
            models.UniqueConstraint(fields=["division", "name"], name="uq_combat_group_owner_name"),
            models.CheckConstraint(condition=models.Q(max_members__gt=0), name="chk_combat_group_capacity"),
        ]

    def __str__(self):
        return self.name


class OpsCombatDutyShift(TimeStampedModel):
    business_date = models.DateField()
    group = models.ForeignKey(OpsCombatGroup, on_delete=models.PROTECT, null=True, blank=True, related_name="shifts")
    division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, null=True, blank=True, related_name="combat_shifts")
    duty_type = models.ForeignKey(OpsCombatDutyType, on_delete=models.PROTECT, null=True, blank=True, related_name="shifts")
    state_code = models.CharField(max_length=32, default="DRAFT")
    location = models.JSONField(default=dict)
    security_object = models.ForeignKey("operations.OpsSecurityObject", on_delete=models.PROTECT, null=True, blank=True, related_name="combat_shifts")
    # Passport revisions may retire a post. Keep its historical ID and frozen
    # location without cascading into dated rosters; validate live use explicitly.
    security_post = models.ForeignKey("operations.OpsSecurityPost", on_delete=models.DO_NOTHING, db_constraint=False, null=True, blank=True, related_name="combat_shifts")
    event = models.ForeignKey("operations.OpsSecurityEvent", on_delete=models.SET_NULL, null=True, blank=True, related_name="combat_shifts")
    assignment_snapshot = models.JSONField(default=dict)
    callsign = models.CharField(max_length=64, blank=True)
    equipment = models.JSONField(default=list)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=100, blank=True)
    cancellation_reason = models.TextField(blank=True)
    duty_type_code = models.CharField(max_length=50)
    # Снимок набора Трасс на момент заведения: правка реестра не переписывает
    # уже заведённые смены.
    route_set = models.JSONField()
    #: Имя боевой группы — «БГ-1» (Plane №243).
    #:
    #: Сценарий заказчика называет группу по имени: «на трассы в боевых
    #: группах например мангилик ел - Кабанбай батыр НАЗВАНИЕ БОЕВОЙ ГРУППЫ
    #: БГ-1». По нему группу ищут, им отчитываются, его пишут в расходе.
    #:
    #: СВОБОДНАЯ СТРОКА НА СМЕНЕ, а не справочник постоянных групп: так это и
    #: записано в сценарии, и так у имени нет своей жизни — сегодня БГ-1 идёт
    #: на одну трассу, завтра её собирают заново. Справочник постоянных групп
    #: — отдельное решение с историей группы, и принимать его за заказчика
    #: здесь незачем.
    #:
    #: Пусто допустимо: смены заводились до появления поля, и требовать имя
    #: задним числом значило бы сломать их.
    group_name = models.CharField(max_length=64, blank=True)
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
            models.UniqueConstraint(fields=["group", "business_date"], condition=models.Q(group__isnull=False, cancelled_at__isnull=True), name="uq_combat_live_group_day"),
        ]

    def __str__(self):
        return f"{self.business_date} {self.duty_type_code}"


class OpsCombatPlace(TimeStampedModel):
    """Department-owned selection of service objects; passports stay shared."""

    division = models.ForeignKey("divisions.Division", on_delete=models.PROTECT, related_name="combat_places")
    security_object = models.ForeignKey("operations.OpsSecurityObject", on_delete=models.PROTECT, related_name="combat_places")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_combat_places"
        verbose_name = "Место службы подразделения"
        verbose_name_plural = "Места службы подразделений"
        ordering = ["division_id", "id"]
        constraints = [models.UniqueConstraint(fields=["division", "security_object"], name="uq_combat_place_owner_object")]


class OpsCombatDutyMember(TimeStampedModel):
    """A dated employee identity and a globally unique live daily reservation."""

    shift = models.ForeignKey(OpsCombatDutyShift, on_delete=models.CASCADE, related_name="members")
    employee = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="combat_memberships")
    business_date = models.DateField()
    name_snapshot = models.CharField(max_length=320)
    is_leader = models.BooleanField(default=False)
    is_driver = models.BooleanField(default=False)
    is_reserve = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ops_combat_duty_members"
        verbose_name = "Участник боевого дежурства"
        verbose_name_plural = "Участники боевого дежурства"
        ordering = ["-is_leader", "is_reserve", "id"]
        constraints = [
            models.UniqueConstraint(fields=["shift", "employee"], name="uq_combat_shift_employee"),
            models.UniqueConstraint(fields=["employee", "business_date"], condition=models.Q(active=True), name="uq_combat_employee_day"),
            models.UniqueConstraint(fields=["shift"], condition=models.Q(is_leader=True), name="uq_combat_shift_leader"),
            models.UniqueConstraint(fields=["shift"], condition=models.Q(is_driver=True), name="uq_combat_shift_driver"),
            models.CheckConstraint(condition=~models.Q(is_reserve=True, is_leader=True) & ~models.Q(is_reserve=True, is_driver=True), name="chk_combat_main_roles"),
        ]
