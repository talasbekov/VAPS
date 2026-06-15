from datetime import date, datetime, timezone as dt_timezone

import pytest

from apps.migration_legacy.transform import (
    DONOR_STATUS_TYPE_MAP,
    EmployeeRow,
    Skip,
    StatusRow,
    count_staff_slots,
    transform_employee,
    transform_status,
)

WINDOW_START = date(2026, 6, 1)
WINDOW_END = date(2026, 6, 7)


def status_fields(**overrides):
    fields = {
        "employee": 1,
        "status_type": "vacation",
        "state": "active",
        "start_date": "2026-06-02",
        "end_date": "2026-06-05",
        "actual_end_date": None,
        "updated_at": "2026-06-05T10:00:00Z",
    }
    fields.update(overrides)
    return fields


def employee_fields(**overrides):
    fields = {
        "personnel_number": "PN001",
        "last_name": "Иванов",
        "first_name": "Иван",
        "middle_name": "Иванович",
        "birth_date": "1985-01-01",
        "gender": "M",
        "iin": "850101300101",
        "rank": 1,
        "hire_date": "2010-01-01",
        "dismissal_date": None,
        "employment_status": "working",
    }
    fields.update(overrides)
    return fields


def transform(**overrides):
    return transform_status(status_fields(**overrides), WINDOW_START, WINDOW_END)


class TestStatusTypeMapping:
    # All 12 donor codes: 11 mapped + in_service (derived, never imported).
    @pytest.mark.parametrize(
        ("donor_code", "target_code"),
        [
            ("vacation", "VACATION"),
            ("leave_by_report", "LEAVE_BY_REPORT"),
            ("sick_leave", "SICK_LEAVE"),
            ("business_trip", "COMMAND"),
            ("training", "STUDY"),
            ("competition", "COMPETITION"),
            ("other_absence", "OTHER_ABSENCE"),
            ("on_duty", "DUTY"),
            ("after_duty", "REST_AFTER_DUTY"),
            ("seconded_from", "ATTACHED"),
            ("seconded_to", "DETACHED"),
        ],
    )
    def test_mapped_codes(self, donor_code, target_code):
        assert DONOR_STATUS_TYPE_MAP[donor_code] == target_code
        row = transform(status_type=donor_code)
        assert isinstance(row, StatusRow)
        assert row.status_type_code == target_code

    def test_map_has_exactly_eleven_codes(self):
        assert len(DONOR_STATUS_TYPE_MAP) == 11
        assert "in_service" not in DONOR_STATUS_TYPE_MAP

    def test_in_service_skipped_as_derived(self):
        assert transform(status_type="in_service") == Skip("in_service_derived")

    def test_unknown_type_skipped(self):
        assert transform(status_type="mystery") == Skip("unknown_status_type")


