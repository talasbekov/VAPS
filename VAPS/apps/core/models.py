import uuid

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.validators import iin_validator


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


class Employee(UUIDTimeStampedModel):
    class Gender(models.TextChoices):
        MALE = "M", "Мужской"
        FEMALE = "F", "Женский"

    class EmploymentStatus(models.TextChoices):
        WORKING = "WORKING", "Работает"
        FIRED = "FIRED", "Уволен"
        ARCHIVED = "ARCHIVED", "В архиве"

    external_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    iin = models.CharField(max_length=12, unique=True, validators=[iin_validator])
    full_name = models.CharField(max_length=255)
    rank_code = models.CharField(max_length=50)
    rank_index = models.IntegerField(default=0)
    position_code = models.CharField(max_length=50)
    division = models.ForeignKey(
        Division, on_delete=models.PROTECT, related_name="employees"
    )
    phone = models.CharField(max_length=50, null=True, blank=True)
    gender = models.CharField(max_length=1, choices=Gender.choices, null=True, blank=True)
    height_cm = models.IntegerField(
        null=True, blank=True, validators=[MinValueValidator(120), MaxValueValidator(230)]
    )
    is_active = models.BooleanField(default=True)
    is_attached_force = models.BooleanField(default=False)
    data_source = models.CharField(max_length=50, default="STUB")
    separated_at = models.DateTimeField(null=True, blank=True)

    # §45.2 rich profile
    personnel_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    last_name = models.CharField(max_length=150, null=True, blank=True)
    first_name = models.CharField(max_length=150, null=True, blank=True)
    middle_name = models.CharField(max_length=150, null=True, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    photo_file_path = models.TextField(null=True, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    dismissal_date = models.DateField(null=True, blank=True)
    work_phone = models.CharField(max_length=50, null=True, blank=True)
    work_email = models.CharField(max_length=255, null=True, blank=True)
    personal_phone = models.CharField(max_length=50, null=True, blank=True)
    personal_email = models.CharField(max_length=255, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    employment_status = models.CharField(
        max_length=50, choices=EmploymentStatus.choices, default=EmploymentStatus.WORKING
    )

    class Meta:
        db_table = "core_employees"
        indexes = [
            models.Index(fields=["division", "is_active"], name="idx_emp_div_active"),
            models.Index(fields=["full_name"], name="idx_emp_full_name"),
        ]

    def save(self, *args, **kwargs):
        # BR-EMP-001: derive full_name from parts when present.
        if self.last_name and self.first_name:
            parts = [self.last_name, self.first_name, self.middle_name or ""]
            self.full_name = " ".join(p for p in parts if p).strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_name


class EmployeeDivisionHistory(UUIDTimeStampedModel):
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="division_history"
    )
    division = models.ForeignKey(Division, on_delete=models.PROTECT, related_name="+")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=50, default="MANUAL")

    class Meta:
        db_table = "core_employee_division_history"
        indexes = [
            models.Index(
                fields=["employee", "starts_at", "ends_at"], name="idx_emp_div_hist_lookup"
            )
        ]

    def clean(self):
        super().clean()
        if self.ends_at is not None and not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")

    def __str__(self):
        return f"{self.employee_id}@{self.division_id}"


class UserEmployeeBinding(UUIDTimeStampedModel):
    # BR-ACCOUNT-001: external auth account id as string, NOT employee UUID.
    user_id = models.CharField(max_length=100, unique=True)
    employee = models.OneToOneField(
        Employee, on_delete=models.CASCADE, related_name="account_binding"
    )

    class Meta:
        db_table = "core_user_employee_bindings"

    def __str__(self):
        return f"{self.user_id}->{self.employee_id}"


class DivisionHistoricalSlot(UUIDTimeStampedModel):
    division = models.ForeignKey(
        Division, on_delete=models.CASCADE, related_name="historical_slots"
    )
    allocated_slots = models.IntegerField(validators=[MinValueValidator(0)])
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_division_historical_slots"
        indexes = [
            models.Index(
                fields=["division", "valid_from", "valid_to"], name="idx_core_slots_timeline"
            )
        ]

    def clean(self):
        super().clean()
        if self.valid_to is not None and not (self.valid_from < self.valid_to):
            raise ValidationError("valid_from must be earlier than valid_to")
