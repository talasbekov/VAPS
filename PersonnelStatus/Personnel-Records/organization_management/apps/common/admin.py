"""Django Admin: карточка пользователя.

Здесь было четыре админки старого каталога ролей (`Role`, `Permission`,
`RolePermission`, `UserRole`) и inline роли в карточке User. Каталог снесён
(Plane №352, Ш-6) — админки ушли вместе с моделями. Роли раздела ОМ
раздаются экраном «Система → Роли», а не через Django Admin.
"""
from django.contrib import admin
from django.contrib.auth.models import User
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin


class EmployeeInline(admin.StackedInline):
    """Inline для отображения сотрудника в админке User"""
    from organization_management.apps.employees.models import Employee
    model = Employee
    can_delete = False
    verbose_name = 'Сотрудник'
    verbose_name_plural = 'Информация о сотруднике'
    fk_name = 'user'
    fields = ('personnel_number', 'last_name', 'first_name', 'middle_name', 'iin', 'rank', 'employment_status')
    readonly_fields = ('personnel_number', 'last_name', 'first_name', 'middle_name', 'iin', 'rank', 'employment_status')
    extra = 0
    max_num = 1

    def has_add_permission(self, request, obj=None):
        """Запрещаем добавление через inline (должно быть создано отдельно)"""
        return False


class CustomUserAdmin(BaseUserAdmin):
    """Карточка User с сотрудником.

    Столбца «Роль» здесь больше нет: роль у человека не одна, их сколько
    угодно и у каждой своя область — в столбец списка это не помещается, а
    первая из нескольких врала бы. Состав ролей виден в «Система → Роли».
    """
    inlines = (EmployeeInline,)

    list_display = BaseUserAdmin.list_display + ('get_employee',)

    def get_employee(self, obj):
        """Получить информацию о сотруднике"""
        if hasattr(obj, 'employee'):
            emp = obj.employee
            return f'{emp.last_name} {emp.first_name} ({emp.personnel_number})'
        return '-'

    get_employee.short_description = 'Сотрудник'


# Перерегистрируем User с нашей кастомной админкой
admin.site.unregister(User)
admin.site.register(User, CustomUserAdmin)

# Показать в Admin всё остальное — решение заказчика 27.08.2026 (Plane №182):
# ручная проверка требует видеть каждую сущность. Настроенные выше admin-классы
# авторегистратор не трогает; см. organization_management/admin_auto.py — там же
# записано, чем это оплачено (правка мимо сервисов и мимо аудита).
from organization_management.admin_auto import register_remaining  # noqa: E402

register_remaining("common")
