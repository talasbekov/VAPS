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
        constraints = [
            models.CheckConstraint(
                condition=models.Q(category__in=("OURS", "FOREIGN")),
                name="chk_ops_protected_person_category",
            ),
        ]

    def __str__(self):
        return self.name


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

    def __str__(self):
        return f"ГВО-патч {self.event.code}"
