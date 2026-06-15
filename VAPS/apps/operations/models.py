from django.core.exceptions import ValidationError
from django.db import models

from apps.operations.validators import DUTY_ROLE_CHOICES


class TimeStampedModel(models.Model):
    """Integer-PK base with timestamps. Operations surrogate-PK tables use this.

    Deliberately does NOT subclass core's UUIDTimeStampedModel: operations
    surrogate PKs are integer BigAutoField (project decision), while
    cross-context reference columns remain UUIDField.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # ARCH-007 / BR-ACCOUNT-002: external auth user_id as a flat string.
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


class UserRole(TimeStampedModel):
    # BR-ACCOUNT-001/002, ARCH-007: external auth account id, never core_employees.id.
    user_id = models.CharField(max_length=100)
    role_code = models.ForeignKey(
        "Role", on_delete=models.PROTECT, db_column="role_code",
        to_field="code", related_name="user_roles",
    )
    scope_division_id = models.UUIDField(null=True, blank=True)
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
    employee_id = models.UUIDField(null=True, blank=True)
    duty_role_code = models.CharField(max_length=50, choices=DUTY_ROLE_CHOICES)
    scope_division_id = models.UUIDField(null=True, blank=True)
    event_id = models.UUIDField(null=True, blank=True)  # flat; ops_events not built yet
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


class Permission(models.Model):
    code = models.CharField(primary_key=True, max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_permissions"

    def __str__(self):
        return self.code
