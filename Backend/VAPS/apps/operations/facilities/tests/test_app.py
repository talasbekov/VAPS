from django.apps import apps
from django.conf import settings

from apps.operations.facilities.models import Object, ObjectPassport


def test_ops_facilities_app_installed():
    assert "apps.operations.facilities" in settings.INSTALLED_APPS


def test_ops_facilities_app_config():
    assert apps.get_app_config("ops_facilities").name == "apps.operations.facilities"


def test_object_db_table():
    assert Object._meta.db_table == "ops_objects"


def test_object_passport_db_table():
    assert ObjectPassport._meta.db_table == "ops_object_passports"
