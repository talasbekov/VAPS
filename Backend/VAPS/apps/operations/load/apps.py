from django.apps import AppConfig


class OpsLoadConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.operations.load"
    label = "ops_load"
