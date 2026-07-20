"""Чек-лист объекта — привязка шаблона и оверрайды (14.3a, FR-5.5).

Business layer over the 14.3 catalogs (donor DB-OPS-048/049): an object binds
a standard template (BR-CHECKLIST-001) and points ADD/MODIFY/DISABLE rows at
it (BR-CHECKLIST-002); reconnaissance (15.3) reads the RESOLVED list —
template items + overrides (BR-CHECKLIST-003, ``selectors.resolve_checklist``).

Donor deviations, all declared in the story:
- ``source_item`` is PROTECT, not the donor's SET_NULL (14.3 review pin): an
  orphaned MODIFY is undefined resolver behaviour, and the admin delete of an
  item would never show the SET_NULL side effect. Deactivating a binding
  deletes its overrides (service-level mirror of the donor's CASCADE-on-
  DELETE) so dead overrides cannot padlock item deletion forever.
- Uniques are PARTIAL (is_active=True), the 14.2 canon: soft-delete must not
  squat the (facility, template) pair — re-binding starts with a clean
  override set.
- One override per (binding, source_item): the donor is silent, but two
  MODIFYs (or MODIFY+DISABLE) of one item make BR-CHECKLIST-003
  non-deterministic — same data-shape class as «category NULL is the one
  empty state».
- MODIFY payload semantics: NULL = «не менять»; clearing a category via
  MODIFY is not supported (DISABLE + ADD is the radical-edit path).
"""

from django.db import models
from django.db.models import Q

from apps.operations.models import TimeStampedModel

_BOUND_TYPES = ["MODIFY", "DISABLE"]
_PAYLOAD_EMPTY = Q(
    text__isnull=True,
    category__isnull=True,
    is_required__isnull=True,
    sort_order__isnull=True,
)


class ChecklistBinding(TimeStampedModel):
    facility = models.ForeignKey(
        "ops_facilities.Facility",
        on_delete=models.CASCADE,
        related_name="checklist_bindings",
    )
    template = models.ForeignKey(
        "ops_facilities.ChecklistTemplate",
        on_delete=models.PROTECT,
        db_column="template_code",
        related_name="bindings",
    )
    # NULL is the ONE empty state (item.category precedent).
    name = models.CharField(max_length=255, null=True, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_checklist_bindings"
        ordering = ["template_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["facility", "template"],
                condition=Q(is_active=True),
                name="uq_checklist_binding_facility_template",
            ),
            # is_default without an invariant is noise: at most one ACTIVE
            # default per facility; the condition includes is_active, so a
            # deactivated default frees the slot automatically.
            models.UniqueConstraint(
                fields=["facility"],
                condition=Q(is_default=True, is_active=True),
                name="uq_checklist_binding_default_per_facility",
            ),
            models.CheckConstraint(
                condition=Q(name__isnull=True) | Q(name__regex=r"\S"),
                name="chk_checklist_binding_name_not_blank",
            ),
        ]

    def __str__(self):
        return f"{self.template_id} @ {self.facility_id}"


class ChecklistOverride(TimeStampedModel):
    binding = models.ForeignKey(
        ChecklistBinding, on_delete=models.CASCADE, related_name="overrides"
    )
    source_item = models.ForeignKey(
        "ops_facilities.ChecklistItem",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="overrides",
    )
    override_type = models.CharField(max_length=50)
    text = models.TextField(null=True, blank=True)
    category = models.CharField(max_length=100, null=True, blank=True)
    is_required = models.BooleanField(null=True, blank=True)
    sort_order = models.IntegerField(null=True, blank=True)
    reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "ops_checklist_overrides"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(override_type__in=["ADD", *_BOUND_TYPES]),
                name="chk_checklist_override_type",
            ),
            # text__isnull=False обязателен: голый regex на NULL даёт NULL,
            # а CHECK «проходит» на NULL — ADD без текста проскочил бы.
            models.CheckConstraint(
                condition=~Q(override_type="ADD")
                | Q(
                    source_item__isnull=True,
                    text__isnull=False,
                    text__regex=r"\S",
                ),
                name="chk_checklist_override_add_shape",
            ),
            models.CheckConstraint(
                condition=~Q(override_type__in=_BOUND_TYPES)
                | Q(source_item__isnull=False),
                name="chk_checklist_override_bound_source",
            ),
            models.CheckConstraint(
                condition=~Q(override_type="DISABLE") | _PAYLOAD_EMPTY,
                name="chk_checklist_override_disable_payload",
            ),
            models.CheckConstraint(
                condition=~Q(override_type="MODIFY") | ~_PAYLOAD_EMPTY,
                name="chk_checklist_override_modify_payload",
            ),
            models.CheckConstraint(
                condition=Q(text__isnull=True) | Q(text__regex=r"\S"),
                name="chk_checklist_override_text_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(category__isnull=True)
                | Q(category__regex=r"\S"),
                name="chk_checklist_override_category_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(sort_order__isnull=True) | Q(sort_order__gte=0),
                name="chk_checklist_override_sort_order_min",
            ),
            models.UniqueConstraint(
                fields=["binding", "source_item"],
                condition=Q(source_item__isnull=False),
                name="uq_checklist_override_binding_source",
            ),
        ]

    def __str__(self):
        return f"[{self.binding_id}] {self.override_type}"
