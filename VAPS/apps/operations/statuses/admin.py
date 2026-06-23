"""Admin-регистрация справочника типов статусов (Story 2.11).

Регистрируется StatusType (справочник типов, plain reference, seeded
seed_statuses) — НЕ EmployeeStatus (бизнес-инстанс, пишется сервисом с
аудитом/конфликт-детектором; ARCH#L467 запрещает его регистрацию).
"""
from django.contrib import admin

from apps.operations.statuses.models import StatusType


@admin.register(StatusType)
class StatusTypeAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "priority",
        "is_hard_block",
        "restricts_editing",
        "is_active",
    )
    search_fields = ("code", "name")
    list_filter = ("is_active", "is_hard_block")
