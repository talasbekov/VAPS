from django.apps import apps
from django.conf import settings


def test_migration_legacy_app_installed():
    assert "apps.migration_legacy" in settings.INSTALLED_APPS


def test_migration_legacy_app_config():
    assert apps.get_app_config("migration_legacy").name == "apps.migration_legacy"
