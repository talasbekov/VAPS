from django.apps import AppConfig


class OperationsConfig(AppConfig):
    """Раздел «Охранные мероприятия» — нативный переезд из Backend/VAPS.

    Стратегия (решение Bratan, 04.08.2026): новый бэк переписывается в старый
    проект по кускам, под идиомы старого проекта, НЕ трогая старую логику.
    Источник порта — Backend/VAPS/apps/operations (+ минимум из apps/core);
    отличия от источника помечены в докстрингах модулей.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "organization_management.apps.operations"
    label = "operations"
    verbose_name = "Охранные мероприятия"
