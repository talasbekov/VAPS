from django.db import models


class TimeStampedModel(models.Model):
    """Integer-PK base with timestamps. Operations surrogate-PK tables use this.

    Deliberately does NOT subclass core's UUIDTimeStampedModel: operations
    surrogate PKs are integer BigAutoField (project decision), while
    cross-context reference columns remain UUIDField.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
