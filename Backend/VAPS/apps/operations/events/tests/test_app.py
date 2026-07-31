from django.apps import apps
from django.conf import settings

from apps.operations.events.models import SecurityEvent


def test_ops_events_app_installed():
    assert "apps.operations.events" in settings.INSTALLED_APPS


def test_ops_events_app_config():
    assert apps.get_app_config("ops_events").name == "apps.operations.events"


def test_security_event_db_table():
    assert SecurityEvent._meta.db_table == "ops_security_events"


def test_security_event_status_default_is_draft():
    assert SecurityEvent._meta.get_field("status_code").default == "DRAFT"
