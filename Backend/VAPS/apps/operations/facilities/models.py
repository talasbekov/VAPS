"""Story 14.1: `Object` (охраняемая инфраструктура) + `ObjectPassport` (паспорт).

Naming: donor spec (docs/PersonnelStatus/VAPS_7.8.2.md §17, DB-OPS-004/014)
and PRD's glossary (prd.md:55) both use «Объект»/`ops_objects` — the epic's
own one-line title ("Facility") was a draft English label at planning time,
not a binding name. Models/db_table follow the donor+PRD terminology.

Scope (14.1): models + migration ONLY — no API, no services, no RBAC (see
the story's Scope Decision). `importance_level_code` is a plain CharField,
NOT a FK: the donor's `ops_event_levels` reference table doesn't exist yet
(Epic 15's territory) — building a FK to a nonexistent table isn't possible,
and this field becomes a real FK in a later migration once that table lands.
`ops_object_passport_history` (donor DB-OPS-015, field-change audit trail)
is out of scope — likely 14.12 or a future story.
"""

from django.core.exceptions import ValidationError
from django.db import models

from apps.operations.models import TimeStampedModel


class Object(TimeStampedModel):
    """Охраняемая инфраструктура (donor `ops_objects`, DB-OPS-004)."""

    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    address = models.TextField()
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    # Donor FK -> ops_event_levels (Epic 15, not built yet) — plain field
    # until that reference table exists; becomes a real FK in a later
    # migration, not reinterpreted or dropped.
    importance_level_code = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_objects"
        verbose_name = "Объект"
        verbose_name_plural = "Объекты"
        constraints = [
            # Review (Blind Hunter/Edge Case Hunter): bad geocoding could
            # silently write e.g. 999.999999 with no DB-level check — mirror
            # apps.core.models's numeric-bound pattern (MinValueValidator/
            # MaxValueValidator there is form/serializer-level only; a DB
            # CheckConstraint also survives bulk_create()/.objects.create(),
            # the same reasoning as completeness_status below).
            models.CheckConstraint(
                condition=models.Q(latitude__gte=-90) & models.Q(latitude__lte=90),
                name="ck_object_latitude_range",
            ),
            models.CheckConstraint(
                condition=models.Q(longitude__gte=-180) & models.Q(longitude__lte=180),
                name="ck_object_longitude_range",
            ),
        ]

    def __str__(self):
        return f"{self.code} — {self.name}"


