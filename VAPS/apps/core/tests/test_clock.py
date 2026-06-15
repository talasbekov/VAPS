import logging
from datetime import date, datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import IntegrityError

from apps.core import clock
from apps.core.clock import Clock, catchup_plan
from apps.core.models import Watermark

LOCAL_TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)


class TestClockOverride:
    def test_override_with_date_changes_today_local(self):
        # AC-1 verbatim
        with clock.override(date(2026, 6, 1)):
            assert Clock.today_local() == date(2026, 6, 1)

    def test_override_with_date_sets_now_to_local_midnight_in_utc(self):
        with clock.override(date(2026, 6, 1)):
            now = Clock.now()
        assert now.tzinfo is not None
        assert now.utcoffset() == timedelta(0)
        assert now.astimezone(LOCAL_TZ) == datetime(2026, 6, 1, tzinfo=LOCAL_TZ)

    def test_exit_restores_real_clock(self):
        real_today = Clock.today_local()
        with clock.override(date(1999, 1, 1)):
            assert Clock.today_local() == date(1999, 1, 1)
        assert Clock.today_local() == real_today

    def test_nested_override_inner_wins_then_outer_restored(self):
        with clock.override(date(2026, 6, 1)):
            with clock.override(date(2026, 7, 15)):
                assert Clock.today_local() == date(2026, 7, 15)
            assert Clock.today_local() == date(2026, 6, 1)

    def test_override_restores_even_on_exception(self):
        real_today = Clock.today_local()
        with pytest.raises(RuntimeError):
            with clock.override(date(2026, 6, 1)):
                raise RuntimeError("boom")
        assert Clock.today_local() == real_today

    def test_override_with_aware_datetime(self):
        value = datetime(2026, 6, 1, 17, 30, tzinfo=LOCAL_TZ)
        with clock.override(value):
            assert Clock.now() == value
            assert Clock.today_local() == date(2026, 6, 1)

    def test_override_with_aware_datetime_local_date_conversion(self):
        # 22:00 UTC on May 31 is already June 1 in Asia/Qyzylorda (UTC+5).
        value = datetime(2026, 5, 31, 22, 0, tzinfo=dt_timezone.utc)
        with clock.override(value):
            assert Clock.today_local() == date(2026, 6, 1)

    def test_override_with_naive_datetime_raises_typeerror(self):
        with pytest.raises(TypeError):
            with clock.override(datetime(2026, 6, 1, 12, 0)):
                pass

    def test_override_with_non_utc_datetime_normalizes_now_to_utc(self):
        value = datetime(2026, 6, 1, 17, 30, tzinfo=LOCAL_TZ)
        with clock.override(value):
            now = Clock.now()
        assert now == value  # same instant
        assert now.utcoffset() == timedelta(0)  # but expressed in UTC


class TestClockReal:
    def test_now_is_aware_utc(self):
        now = Clock.now()
        assert now.utcoffset() is not None
        assert now.utcoffset() == timedelta(0)

    def test_today_local_matches_now_in_local_tz(self):
        # Two independent reads can straddle local midnight — accept either.
        before = Clock.now()
        today = Clock.today_local()
        after = Clock.now()
        assert today in {
            before.astimezone(LOCAL_TZ).date(),
            after.astimezone(LOCAL_TZ).date(),
        }


class TestCatchupPlan:
    def test_watermark_behind_today_returns_chronological_dates(self):
        d = date(2026, 6, 1)
        plan = catchup_plan(watermark=d, today=d + timedelta(days=3))
        assert plan == [
            date(2026, 6, 2),
            date(2026, 6, 3),
            date(2026, 6, 4),
        ]

    def test_watermark_equals_today_returns_empty(self):
        d = date(2026, 6, 1)
        assert catchup_plan(watermark=d, today=d) == []

    def test_today_behind_watermark_returns_empty_and_alerts(self, caplog):
        # AC-2 verbatim: clock behind watermark -> empty plan + ERROR alert
        d = date(2026, 6, 1)
        with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
            plan = catchup_plan(watermark=d, today=d - timedelta(days=1))
        assert plan == []
        errors = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert "clock behind watermark" in errors[0].getMessage()

    def test_none_watermark_returns_empty_without_alert(self, caplog):
        with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
            plan = catchup_plan(watermark=None, today=date(2026, 6, 1))
        assert plan == []
        assert [r for r in caplog.records if r.levelno >= logging.ERROR] == []

    def test_datetime_arguments_raise_typeerror(self):
        # datetime IS-A date: Clock.now() passed by mistake must fail loudly,
        # not truncate the partial day and leak datetimes into the plan.
        d = date(2026, 6, 1)
        dt_value = datetime(2026, 6, 4, 12, 0, tzinfo=dt_timezone.utc)
        with pytest.raises(TypeError):
            catchup_plan(watermark=d, today=dt_value)
        with pytest.raises(TypeError):
            catchup_plan(watermark=dt_value, today=d)


@pytest.mark.django_db
class TestWatermarkModel:
    def test_create_with_key_and_date(self):
        wm = Watermark.objects.create(
            key="status_effects", last_materialized_date=date(2026, 6, 1)
        )
        assert wm.pk is not None
        assert wm.last_materialized_date == date(2026, 6, 1)
        assert wm.updated_at is not None

    def test_duplicate_key_raises_integrity_error(self):
        Watermark.objects.create(
            key="status_effects", last_materialized_date=date(2026, 6, 1)
        )
        with pytest.raises(IntegrityError):
            Watermark.objects.create(
                key="status_effects", last_materialized_date=date(2026, 6, 2)
            )
