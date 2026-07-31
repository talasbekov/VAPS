from django.apps import apps
from django.conf import settings

from apps.operations.duties.models import DutyPlan, DutyShift


def test_ops_duties_app_installed():
    assert "apps.operations.duties" in settings.INSTALLED_APPS


def test_ops_duties_app_config():
    assert apps.get_app_config("ops_duties").name == "apps.operations.duties"


def test_duty_plan_db_table():
    assert DutyPlan._meta.db_table == "ops_duty_plans"


def test_duty_shift_db_table():
    assert DutyShift._meta.db_table == "ops_duty_shifts"