class ObjectPassport(TimeStampedModel):
    """Паспорт объекта (donor `ops_object_passports`, DB-OPS-014).

    1:1 with `Object` — one passport per object (donor's
    `object_id UUID UNIQUE REFERENCES` maps directly to `OneToOneField`).
    """

    class CompletenessStatus(models.TextChoices):
        RED = "RED", "Не заполнен"
        YELLOW = "YELLOW", "Частично заполнен"
        GREEN = "GREEN", "Заполнен"

    # PROTECT, not CASCADE (review, Edge Case Hunter): Object.is_active
    # signals this codebase's deactivation path is a flag flip, not a hard
    # delete — a stray Object.objects.filter(...).delete() (e.g. a future
    # cleanup script) must not silently destroy the passport with it.
    # Mirrors apps/operations/rbac/models.py's PROTECT for the same
    # "don't let this vanish silently" reasoning.
    object = models.OneToOneField(
        Object, on_delete=models.PROTECT, related_name="passport"
    )
    object_type = models.CharField(max_length=100, blank=True)
    # ARCH-007: flat external actor ids, never FKs into core.models.
    responsible_user_id = models.CharField(max_length=100, blank=True)
    responsible_employee_id = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    security_notes = models.TextField(blank=True)
    # PRD's «проблемные места» — this single field, not a separate table
    # (donor doesn't model it as one either).
    vulnerable_places = models.TextField(blank=True)

    # Structural layout fields (donor: JSONB DEFAULT '[]', 12 fields).
    access_routes = models.JSONField(default=list, blank=True)
    entrances = models.JSONField(default=list, blank=True)
    exits = models.JSONField(default=list, blank=True)
    service_entrances = models.JSONField(default=list, blank=True)
    parking_zones = models.JSONField(default=list, blank=True)
    dropoff_zones = models.JSONField(default=list, blank=True)
    elevators = models.JSONField(default=list, blank=True)
    stairs = models.JSONField(default=list, blank=True)
    roofs = models.JSONField(default=list, blank=True)
    basements = models.JSONField(default=list, blank=True)
    technical_rooms = models.JSONField(default=list, blank=True)
    cameras = models.JSONField(default=list, blank=True)

    # Infrastructure text fields (donor: 8 plain text columns).
    power_supply = models.TextField(blank=True)
    ventilation = models.TextField(blank=True)
    communication = models.TextField(blank=True)
    internet = models.TextField(blank=True)
    nearby_high_buildings = models.TextField(blank=True)
    public_zones = models.TextField(blank=True)
    crowd_places = models.TextField(blank=True)
    repair_works = models.TextField(blank=True)

    completeness_status = models.CharField(
        max_length=10,
        choices=CompletenessStatus.choices,
        default=CompletenessStatus.RED,
    )
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_verified_by = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "ops_object_passports"
        verbose_name = "Паспорт объекта"
        verbose_name_plural = "Паспорта объектов"
        constraints = [
            # choices без DB-гарда пропускает bulk_create()/.objects.create()
            # (lesson: feedback_vaps_db_integrity_checks) — mirror the
            # ck_<table>_<field>_choices pattern established in 13.5a/13.5c.
            models.CheckConstraint(
                condition=models.Q(completeness_status__in=["RED", "YELLOW", "GREEN"]),
                name="ck_object_passport_completeness_status_choices",
            ),
        ]

    def __str__(self):
        return f"Паспорт {self.object.code} ({self.completeness_status})"


class Sector(TimeStampedModel):
    """Сектор объекта (donor `ops_object_sectors`, DB-OPS-005).

    Story 14.2 — built literally per the donor's 6 fields. NO "senior" field:
    the story title's "Sector со старшим" maps to PRD FR-19's «Старший
    объекта» — an RBAC persona administering the whole Object (including its
    sectors), not a Sector-level data column the donor schema doesn't have.
    See the story's Scope Decision before adding one without product backing.
    """

    object = models.ForeignKey(Object, on_delete=models.CASCADE, related_name="sectors")
    name = models.CharField(max_length=255)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_object_sectors"
        verbose_name = "Сектор"
        verbose_name_plural = "Секторы"
        constraints = [
            models.UniqueConstraint(
                fields=["object", "name"], name="uq_object_sector_name"
            ),
        ]

    def __str__(self):
        return f"{self.object.code} / {self.name}"


