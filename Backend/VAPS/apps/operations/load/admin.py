"""Admin-регистрация справочника коэффициентов поправок нагрузки
(Story 19.3) — reference-таблица, тот же прецедент, что
`apps.operations.statuses.admin.StatusTypeAdmin`."""

from django.contrib import admin

from apps.operations.load.models import LoadCoefficient


@admin.register(LoadCoefficient)
class LoadCoefficientAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "multiplier", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)