class TestDateConversion:
    def test_inclusive_donor_end_becomes_half_open_plus_one_day(self):
        # Donor vacation 01.06–14.06 inclusive == VAPS [2026-06-01, 2026-06-15).
        row = transform_status(
            status_fields(start_date="2026-06-01", end_date="2026-06-14"),
            WINDOW_START,
            date(2026, 6, 30),
        )
        assert isinstance(row, StatusRow)
        assert row.date_start == date(2026, 6, 1)
        assert row.date_end == date(2026, 6, 15)

    def test_one_day_status_is_valid(self):
        row = transform(start_date="2026-06-03", end_date="2026-06-03")
        assert isinstance(row, StatusRow)
        assert row.date_start == date(2026, 6, 3)
        assert row.date_end == date(2026, 6, 4)

    def test_actual_end_date_wins_when_completed(self):
        row = transform(
            state="completed",
            start_date="2026-06-01",
            end_date="2026-06-06",
            actual_end_date="2026-06-03",
        )
        assert isinstance(row, StatusRow)
        assert row.date_end == date(2026, 6, 4)

    def test_actual_end_date_ignored_when_not_completed(self):
        row = transform(
            state="active",
            start_date="2026-06-01",
            end_date="2026-06-06",
            actual_end_date="2026-06-03",
        )
        assert isinstance(row, StatusRow)
        assert row.date_end == date(2026, 6, 7)

    def test_completed_without_actual_end_uses_end_date(self):
        row = transform(
            state="completed",
            start_date="2026-06-01",
            end_date="2026-06-06",
            actual_end_date=None,
        )
        assert isinstance(row, StatusRow)
        assert row.date_end == date(2026, 6, 7)

    def test_open_end_clamped_to_window_end_plus_one(self):
        row = transform(start_date="2026-06-03", end_date=None)
        assert isinstance(row, StatusRow)
        assert row.date_end == date(2026, 6, 8)  # WINDOW_END + 1 day
        assert row.open_end_clamped is True

    def test_closed_end_not_flagged_as_clamped(self):
        row = transform()
        assert isinstance(row, StatusRow)
        assert row.open_end_clamped is False

    def test_degenerate_dates_skipped(self):
        # Donor end before start: empty/negative interval after conversion.
        assert transform(start_date="2026-06-05", end_date="2026-06-03") == Skip(
            "invalid_dates"
        )

    def test_completed_actual_end_before_start_skipped(self):
        assert transform(
            state="completed",
            start_date="2026-06-05",
            end_date="2026-06-06",
            actual_end_date="2026-06-03",
        ) == Skip("invalid_dates")


class TestWindowFilter:
    def test_status_ending_exactly_at_window_start_included(self):
        row = transform(start_date="2026-05-20", end_date="2026-06-01")
        assert isinstance(row, StatusRow)

    def test_status_starting_at_window_end_included(self):
        row = transform(start_date="2026-06-07", end_date="2026-06-09")
        assert isinstance(row, StatusRow)

    def test_status_ending_before_window_start_skipped(self):
        assert transform(start_date="2026-05-20", end_date="2026-05-31") == Skip(
            "out_of_window"
        )

    def test_status_starting_after_window_end_skipped(self):
        assert transform(start_date="2026-06-08", end_date="2026-06-09") == Skip(
            "out_of_window"
        )

    def test_window_uses_effective_end(self):
        # Completed early before the window: actual_end_date decides.
        assert transform(
            state="completed",
            start_date="2026-05-20",
            end_date="2026-06-03",
            actual_end_date="2026-05-25",
        ) == Skip("out_of_window")

    def test_open_end_always_reaches_window(self):
        row = transform(start_date="2026-05-01", end_date=None)
        assert isinstance(row, StatusRow)


class TestCancelledAndEmployee:
    def test_cancelled_state_sets_cancelled_at_from_updated_at(self):
        row = transform(state="cancelled", updated_at="2026-06-05T10:00:00Z")
        assert isinstance(row, StatusRow)
        assert row.cancelled_at == datetime(2026, 6, 5, 10, 0, tzinfo=dt_timezone.utc)

    def test_non_cancelled_state_leaves_cancelled_at_none(self):
        assert transform(state="active").cancelled_at is None
        assert transform(state="completed").cancelled_at is None

    def test_cancelled_with_unparseable_updated_at_is_best_effort_none(self):
        row = transform(state="cancelled", updated_at="not-a-date")
        assert isinstance(row, StatusRow)
        assert row.cancelled_at is None

    def test_missing_employee_skipped(self):
        assert transform(employee=None) == Skip("no_employee")

    def test_employee_pk_carried(self):
        assert transform(employee=42).employee_pk == 42


