import uuid

from django.db import models


class UUIDTimeStampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Organization(UUIDTimeStampedModel):
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_organizations"

    def __str__(self):
        return self.name


class DivisionType(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_division_types"

    def __str__(self):
        return self.code


class Position(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    level = models.IntegerField(default=0)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_positions"

    def __str__(self):
        return self.code


class Rank(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, null=True, blank=True)
    rank_index = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_ranks"

    def __str__(self):
        return self.code


class Division(UUIDTimeStampedModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="divisions"
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    type_code = models.ForeignKey(
        DivisionType, on_delete=models.PROTECT, db_column="type_code", related_name="divisions"
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_divisions"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="unique_org_division_code"
            )
        ]
        indexes = [
            models.Index(fields=["parent"], name="idx_core_divisions_parent"),
            models.Index(
                fields=["organization", "type_code"], name="idx_core_div_org_type"
            ),
        ]

    def __str__(self):
        return self.name
