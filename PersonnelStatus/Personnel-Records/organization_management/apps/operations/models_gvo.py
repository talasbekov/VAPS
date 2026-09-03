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


class OpsForeignVisit(TimeStampedModel):
    """Визит иностранного ОЛ — своя сущность со статусом (Plane №435,
    `[МД-05]`, Ш-19 плана P2).

    ТОЛЬКО у мероприятий `kind=FOREIGN`: у внутреннего ОМ визита нет как
    понятия (`[ГВО-01]`), и заводить его туда сервис отказывается.

    `data` — те же секции, что нёс JSON-патч сводки (`OpsGvoSummaryPatch`):
    страна, лица, прибытие/убытие, встречающие, размещение, группы,
    транспорт. Патч ОСТАЁТСЯ и читается, пока страницу не переведут (Ш-20):
    правка пишется в обе записи, чтение предпочитает визит. Поля, по
    которым «данных нет от принимающей стороны», помечаются в `unspecified`
    списком ключей (`[ГВО-06]`) — слово «уточняется» больше не значение по
    умолчанию, а флаг, который печатает документ.

    Ссылки на справочники (`[ГВО-08]`): встречающие/провожающие/состав ГВО —
    идентификаторы сотрудников в `data.meetEmployeeIds` и т. п.; ОЛ — лица
    бюллетеня (`event.protected_persons`); транспорт — выделенные машины
    реестра ГОН (`event.vehicles`). Текстовые строки живут рядом, пока их
    читает документ.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        READY = "READY", "Заполнен"
        APPROVED = "APPROVED", "Утверждён"

    event = models.OneToOneField(
        OpsSecurityEvent, on_delete=models.CASCADE, related_name="foreign_visit"
    )
    protected_person = models.ForeignKey(
        "operations.OpsProtectedPerson",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.DRAFT
    )
    version = models.PositiveIntegerField(default=1)
    data = models.JSONField(default=dict, blank=True)
    unspecified = models.JSONField(default=list, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["event_id"]
        verbose_name = "Визит иностранного ОЛ"
        verbose_name_plural = "Визиты иностранных ОЛ"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=("DRAFT", "READY", "APPROVED")),
                name="chk_ops_foreign_visit_status",
            ),
        ]

    def __str__(self):
        return f"Визит {self.event.code} · {self.get_status_display()}"
