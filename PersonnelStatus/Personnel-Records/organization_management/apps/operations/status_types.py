"""Справочник типов статусов раздела ОМ (порт StatusType из
Backend/VAPS apps/operations/statuses/models/status_type.py).

Зачем он здесь ДО переезда самих статусов: в старой системе тип статуса —
хардкод (TextChoices из 12 значений), в новой — таблица с приоритетом,
колонкой расхода и флагами (жёсткая блокировка, счёт в списке/штате, чей
владелец). Справочник переезжает первым и приносит МОСТ: legacy_code
связывает каждый старый код с каноническим. Пока модель статусов не выбрана
(развилка: старая employee_statuses против новой ops_employee_statuses),
этот справочник — единственная общая точка правды о словаре типов.

Старую логику не трогает: старые вьюхи продолжают читать свои TextChoices.
"""
from django.db import models


class StatusType(models.Model):
    """Справочный каталог типов статусов персонала.

    Натуральный VARCHAR-код как PK (прецедент Role/Permission).
    is_hard_block — хранимый дискриминатор для детектора конфликтов
    (жёсткий → 422, мягкий → 409 + override). Деактивация через is_active,
    не удалением.

    Отличие от источника: поле legacy_code — мост к кодам старой системы
    (organization_management.apps.statuses.EmployeeStatus.StatusType).
    """

    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=100)
    is_hard_block = models.BooleanField(default=False)
    priority = models.IntegerField()
    report_column_code = models.CharField(max_length=30)
    counts_in_list = models.BooleanField(default=True)
    counts_in_staff = models.BooleanField(default=True)
    is_ku_owned = models.BooleanField(default=False)
    # Только «Откомандирован» теряет право редактировать статусы.
    restricts_editing = models.BooleanField(default=False)
    color = models.CharField(max_length=20, blank=True, default="")
    # Предельная длительность статуса этого типа в календарных днях;
    # NULL = без ограничения. Свойство типа, не операторское поле.
    max_duration_days = models.PositiveIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    # Тип-ЗАГЛУШКА: означает не факт, а его отсутствие («уточняется»).
    # Такую строку не правят, а РАЗРЕШАЮТ ретро-заменой на реальный статус
    # (status_service.resolve_placeholder).
    #
    # Отличие от источника: там код заглушки прибит литералом
    # PENDING_CLARIFICATION в сервисе. Здесь словарь типов заводит
    # администратор, и сервис, знающий один код наизусть, либо не признал бы
    # заведённую заглушку, либо требовал бы завести тип с «правильным» именем.
    # Признак — свойство типа, и живёт он там же, где остальные свойства.
    is_placeholder = models.BooleanField(default=False)
    # Мост к старой системе: код из EmployeeStatus.StatusType.choices.
    # NULL — тип, которого в старом словаре не было (новые типы раздела ОМ).
    # unique: два канонических типа не могут претендовать на один старый код,
    # иначе перенос данных стал бы неоднозначным.
    legacy_code = models.CharField(
        max_length=20, null=True, blank=True, unique=True
    )

    class Meta:
        db_table = "ops_status_types"
        # priority не уникален → "code" даёт детерминированный tie-break.
        ordering = ["priority", "code"]
        verbose_name = "Тип статуса (ОМ)"
        verbose_name_plural = "Типы статусов (ОМ)"

    def __str__(self):
        return self.code
