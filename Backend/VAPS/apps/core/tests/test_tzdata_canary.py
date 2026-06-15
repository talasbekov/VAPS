from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings


def test_qyzylorda_utcoffset_summer():
    tz = ZoneInfo("Asia/Qyzylorda")
    offset = tz.utcoffset(datetime(2025, 7, 1, 12, 0))
    assert offset == timedelta(hours=5), f"Expected +05:00, got {offset}"


def test_qyzylorda_utcoffset_winter():
    tz = ZoneInfo("Asia/Qyzylorda")
    offset = tz.utcoffset(datetime(2025, 1, 15, 12, 0))
    assert offset == timedelta(hours=5), f"Expected +05:00, got {offset}"


def test_django_timezone_settings():
    assert settings.TIME_ZONE == "Asia/Qyzylorda"
    assert settings.USE_TZ is True
