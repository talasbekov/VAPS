from django.contrib import admin
from organization_management.apps.dictionaries import models

@admin.register(models.Position)
class PositionAdmin(admin.ModelAdmin):
    list_display = ['name', 'level', 'created_at']
    search_fields = ['name']
    list_filter = ['level']

@admin.register(models.Rank)
class RankAdmin(admin.ModelAdmin):
    list_display = ['name', 'level', 'created_at']
    search_fields = ['name']
    list_filter = ['level']
    ordering = ['level', 'name']


# Показать в Admin всё остальное — решение заказчика 27.08.2026 (Plane №182):
# ручная проверка требует видеть каждую сущность. Настроенные выше admin-классы
# авторегистратор не трогает; см. organization_management/admin_auto.py — там же
# записано, чем это оплачено (правка мимо сервисов и мимо аудита).
from organization_management.admin_auto import register_remaining  # noqa: E402
from organization_management.apps.dictionaries.archived import (  # noqa: E402
    ARCHIVED_DICTIONARIES,
)

# Архивные справочники в Admin не показываются: список — в `archived.py`, там
# же причина по каждому. Это единственное место, где показ включается, поэтому
# «спрятали в Admin, забыли в API» здесь невозможно — API их не отдаёт вовсе.
register_remaining("dictionaries", skip=set(ARCHIVED_DICTIONARIES))