class Post(TimeStampedModel):
    """Пост охраны (donor `ops_object_posts`, DB-OPS-005 + DB-OPS-016).

    `object` and `sector` are BOTH present, not mutually exclusive: the
    donor keeps `object_id` NOT NULL even when `sector_id` is set — a
    sector groups posts WITHIN an object, it doesn't replace the direct
    post-to-object link.
    """

    object = models.ForeignKey(Object, on_delete=models.CASCADE, related_name="posts")
    # SET_NULL, nullable: a post can exist without a sector (donor:
    # `sector_id ... ON DELETE SET NULL`) — sector is optional grouping.
    sector = models.ForeignKey(
        Sector,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posts",
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    # Donor FK -> ops_post_types (doesn't exist yet) — plain field, same
    # deferred-FK pattern as Object.importance_level_code (14.1).
    post_type_code = models.CharField(max_length=50, default="FIXED")
    max_service_minutes = models.PositiveIntegerField(default=480)
    # Donor's requirements JSON schema (schema_version/min_height_cm/gender/
    # min_rank_index/max_rank_index/required_position_codes/
    # allow_overqualification, DB-OPS-006) is stored as-is — validating that
    # nested schema is a service/API concern, out of scope for this
    # models-only story (mirrors 14.1's deferred completeness_status
    # auto-computation).
    requirements = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    # DB-OPS-016 extension (9 fields, verbatim from donor). is_outdoor/
    # max_continuous_minutes have NO donor DEFAULT (null by default,
    # deliberately distinct from requires_weapon/requires_uniform below,
    # which DO have explicit donor defaults) — do not "fix" this asymmetry.
    tasks = models.TextField(blank=True)
    features = models.TextField(blank=True)
    location_description = models.TextField(blank=True)
    is_outdoor = models.BooleanField(null=True, blank=True)
    max_continuous_minutes = models.PositiveIntegerField(null=True, blank=True)
    # Donor: NUMERIC(3,1). RATING-DECISION-002 — stored only, NOT enforced
    # in this story (or any story until a minimal-rating-aggregate module
    # is explicitly built).
    min_rating = models.DecimalField(
        max_digits=3, decimal_places=1, null=True, blank=True
    )
    requires_weapon = models.BooleanField(default=False)
    requires_special_equipment = models.BooleanField(default=False)
    requires_uniform = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_object_posts"
        verbose_name = "Пост"
        verbose_name_plural = "Посты"
        constraints = [
            models.UniqueConstraint(
                fields=["object", "code"], name="uq_object_post_code"
            ),
            # Review-round precedent (14.1's lat/long CheckConstraint) —
            # DB-level range guard, not just PositiveIntegerField's >0.
            models.CheckConstraint(
                condition=models.Q(max_service_minutes__gte=30)
                & models.Q(max_service_minutes__lte=1440),
                name="ck_post_max_service_minutes_range",
            ),
        ]

    def __str__(self):
        return f"{self.object.code} / {self.code}"

    def clean(self):
        # Review (Blind Hunter/Edge Case Hunter, independently confirmed):
        # `object` and `sector` are separate FKs — nothing else stops a
        # Post pointing at a Sector belonging to a DIFFERENT Object. A
        # DB CheckConstraint can't express this (Postgres CHECK can't
        # reference another table's columns); this is the best-available
        # enforcement layer, not a compromise below the project's usual
        # DB-first bar. Same caveat as everywhere else in this codebase:
        # .objects.create()/bulk_create() skip full_clean() — a future
        # API/service story MUST call full_clean() (or replicate this
        # check) on the write path, this alone is not sufficient at the
        # DB level.
        super().clean()
        if self.sector_id and self.sector.object_id != self.object_id:
            raise ValidationError(
                {"sector": "Сектор должен принадлежать тому же объекту, что и пост."}
            )


class ChecklistTemplate(TimeStampedModel):
    """Типовой шаблон чек-листа (donor `ops_object_checklist_templates`,
    DB-OPS-017) — GLOBAL catalog, no link to any particular `Object`.
    """

    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_object_checklist_templates"
        verbose_name = "Шаблон чек-листа"
        verbose_name_plural = "Шаблоны чек-листов"

    def __str__(self):
        return f"{self.code} — {self.name}"


class ChecklistItem(TimeStampedModel):
    """Пункт типового чек-листа (donor `ops_object_checklist_items`,
    DB-OPS-018). Belongs to a `ChecklistTemplate`, NOT to an `Object`
    directly — a template (and its items) is shared across every object
    bound to it via `ChecklistBinding`.
    """

    template = models.ForeignKey(
        ChecklistTemplate, on_delete=models.CASCADE, related_name="items"
    )
    text = models.TextField()
    category = models.CharField(max_length=100, blank=True)
    is_required = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_object_checklist_items"
        verbose_name = "Пункт чек-листа"
        verbose_name_plural = "Пункты чек-листа"

    def __str__(self):
        return f"{self.template.code} / {self.text[:40]}"


class ChecklistBinding(TimeStampedModel):
    """Привязка шаблона к объекту (donor `ops_object_checklist_bindings`,
    DB-OPS-048, §50 "High Fix" — the per-object half of "типовой +
    дополнения"). `created_by` is NOT redeclared here: `TimeStampedModel`
    already has it (donor's NOT NULL is looser here — nullable — living
    base class wins over literal donor SQL, same call as 14.1's PK type).
    """

    object = models.ForeignKey(
        Object, on_delete=models.CASCADE, related_name="checklist_bindings"
    )
    # PROTECT, not RESTRICT: donor says ON DELETE RESTRICT, but this file
    # already established PROTECT for "must not vanish silently" (14.1's
    # ObjectPassport.object) — semantically equivalent for this story's
    # purposes, consistency with sibling models wins over the literal
    # donor keyword.
    template = models.ForeignKey(
        ChecklistTemplate, on_delete=models.PROTECT, related_name="bindings"
    )
    name = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_object_checklist_bindings"
        verbose_name = "Привязка чек-листа"
        verbose_name_plural = "Привязки чек-листов"
        constraints = [
            models.UniqueConstraint(
                fields=["object", "template"], name="uq_object_checklist_binding"
            ),
        ]

    def __str__(self):
        return f"{self.object.code} ← {self.template.code}"


class ChecklistOverride(TimeStampedModel):
    """Per-объектная дельта чек-листа (donor `ops_object_checklist_overrides`,
    DB-OPS-049, §50). Resolving "template items + overrides" into one
    effective checklist (BR-CHECKLIST-003) is a service/API concern, out
    of scope for this models-only story.
    """

    class OverrideType(models.TextChoices):
        ADD = "ADD", "Добавление"
        MODIFY = "MODIFY", "Изменение"
        DISABLE = "DISABLE", "Отключение"

    binding = models.ForeignKey(
        ChecklistBinding, on_delete=models.CASCADE, related_name="overrides"
    )
    # NULL for a pure ADD; set for MODIFY/DISABLE (donor: SET_NULL — a
    # MODIFY/DISABLE override survives even if the original template item
    # is later deleted).
    source_item = models.ForeignKey(
        ChecklistItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="overrides",
    )
    override_type = models.CharField(max_length=10, choices=OverrideType.choices)
    text = models.TextField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    # NULL = "not overridden" (donor: nullable, distinct from False).
    is_required = models.BooleanField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(null=True, blank=True)
    reason = models.TextField(blank=True)

    class Meta:
        db_table = "ops_object_checklist_overrides"
        verbose_name = "Дополнение чек-листа"
        verbose_name_plural = "Дополнения чек-листа"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(override_type__in=["ADD", "MODIFY", "DISABLE"]),
                name="ck_checklist_override_type_choices",
            ),
        ]

    def __str__(self):
        return f"{self.binding} / {self.override_type}"

    def clean(self):
        # Proactive fix (lesson from 14.2's review, applied BEFORE a new
        # review round could find the same class of gap in a new form):
        # source_item and binding are separate FKs — nothing else stops
        # source_item belonging to a DIFFERENT template than
        # binding.template. Same caveat as Post.clean(): full_clean()
        # only, not enforced by .objects.create()/bulk_create().
        #
        # Review (Edge Case Hunter): the cross-template branch below
        # guards on `self.binding_id`/`self.source_item_id` BEFORE
        # dereferencing the related objects — comparing the descriptors
        # directly (`self.binding`, `self.source_item`) on an unsaved
        # instance whose FK isn't set raises an uncaught
        # ObjectDoesNotExist instead of a clean ValidationError.
        #
        # Review (Blind Hunter): ADD/MODIFY/DISABLE were representable
        # with any source_item state (e.g. ADD with a stale source_item,
        # or MODIFY with none) — now validated explicitly.
        super().clean()
        errors = []
        if self.override_type == self.OverrideType.ADD and self.source_item_id:
            errors.append("Для ADD пункт-источник должен быть пустым.")
        elif (
            self.override_type in (self.OverrideType.MODIFY, self.OverrideType.DISABLE)
            and not self.source_item_id
        ):
            errors.append("Для MODIFY/DISABLE пункт-источник обязателен.")
        elif (
            self.source_item_id
            and self.binding_id
            and self.source_item.template_id != self.binding.template_id
        ):
            errors.append(
                "Пункт-источник должен принадлежать тому же шаблону, что и привязка."
            )
        if errors:
            raise ValidationError({"source_item": errors})
