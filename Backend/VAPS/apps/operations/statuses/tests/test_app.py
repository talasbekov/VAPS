from django.apps import apps
from django.conf import settings

from apps.operations.statuses.models import EmployeeStatus, StatusType


def test_ops_statuses_app_installed():
    assert "apps.operations.statuses" in settings.INSTALLED_APPS


def test_ops_statuses_app_config():
    assert apps.get_app_config("ops_statuses").name == "apps.operations.statuses"


def test_employee_status_db_table():
    assert EmployeeStatus._meta.db_table == "ops_employee_statuses"


def test_status_type_db_table():
    assert StatusType._meta.db_table == "ops_status_types"
