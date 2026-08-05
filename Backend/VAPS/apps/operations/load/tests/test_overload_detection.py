"""Story 19.2 (FR-32) — detect_overload_days(): агрегатный >3-дневный
детектор перегрузки, чистая функция над Dict[date, Decimal]."""

import datetime
from decimal import Decimal

from apps.operations.load.selectors import detect_overload_days


def d(offset):
    return datetime.date(2026, 8, 1) + datetime.timedelta(days=offset)


def test_exactly_four_consecutive_days_at_threshold_all_flagged():
    """review (Edge Case Hunter): dict вставляется в перемешанном порядке
    и ассерт НЕ оборачивается в `sorted()` — иначе тест не отличит
    "функция сама возвращает отсортированный список" от "возвращает
    что угодно, а sorted() в тесте это маскирует"."""
    day_hours = {
        d(2): Decimal("8"),
        d(0): Decimal("8"),
        d(3): Decimal("8"),
        d(1): Decimal("8"),
    }

    result = detect_overload_days(day_hours)

    assert result == [d(0), d(1), d(2), d(3)]


def test_exactly_three_consecutive_days_not_flagged():
    day_hours = {d(0): Decimal("8"), d(1): Decimal("8"), d(2): Decimal("8")}

    result = detect_overload_days(day_hours)

    assert result == []


def test_five_days_with_dip_in_middle_splits_into_two_short_runs():
    day_hours = {
        d(0): Decimal("8"),
        d(1): Decimal("8"),
        d(2): Decimal("4"),  # dip below threshold
        d(3): Decimal("8"),
        d(4): Decimal("8"),
    }

    result = detect_overload_days(day_hours)

    assert result == []


def test_missing_day_breaks_the_run_same_as_explicit_low_day():
    day_hours = {
        d(0): Decimal("8"),
        d(1): Decimal("8"),
        # d(2) missing entirely — sparse dict, not 0
        d(3): Decimal("8"),
        d(4): Decimal("8"),
    }

    result = detect_overload_days(day_hours)

    assert result == []


def test_boundary_exactly_eight_hours_counts_below_does_not():
    day_hours = {
        d(0): Decimal("8.00"),
        d(1): Decimal("8.00"),
        d(2): Decimal("8.00"),
        d(3): Decimal("7.99"),
    }

    result = detect_overload_days(day_hours)

    assert result == []


def test_two_separate_qualifying_runs_both_included():
    """review (Edge Case Hunter): вставка вперемешку + unwrapped ассерт,
    та же причина, что test_exactly_four_consecutive_days_at_threshold_all_flagged."""
    day_hours = {
        d(6): Decimal("8"),
        d(0): Decimal("8"),
        d(8): Decimal("8"),
        d(2): Decimal("8"),
        # gap at d(4)
        d(5): Decimal("8"),
        d(1): Decimal("8"),
        d(7): Decimal("8"),
        d(3): Decimal("8"),
    }

    result = detect_overload_days(day_hours)

    assert result == [d(0), d(1), d(2), d(3), d(5), d(6), d(7), d(8)]


def test_empty_input_returns_empty_list():
    result = detect_overload_days({})

    assert result == []


def test_custom_threshold_is_honored():
    day_hours = {
        d(0): Decimal("6"),
        d(1): Decimal("6"),
        d(2): Decimal("6"),
        d(3): Decimal("6"),
    }

    assert detect_overload_days(day_hours) == []
    assert detect_overload_days(day_hours, threshold_hours=Decimal("6")) == [
        d(0),
        d(1),
        d(2),
        d(3),
    ]
