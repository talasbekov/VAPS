import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.validators import iin_validator


class UUIDTimeStampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # ARCH-007 / BR-ACCOUNT-002: external auth user_id as a flat string,
    # never an FK to core_users. Nullable: actorless writes (imports, legacy
    # rows) honestly stay NULL until E4 audit consolidation.
    created_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        abstract = True


class UserManager(BaseUserManager):
    def create_user(self, username, password=None):
        if not username:
            raise ValueError("The given username must be set")
        user = self.model(username=username)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, username, password=None, **extra_fields):
        # Story 2.8: Django superusers exist solely to operate the Admin for
        # reference catalogs. Business authorization stays the in-house
        # PermissionService (FR-33); Django permissions are admin-only.
        # Canonical Django manager contract: accept extra_fields, enforce the
        # superuser invariants, and validate username like create_user does.
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        if not username:
            raise ValueError("The given username must be set")
        user = self.model(username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    # Story 2.8: PermissionsMixin added so the Django Admin (catalogs only) can
    # use is_staff/is_superuser. Django groups/permissions are ADMIN-ONLY;
    # business authorization remains the in-house PermissionService (FR-33).
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # ARCH-007 / BR-ACCOUNT-002: external auth account id, the same string as
    # UserEmployeeBinding.user_id / UserRole.user_id.
    username = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        db_table = "core_users"

    def __str__(self):
        return self.username


class Organization(UUIDTimeStampedModel):
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50, unique=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_organizations"

    def __str__(self):
        return self.name


class DivisionType(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    sort_order = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_division_types"

    def __str__(self):
        return self.code


class Position(models.Model):
    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    # level drives roster seniority ("lower = senior"); a negative value would
    # sort senior to level 0. Keep ordinals non-negative. (deferred #L193)
    level = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    sort_order = models.IntegerField(default=0, validators=[MinValueValidator(0)])
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
    rank_index = models.IntegerField(default=0, validators=[MinValueValidator(0)])
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
        DivisionType,
        on_delete=models.PROTECT,
        db_column="type_code",
        related_name="divisions",
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
    gender = models.CharField(
        max_length=1, choices=Gender.choices, null=True, blank=True
    )
    height_cm = models.IntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(120), MaxValueValidator(230)],
    )
    is_active = models.BooleanField(default=True)
    is_attached_force = models.BooleanField(default=False)
    data_source = models.CharField(max_length=50, default="STUB")
    separated_at = models.DateTimeField(null=True, blank=True)

    # §45.2 rich profile
    personnel_number = models.CharField(
        max_length=50, unique=True, null=True, blank=True
    )
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
        max_length=50,
        choices=EmploymentStatus.choices,
        default=EmploymentStatus.WORKING,
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
                fields=["employee", "starts_at", "ends_at"],
                name="idx_emp_div_hist_lookup",
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
                fields=["division", "valid_from", "valid_to"],
                name="idx_core_slots_timeline",
            )
        ]

    def clean(self):
        super().clean()
        if self.valid_to is not None and not (self.valid_from < self.valid_to):
            raise ValidationError("valid_from must be earlier than valid_to")


class StaffingSlot(UUIDTimeStampedModel):
    division = models.ForeignKey(
        Division, on_delete=models.CASCADE, related_name="staffing_slots"
    )
    position_code = models.ForeignKey(
        Position,
        on_delete=models.PROTECT,
        db_column="position_code",
        related_name="staffing_slots",
    )
    slot_number = models.CharField(max_length=50, null=True, blank=True)
    parent_slot = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="child_slots",
    )
    is_active = models.BooleanField(default=True)
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_staffing_slots"
        indexes = [
            models.Index(
                fields=["division", "is_active", "valid_from", "valid_to"],
                name="idx_core_staffing_div",
            )
        ]

    def clean(self):
        super().clean()
        if self.valid_to is not None and not (self.valid_from < self.valid_to):
            raise ValidationError("valid_from must be earlier than valid_to")


