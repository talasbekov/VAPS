"""Типовой чек-лист объекта — шаблоны и пункты (14.3, FR-5.5).

Admin-managed catalogs (donor DB-OPS-017/018): «типовой единый чек-лист»
ведёт Администратор — no services, no audit, per the catalog canon. The
object-scoped business layer (bindings, ADD/MODIFY/DISABLE overrides, the
BR-CHECKLIST-003 resolver) is story 14.3a; checklist EXECUTION with the
decision/reason is reconnaissance (15.3, DB-OPS-019/020).

Donor deviations (14.1 canon — DDL is a semantic contract): natural code PK
instead of UUID+UNIQUE (PostType precedent); table names without the
``object_`` infix (`ops_checklist_*`); ``is_active`` on items switches a
template item off GLOBALLY — not to be confused with 14.3a's per-object
DISABLE override.
"""

from django.db import models
from django.db.models import Q


class ChecklistTemplate(models.Model):
    code = models.CharField(primary_key=True, max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_checklist_templates"
        ordering = ["code"]
        constraints = [
            models.CheckConstraint(
                condition=Q(code__regex=r"\S"),
                name="chk_checklist_template_code_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(name__regex=r"\S"),
                name="chk_checklist_template_name_not_blank",
            ),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"


class ChecklistItem(models.Model):
    template = models.ForeignKey(
        ChecklistTemplate, on_delete=models.CASCADE, related_name="items"
    )
    text = models.TextField()
    category = models.CharField(max_length=100, null=True, blank=True)
    is_required = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_checklist_items"
        ordering = ["sort_order", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(text__regex=r"\S"),
                name="chk_checklist_item_text_not_blank",
            ),
            # category: NULL is the ONE empty state ('' ≠ NULL would split
            # «без категории» into two groups for the 14.3a resolver).
            models.CheckConstraint(
                condition=Q(category__isnull=True) | Q(category__regex=r"\S"),
                name="chk_checklist_item_category_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(sort_order__gte=0),
                name="chk_checklist_item_sort_order_min",
            ),
        ]

    def __str__(self):
        return f"[{self.template_id}] {self.text[:50]}"
