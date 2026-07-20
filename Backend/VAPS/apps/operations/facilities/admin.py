from django.contrib import admin

from apps.operations.facilities.models import (
    ChecklistItem,
    ChecklistTemplate,
    PostType,
)


class _NaturalPkAdmin(admin.ModelAdmin):
    """Natural-PK catalogs: ``code`` is IMMUTABLE after creation.

    Django skips pk-uniqueness validation when editing and save() is
    UPDATE-or-INSERT — an edited code silently OVERWRITES another row (or
    forks the record, orphaning children). Verified by probe on 5.1.
    """

    def get_readonly_fields(self, request, obj=None):
        readonly = super().get_readonly_fields(request, obj)
        if obj is not None:
            return (*readonly, "code")
        return readonly


@admin.register(PostType)
class PostTypeAdmin(_NaturalPkAdmin):
    """Catalog-only (ARCH canon): Facility/Sector/Post are business models —
    admin writes would bypass the service layer (audit, RBAC) — and stay
    unregistered; the admin-platform guard pins this."""

    list_display = ("code", "name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")


class ChecklistItemInline(admin.TabularInline):
    """Items are edited ONLY through their template — no standalone
    changelist (состав вне контекста шаблона не редактируется)."""

    model = ChecklistItem
    extra = 0
    fields = ("text", "category", "is_required", "sort_order", "is_active")


@admin.register(ChecklistTemplate)
class ChecklistTemplateAdmin(_NaturalPkAdmin):
    list_display = ("code", "name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")
    inlines = [ChecklistItemInline]
