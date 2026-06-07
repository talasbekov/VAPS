from django.conf import settings


def test_timezone_is_qyzylorda():
    assert settings.TIME_ZONE == "Asia/Qyzylorda"
    assert settings.USE_TZ is True


def test_core_app_installed():
    assert "apps.core" in settings.INSTALLED_APPS
