from django.contrib import admin
from mptt.admin import MPTTModelAdmin
from organization_management.apps.divisions.models import Division


@admin.register(Division)
class DivisionAdmin(MPTTModelAdmin):
    # `is_summary_node` — В СПИСКЕ И ПРАВИМЫЙ ПРЯМО ТАМ (Plane №326): признак
    # заводится администратором, и путь «открыть карточку каждого из 54
    # подразделений» превратил бы разовую настройку в час работы. Фильтр по
    # нему — чтобы ответить на «а кто вообще собирает свод» одним взглядом.
    list_display = ['name', 'code', 'division_type', 'parent', 'is_active', 'is_summary_node', 'order']
    list_filter = ['division_type', 'is_active', 'is_summary_node']
    search_fields = ['name', 'code']
    list_editable = ['order', 'is_active', 'is_summary_node']
    mptt_level_indent = 20

# Показать в Admin всё остальное — решение заказчика 27.08.2026 (Plane №182):
# ручная проверка требует видеть каждую сущность. Настроенные выше admin-классы
# авторегистратор не трогает; см. organization_management/admin_auto.py — там же
# записано, чем это оплачено (правка мимо сервисов и мимо аудита).
from organization_management.admin_auto import register_remaining  # noqa: E402

register_remaining("divisions")
