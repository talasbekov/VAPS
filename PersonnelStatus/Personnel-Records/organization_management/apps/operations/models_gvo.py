"""Каталог охраняемых лиц и патчи сводок ГВО (спека 2026-08-20).

Сводка ГВО собирается на КЛИЕНТЕ из бюллетеня мероприятия; бэк хранит
только ручные правки (патч по коду ОМ) — та же семантика, что была у мока
MSW. Полей-фактов у лица произвольное количество и состав, поэтому патч —
JSONField, а не таблицы: нормализация дала бы join'ы без единого запроса,
которому они нужны.
"""
from django.conf import settings
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel
from organization_management.apps.operations.models_event import OpsSecurityEvent


class OpsProtectedPerson(TimeStampedModel):
    class Category(models.TextChoices):
        OURS = "OURS", "Свои"
        FOREIGN = "FOREIGN", "Иностранные"

    # Код `OL-N` (Plane №417, `[МД-09]`): выдаётся сам при первом сохранении
    # и руками не правится — N это идентификатор строки, он монотонный,
    # не переиспользуется и не требует второй последовательности в базе.
    # NULL в базе допустим: `bulk_create` минует `save()`, и строка без кода
    # не должна ронять вставку — код у неё ВЫВОДИМ (`code_for(pk)`), и
    # читатели берут его через `display_code`, а не сырым полем.
    code = models.CharField(max_length=24, unique=True, editable=False, null=True)
    name = models.CharField(max_length=200)
    callsign = models.CharField(max_length=100, blank=True)
    # Без дефолта: категорию обязан назвать тот, кто заводит запись.
    category = models.CharField(max_length=10, choices=Category.choices)
    bio = models.TextField(blank=True)
    # Мягкое скрытие: каталог показывается в живом реестре, удаление строки
    # стёрло бы её из истории мероприятий, где лицо уже упомянуто.
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        verbose_name = "Охраняемое лицо"
        verbose_name_plural = "Охраняемые лица"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(category__in=("OURS", "FOREIGN")),
                name="chk_ops_protected_person_category",
            ),
        ]

    @staticmethod
    def code_for(pk):
        return f"OL-{pk}"

    @property
    def display_code(self):
        """Код для печати: сохранённый либо выведенный из pk — один и тот же."""
        return self.code or self.code_for(self.pk)

    def save(self, *args, **kwargs):
        # Код зависит от pk, а pk появляется только после INSERT — поэтому
        # две записи на создании; на правке — одна, код уже есть.
        if self.code or self.pk is None:
            super().save(*args, **kwargs)
        if not self.code:
            self.code = self.code_for(self.pk)
            super().save(update_fields=["code"])

    def __str__(self):
        return f"{self.display_code} {self.name}"


class OpsGvoSummaryPatch(TimeStampedModel):
    # CASCADE: патч — производная мероприятия и без него не значит ничего.
    event = models.OneToOneField(
        OpsSecurityEvent,
        on_delete=models.CASCADE,
        related_name="gvo_patch",
    )
    patch = models.JSONField()
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["event_id"]
        verbose_name = "Правка сводки ГВО"
        verbose_name_plural = "Правки сводок ГВО"

    def __str__(self):
        return f"ГВО-патч {self.event.code}"
