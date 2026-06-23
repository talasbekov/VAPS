"""Admin-регистрация core-справочников (Story 2.11).

Только справочники без бизнес-инвариантов (ARCH#L467): Position/Rank/
DivisionType. Бизнес-модели (Employee/Division/User/…) НЕ регистрируются —
запись мимо сервиса = мимо аудита/прав (страж-тест в test_admin_platform).
"""
from django.contrib import admin

from apps.core.models import DivisionType, Position, Rank


@admin.register(Position)
class PositionAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "level", "sort_order", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)


@admin.register(Rank)
class RankAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "category", "rank_index", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)


@admin.register(DivisionType)
class DivisionTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "sort_order", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)