class EmployeeStaffingAssignment(UUIDTimeStampedModel):
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="staffing_assignments"
    )
    staffing_slot = models.ForeignKey(
        StaffingSlot, on_delete=models.PROTECT, related_name="assignments"
    )
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=50, default="MANUAL")

    class Meta:
        db_table = "core_employee_staffing_assignments"
        indexes = [
            models.Index(
                fields=["employee", "starts_at", "ends_at"],
                name="idx_core_emp_staffing",
            )
        ]

    def clean(self):
        super().clean()
        if self.ends_at is not None and not (self.starts_at < self.ends_at):
            raise ValidationError("starts_at must be earlier than ends_at")


class Vacancy(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Открыта"
        CLOSED = "CLOSED", "Закрыта"
        FROZEN = "FROZEN", "Заморожена"

    staffing_slot = models.ForeignKey(
        StaffingSlot, on_delete=models.CASCADE, related_name="vacancies"
    )
    status_code = models.CharField(
        max_length=50, choices=Status.choices, default=Status.OPEN
    )
    opened_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "core_vacancies"

    def clean(self):
        super().clean()
        if self.closed_at is not None and not (self.opened_at < self.closed_at):
            raise ValidationError("opened_at must be earlier than closed_at")


class SensitiveFieldPolicy(UUIDTimeStampedModel):
    class Strategy(models.TextChoices):
        FULL_HIDE = "FULL_HIDE", "Скрыть полностью"
        PARTIAL_MASK = "PARTIAL_MASK", "Частично маскировать"
        ALLOW = "ALLOW", "Разрешить"

    field_code = models.CharField(max_length=100)
    permission_code = models.CharField(max_length=100)
    mask_strategy = models.CharField(max_length=50, choices=Strategy.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "core_sensitive_field_policies"
        constraints = [
            models.UniqueConstraint(
                fields=["field_code", "permission_code"], name="unique_sensitive_policy"
            )
        ]


class Watermark(models.Model):
    # Internal bookkeeping for materialization processes (ARCH-DATA-022):
    # each process tracks how far it has materialized, keyed by name
    # (e.g. "status_effects" — Story 3.12). No NOW()-default on the business
    # date: consumers set it explicitly.
    key = models.CharField(max_length=100, unique=True)
    last_materialized_date = models.DateField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_watermarks"

    def __str__(self):
        return self.key


class ParallelRunModeSwitch(models.Model):
    """Story 7.7 — «без двойного ввода»: singleton-by-convention switch
    (mirrors ``Watermark``'s key-row pattern, но здесь ключ фиксирован —
    ровно один переключатель на инсталляцию). No row = disabled (AC-1
    default-off — критично для нулевой регрессии существующих write-путей).
    """

    key = models.CharField(max_length=100, unique=True, default="default")
    enabled = models.BooleanField(default=False)
    enabled_at = models.DateTimeField(null=True, blank=True)
    disabled_at = models.DateTimeField(null=True, blank=True)
    # Story 7.8 — «дедлайн до старта» (AC-1): nullable at the schema level
    # (pre-7.8 rows / 0018 migration have none), but `enable()` requires it
    # as of 7.8 — recorded at the moment the mode is switched on, not
    # backfilled later.
    deadline = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_parallel_run_mode_switch"

    def __str__(self):
        return f"parallel_run_mode({self.key})={'on' if self.enabled else 'off'}"


class ParallelRunPilotDivision(models.Model):
    """Story 7.7 — подразделения-исключения ("пилотные тест-операции",
    AC-1): ручной ввод для них РАЗРЕШЁН даже при включённом режиме. Плоский
    ``division_id`` (ARCH-003/004 — без FK на ``Division``, тот же паттерн,
    что ``apps.parallel_run.models``).
    """

    division_id = models.UUIDField(unique=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_parallel_run_pilot_divisions"

    def __str__(self):
        return str(self.division_id)
