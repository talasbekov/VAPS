from __future__ import annotations
from django.db import models
from django.utils.translation import gettext_lazy as _

class Position(models.Model):
    """Справочник должностей согласно ТЗ"""
    name = models.CharField(max_length=255, verbose_name=_("Название должности"))
    name_kk = models.CharField(
        max_length=255, blank=True, default="",
        verbose_name=_("Название должности (kk)"),
    )
    # Код справочника: им контракт нового бэка идентифицирует должность
    # (`position_code`). Отдавать вместо кода `name` нельзя — клиент считал бы
    # строку стабильным ключом, а она меняется при переименовании.
    code = models.CharField(max_length=100, unique=True, verbose_name=_("Код"))
    level = models.SmallIntegerField(
        verbose_name=_("Уровень"),
        help_text=_("Чем меньше число, тем выше должность")
    )
    # Жизненный цикл значения (UC-REF-001, подпроект 2): активность, дата
    # неактуальности и ссылка на прежнюю запись при замене. PROTECT на
    # `supersedes`: цепь «взамен» рваться не должна — прежняя запись с
    # преемником остаётся историей и не удаляется.
    is_active = models.BooleanField(default=True, db_index=True)
    inactive_since = models.DateField(null=True, blank=True)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True,
        related_name="superseded_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["level", "name"]
        verbose_name = _("Должность")
        verbose_name_plural = _("Должности")
        indexes = [
            models.Index(fields=["level"]),
        ]
        constraints = [
            # CHECK на уровне БД, а не только blank=False: создание через ORM
            # без валидации пропустило бы пустую строку, и она заняла бы
            # единственное свободное место под «» во всём справочнике.
            models.CheckConstraint(
                condition=~models.Q(code=""), name="ck_position_code_not_blank"
            ),
        ]

    def __str__(self):
        return f"{self.name} (Уровень: {self.level})"


class StatusType(models.Model):
    """Справочник: Типы статусов"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Тип статуса")
        verbose_name_plural = _("Типы статусов")
        ordering = ['name']

    def __str__(self):
        return self.name


class DismissalReason(models.Model):
    """Справочник: Причины увольнения"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Причина увольнения")
        verbose_name_plural = _("Причины увольнения")
        ordering = ['name']

    def __str__(self):
        return self.name


class TransferReason(models.Model):
    """Справочник: Причины перевода"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Причина перевода")
        verbose_name_plural = _("Причины перевода")
        ordering = ['name']

    def __str__(self):
        return self.name


class VacancyReason(models.Model):
    """Справочник: Причины открытия вакансии"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Причина открытия вакансии")
        verbose_name_plural = _("Причины открытия вакансии")
        ordering = ['name']

    def __str__(self):
        return self.name


class EducationType(models.Model):
    """Справочник: Типы образования"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Тип образования")
        verbose_name_plural = _("Типы образования")
        ordering = ['name']

    def __str__(self):
        return self.name


class DocumentType(models.Model):
    """Справочник: Типы документов"""
    name = models.CharField(max_length=255, unique=True, verbose_name=_("Название"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    is_active = models.BooleanField(default=True, db_index=True, verbose_name=_("Активен"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Тип документа")
        verbose_name_plural = _("Типы документов")
        ordering = ['name']

    def __str__(self):
        return self.name


class SystemSetting(models.Model):
    """Справочник: Настройки системы"""
    key = models.CharField(max_length=100, unique=True, verbose_name=_("Ключ"))
    value = models.CharField(max_length=255, verbose_name=_("Значение"))
    description = models.TextField(blank=True, verbose_name=_("Описание"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Настройка системы")
        verbose_name_plural = _("Настройки системы")
        ordering = ['key']

    def __str__(self):
        return self.key


class Rank(models.Model):
    """Справочник: Звание согласно ТЗ"""
    name = models.CharField(max_length=50, unique=True, verbose_name=_("Звание"))
    name_kk = models.CharField(
        max_length=255, blank=True, default="", verbose_name=_("Звание (kk)")
    )
    # Код справочника: им контракт нового бэка идентифицирует звание
    # (`rank_code`). См. довод у Position.code.
    code = models.CharField(max_length=100, unique=True, verbose_name=_("Код"))
    level = models.SmallIntegerField(
        verbose_name=_("Уровень"),
        help_text=_("Чем меньше число, тем выше звание")
    )
    # Жизненный цикл значения (UC-REF-001, подпроект 2): активность, дата
    # неактуальности и ссылка на прежнюю запись при замене. PROTECT на
    # `supersedes`: цепь «взамен» рваться не должна — прежняя запись с
    # преемником остаётся историей и не удаляется.
    is_active = models.BooleanField(default=True, db_index=True)
    inactive_since = models.DateField(null=True, blank=True)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True,
        related_name="superseded_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["level", "name"]
        verbose_name = _("Звание")
        verbose_name_plural = _("Звания")
        indexes = [
            models.Index(fields=["level"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(code=""), name="ck_rank_code_not_blank"
            ),
        ]

    def __str__(self):
        return f"{self.name} (Уровень: {self.level})"