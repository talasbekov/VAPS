import uuid

from django.db import models
from mptt.models import MPTTModel, TreeForeignKey
from django.utils import timezone

class Division(MPTTModel):
    """Модель подразделения (поддерживает иерархию)"""

    class DivisionType(models.TextChoices):
        ORGANIZATION = 'organization', 'Организация'
        DEPARTMENT = 'department', 'Департамент'
        DIRECTORATE = 'directorate', 'Управление'
        DIVISION = 'division', 'Отдел'

    name = models.CharField(max_length=255, default='')
    code = models.CharField(max_length=50, unique=True, default='')
    division_type = models.CharField(max_length=20, choices=DivisionType.choices, default=DivisionType.ORGANIZATION)
    parent = TreeForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children'
    )
    is_active = models.BooleanField(default=True)
    #: Собирает ли это подразделение СУТОЧНЫЙ СВОД (Plane №326, решение
    #: заказчика 30.08.2026).
    #:
    #: ЗАЧЕМ ПРИЗНАК, А НЕ ПРАВИЛО ПО ФОРМЕ ДЕРЕВА. До №326 экран расхода
    #: угадывал узел свода: брал подразделение, чей родитель — корень, и у
    #: которого в поддереве больше всего управлений расхода. Правило работало,
    #: пока департамент был один; на трёх оно перестало давать однозначный
    #: ответ, и шаг цикла «собрать и отправить свод» не проходился НИ ПОД КЕМ.
    #: Догадка по косвенным признакам — тот же класс, что «департамент = нет
    #: предков» (№307): признак верен ровно до первой структуры, под которую
    #: его не подбирали.
    #:
    #: Признак НЕ ЗАМЕНЯЕТ правило молча: пока он не проставлен ни у кого,
    #: экран ведёт себя как прежде. Проставленный — отменяет угадывание.
    is_summary_node = models.BooleanField(default=False)
    order = models.IntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class MPTTMeta:
        order_insertion_by = ['order', 'name']

    class Meta:
        db_table = 'divisions'
        verbose_name = 'Подразделение'
        verbose_name_plural = 'Подразделения'
        constraints = [
            models.UniqueConstraint(fields=['parent', 'name'], name='uq_division_name_per_parent')
        ]
        permissions = [
            ("can_view_subordinate_departments", "Может видеть на уровне Департамента"),
        ]

    def save(self, *args, **kwargs):
        # `code` is unique; auto-generate a unique value when none is supplied
        # so divisions can be created without an explicit code.
        if not self.code:
            new_code = f"DIV-{uuid.uuid4().hex[:8].upper()}"
            while Division.objects.filter(code=new_code).exclude(pk=self.pk).exists():
                new_code = f"DIV-{uuid.uuid4().hex[:8].upper()}"
            self.code = new_code
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name
