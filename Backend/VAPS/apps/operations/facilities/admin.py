from django.contrib import admin

from apps.operations.facilities.models import PostType


@admin.register(PostType)
class PostTypeAdmin(admin.ModelAdmin):
    """Catalog-only (ARCH canon): Facility/Sector/Post are business models —
    admin writes would bypass the service layer (audit, RBAC) — and stay
    unregistered; the admin-platform guard pins this."""

    list_display = ("code", "name", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")
