"""RBAC раздела ОМ — порт apps/operations/{models,rbac/models}.py из Backend/VAPS.

ЭТО ЦЕЛЕВАЯ система ролей и прав (решение Bratan, 04.08.2026): старая
common.Role/Permission (ROLE_1..ROLE_6) остаётся обслуживать существующие
экраны на переходный период, но новые проверки строятся на этих моделях, и
старые вьюхи будут переводиться сюда по кускам.

Отличия от источника:
- user_id / created_by хранят str(User.id) старого проекта (в источнике —
  id внешнего КУ; строковый тип сохранён, чтобы переезд на внешний auth не
  менял схему).
- scope_division_id / employee_id — целые (pk старых divisions/employees),
  в источнике UUID новой core-структуры. Ссылки НАМЕРЕННО плоские, без FK:
  PROTECT ломал бы каскады старой структуры, SET_NULL молча расширял бы
  scope до глобального (scope NULL = «без ограничения»).
- event_id — целое, плоское: приложения мероприятий ещё нет.
"""
from django.core.exceptions import ValidationError
from django.db import models

from organization_management.apps.operations.validators import DUTY_ROLE_CHOICES

# Справочник типов статусов живёт отдельным модулем (провенанс порта виден в
# его докстринге), но должен быть импортирован здесь: Django ищет модели
# приложения через models.
from organization_management.apps.operations.status_types import (  # noqa: F401,E402
    StatusType,
)


class TimeStampedModel(models.Model):
    """База с целочисленным PK и таймстампами для таблиц раздела ОМ."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        abstract = True


class Role(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_roles"

    def __str__(self):
        return self.code


class Permission(models.Model):
    code = models.CharField(primary_key=True, max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_permissions"

    def __str__(self):
        return self.code


class UserRole(TimeStampedModel):
    user_id = models.CharField(max_length=100)
    role_code = models.ForeignKey(
        "Role", on_delete=models.PROTECT, db_column="role_code",
        to_field="code", related_name="user_roles",
    )
    scope_division_id = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_user_roles"
        constraints = [
            models.UniqueConstraint(
                fields=["user_id", "role_code", "scope_division_id"],
                name="unique_user_role_scope",
            )
        ]
        indexes = [
            models.Index(
                fields=["user_id", "is_active"], name="idx_ops_user_roles_user"
            ),
        ]

    def __str__(self):
        return f"{self.user_id}->{self.role_code_id}"


class RolePermission(TimeStampedModel):
    role_code = models.ForeignKey(
        "Role", on_delete=models.CASCADE, db_column="role_code",
        to_field="code", related_name="role_permissions",
    )
    permission_code = models.ForeignKey(
        "Permission", on_delete=models.CASCADE, db_column="permission_code",
        to_field="code", related_name="permission_roles",
    )

    class Meta:
        db_table = "ops_role_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["role_code", "permission_code"], name="unique_role_permission"
            )
        ]

    def __str__(self):
        return f"{self.role_code_id}:{self.permission_code_id}"


class TemporaryDutyPermission(TimeStampedModel):
    user_id = models.CharField(max_length=100)
    employee_id = models.IntegerField(null=True, blank=True)
    duty_role_code = models.CharField(max_length=50, choices=DUTY_ROLE_CHOICES)
    scope_division_id = models.IntegerField(null=True, blank=True)
    event_id = models.IntegerField(null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_temporary_duty_permissions"
        indexes = [
            models.Index(
                fields=["user_id", "is_active", "starts_at", "ends_at"],
                name="idx_ops_temp_duty_user",
            )
        ]

    def clean(self):
        super().clean()
        if not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")

    def __str__(self):
        return f"{self.user_id}:{self.duty_role_code}"
