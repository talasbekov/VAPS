from django.apps import apps
from django.conf import settings

from apps.operations.submissions.models import (
    DailySubmission,
    SubmissionControlSettings,
)


def test_ops_submissions_app_installed():
    assert "apps.operations.submissions" in settings.INSTALLED_APPS


def test_ops_submissions_app_config():
    assert apps.get_app_config("ops_submissions").name == "apps.operations.submissions"


def test_submission_control_settings_db_table():
    assert SubmissionControlSettings._meta.db_table == "ops_submission_control_settings"


def test_daily_submission_db_table():
    assert DailySubmission._meta.db_table == "ops_daily_submissions"