class TestTransformEmployee:
    def test_valid_employee(self):
        row = transform_employee(employee_fields())
        assert isinstance(row, EmployeeRow)
        assert row.iin == "850101300101"
        assert row.personnel_number == "PN001"
        assert row.last_name == "Иванов"
        assert row.first_name == "Иван"
        assert row.middle_name == "Иванович"
        assert row.birth_date == date(1985, 1, 1)
        assert row.gender == "M"
        assert row.hire_date == date(2010, 1, 1)
        assert row.dismissal_date is None
        assert row.rank_pk == 1

    def test_employment_status_mapping(self):
        assert transform_employee(employee_fields()).employment_status == "WORKING"
        fired = transform_employee(employee_fields(employment_status="fired"))
        assert fired.employment_status == "FIRED"

    def test_missing_iin_skipped(self):
        assert transform_employee(employee_fields(iin=None)) == Skip("missing_iin")
        assert transform_employee(employee_fields(iin="")) == Skip("missing_iin")

    @pytest.mark.parametrize(
        "bad_iin",
        ["123", "12345678901a", "1234567890123", " 50101300101", "85010130010"],
    )
    def test_invalid_iin_skipped(self, bad_iin):
        assert transform_employee(employee_fields(iin=bad_iin)) == Skip("invalid_iin")

    def test_rank_may_be_absent(self):
        assert transform_employee(employee_fields(rank=None)).rank_pk is None


def staff_unit(pk, division, employee=None):
    return {
        "model": "staff_unit.staffunit",
        "pk": pk,
        "fields": {"division": division, "position": None, "employee": employee},
    }


class TestCountStaffSlots:
    def test_counts_every_slot_with_division_including_vacant(self):
        # Vacant slots (employee=None) ARE the donor's vacancies — counted.
        counts, skips = count_staff_slots(
            [
                staff_unit(1, division=2, employee=10),
                staff_unit(2, division=2),
                staff_unit(3, division=3, employee=11),
            ]
        )
        assert counts == {2: 2, 3: 1}
        assert skips == {"slot_no_division": []}

    def test_slot_without_division_goes_to_skips(self):
        counts, skips = count_staff_slots(
            [staff_unit(1, division=None), staff_unit(2, division=5)]
        )
        assert counts == {5: 1}
        assert skips == {"slot_no_division": [1]}

    def test_empty_input(self):
        assert count_staff_slots([]) == ({}, {"slot_no_division": []})


class TestDirtyInput:
    # Donor dirt must become a reported skip, never a crash that aborts
    # the whole import transaction (review findings of 1.6).

    def test_missing_start_date_skipped(self):
        assert transform(start_date=None) == Skip("invalid_dates")

    @pytest.mark.parametrize("bad_date", ["31.05.2026", "2026-13-01", 20260601])
    def test_malformed_start_date_skipped(self, bad_date):
        assert transform(start_date=bad_date) == Skip("invalid_dates")

    def test_malformed_end_date_skipped(self):
        assert transform(end_date="not-a-date") == Skip("invalid_dates")

    def test_malformed_actual_end_date_skipped(self):
        assert transform(state="completed", actual_end_date="06/04/2026") == Skip(
            "invalid_dates"
        )

    def test_cancelled_with_non_string_updated_at_is_best_effort_none(self):
        row = transform(state="cancelled", updated_at=12345)
        assert isinstance(row, StatusRow)
        assert row.cancelled_at is None

    @pytest.mark.parametrize("unknown", ["suspended", "WORKING", None, ""])
    def test_unknown_employment_status_skipped(self, unknown):
        assert transform_employee(employee_fields(employment_status=unknown)) == Skip(
            "unknown_employment_status"
        )

    def test_non_string_iin_skipped(self):
        assert transform_employee(employee_fields(iin=850101300101)) == Skip(
            "invalid_iin"
        )

    def test_iin_with_trailing_newline_skipped(self):
        # re.match with "$" lets "...\n" through; fullmatch must not.
        assert transform_employee(employee_fields(iin="850101300101\n")) == Skip(
            "invalid_iin"
        )

    def test_malformed_employee_date_skipped(self):
        assert transform_employee(employee_fields(birth_date="bad")) == Skip(
            "invalid_dates"
        )
