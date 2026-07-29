from django.apps import apps
from django.conf import settings

from apps.operations.bugreports.models import BugReport


def test_ops_bugreports_app_installed():
    assert "apps.operations.bugreports" in settings.INSTALLED_APPS


def test_ops_bugreports_app_config():
    assert apps.get_app_config("ops_bugreports").name == "apps.operations.bugreports"


def test_bugreport_db_table():
    assert BugReport._meta.db_table == "ops_bug_reports"
