from django.apps import apps
from django.conf import settings

from apps.operations.submissions.models import SubmissionControlSettings


def test_ops_submissions_app_installed():
    assert "apps.operations.submissions" in settings.INSTALLED_APPS


def test_ops_submissions_app_config():
    assert apps.get_app_config("ops_submissions").name == "apps.operations.submissions"


def test_submission_control_settings_db_table():
    assert SubmissionControlSettings._meta.db_table == "ops_submission_control_settings"
