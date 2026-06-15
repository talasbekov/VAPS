from django.apps import AppConfig


class MigrationLegacyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.migration_legacy"
    label = "migration_legacy"
