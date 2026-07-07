"""Constraint/shape tests for the DailySubmission model (Story 5.2).

5.2 writes no rows of its own (the срез/diff/event are 5.3); these tests build
rows directly with a minimal valid snapshot purely to exercise the DB-level
guarantees — «ровно одна текущая версия на (подразделение, день)» and «версии
различны» — plus the field defaults and the append-once submitted_at contract.
Mirrors the IntegrityError + transaction.atomic() pattern of
test_control_settings.py.
"""

import uuid
from datetime import date

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.operations.submissions.models import DailySubmission

pytestmark = pytest.mark.django_db

_BUSINESS_DATE = date(2026, 6, 29)


def _make(**overrides):
    """Create a DailySubmission with the minimum required fields.

    snapshot defaults to {} (a valid dict, not a real срез — that is 5.3).
    Pass division_id/business_date/version/is_current explicitly when a test
    needs two rows to share — or differ on — a key.
    """
    data = {
        "division_id": uuid.uuid4(),
        "business_date": _BUSINESS_DATE,
        "event": DailySubmission.Event.CONFIRMED_NO_CHANGES,
        "submitted_by": "operator-1",
        "submitted_at": timezone.now(),
    }
    data.update(overrides)
    return DailySubmission.objects.create(**data)


def test_db_table():
    assert DailySubmission._meta.db_table == "ops_daily_submissions"


def test_field_defaults():
    # AC-4: version=1, is_current=True, late=False, snapshot={} out of the box.
    # refresh_from_db so we assert the PERSISTED values, not just ORM defaults.
    row = _make()
    row.refresh_from_db()
    assert row.version == 1
    assert row.is_current is True
    assert row.late is False
    assert row.snapshot == {}


def test_event_choices():
    # AC-4: the three события are defined (AMENDED forward-seeded for 5.4).
    assert set(DailySubmission.Event.values) == {
        "CONFIRMED_NO_CHANGES",
        "CHANGED",
        "AMENDED",
    }


def test_submitted_at_is_not_auto():
    # AC-4 trap: submitted_at must be a plain DateTimeField so 5.3 can set it via
    # Clock (append-once); auto_now_add/auto_now would steal that.
    field = DailySubmission._meta.get_field("submitted_at")
    assert field.auto_now_add is False
    assert field.auto_now is False
    explicit = timezone.now()
    row = _make(submitted_at=explicit)
    row.refresh_from_db()
    assert row.submitted_at == explicit


def test_two_current_versions_same_day_rejected():
    # AC-1: partial-unique (division_id, business_date) WHERE is_current — a
    # second is_current=True for the same day is rejected. Different version so
    # the version-unique constraint is not what trips.
    div = uuid.uuid4()
    _make(division_id=div, version=1, is_current=True)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(division_id=div, version=2, is_current=True)


def test_current_plus_non_current_same_day_ok():
    # AC-1: two versions of one day with distinct is_current (one True, rest
    # False) coexist — the partial-unique only forbids two True.
    div = uuid.uuid4()
    _make(division_id=div, version=1, is_current=False)
    _make(division_id=div, version=2, is_current=True)
    assert DailySubmission.objects.filter(division_id=div).count() == 2


def test_duplicate_version_same_day_rejected():
    # AC-2: unique (division_id, business_date, version) — same version twice for
    # one day is rejected. Both non-current so the partial-unique is not the trip.
    div = uuid.uuid4()
    _make(division_id=div, version=1, is_current=False)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(division_id=div, version=1, is_current=False)


def test_distinct_versions_same_day_ok():
    # AC-2: version=2 for the same (division, day) is valid.
    div = uuid.uuid4()
    _make(division_id=div, version=1, is_current=False)
    _make(division_id=div, version=2, is_current=True)
    assert sorted(
        DailySubmission.objects.filter(division_id=div).values_list(
            "version", flat=True
        )
    ) == [1, 2]


def test_snapshot_stores_documented_fact_rows():
    # AC-3: the documented snapshot form — schema_version + roster (denominator,
    # denormalised ФИО/звание) + interval-fact rows — round-trips through the
    # JSONField. Form finalised by the 5.3a builder; here we only confirm the
    # shape is storable (enforcement of «no derived» is the builder's job).
    employee_id = str(uuid.uuid4())
    snapshot = {
        "schema_version": 1,
        "roster": [
            {
                "employee_id": employee_id,
                "full_name": "Иванов Иван Иванович",
                "rank": "капитан",
            }
        ],
        "rows": [
            {
                "employee_id": employee_id,
                "status_type_code": "DUTY",
                "status_id": 42,
                "date_start": "2026-06-29",
                "date_end": "2026-06-30",
                "source": "USER",
            }
        ],
    }
    row = _make(snapshot=snapshot)
    row.refresh_from_db()
    assert row.snapshot["schema_version"] == 1
    assert row.snapshot["roster"][0]["full_name"] == "Иванов Иван Иванович"
    assert row.snapshot["rows"][0]["status_type_code"] == "DUTY"


# --- Code-review hardening (2026-06-29) --------------------------------------


def test_zero_current_versions_allowed():
    # Review P1: the partial-unique enforces AT MOST one current per day, never
    # AT LEAST one — a day with only non-current versions is valid at the DB
    # level ("ровно одна" is an application invariant, not a DB guarantee).
    div = uuid.uuid4()
    _make(division_id=div, version=1, is_current=False)
    _make(division_id=div, version=2, is_current=False)
    assert DailySubmission.objects.filter(division_id=div, is_current=True).count() == 0


def test_two_current_different_divisions_same_day_ok():
    # Review P3: the partial-unique is per (division, day) — two divisions can
    # each have a current version on the same business_date.
    bd = _BUSINESS_DATE
    _make(division_id=uuid.uuid4(), business_date=bd, is_current=True)
    _make(division_id=uuid.uuid4(), business_date=bd, is_current=True)
    assert (
        DailySubmission.objects.filter(business_date=bd, is_current=True).count() == 2
    )


def test_two_current_different_days_same_division_ok():
    # Review P3: same division, different business_date — both current allowed.
    div = uuid.uuid4()
    _make(division_id=div, business_date=date(2026, 6, 29), is_current=True)
    _make(division_id=div, business_date=date(2026, 6, 30), is_current=True)
    assert DailySubmission.objects.filter(division_id=div, is_current=True).count() == 2


def test_submitted_at_is_required():
    # Review P3: submitted_at is NOT NULL with no default — omitting it is a DB
    # error (append-once contract; 5.3 must always set it via Clock).
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DailySubmission.objects.create(
                division_id=uuid.uuid4(),
                business_date=_BUSINESS_DATE,
                event=DailySubmission.Event.CONFIRMED_NO_CHANGES,
                submitted_by="operator-1",
                # submitted_at intentionally omitted
            )


def test_event_check_covers_event_choices():
    # Review D1 drift-guard: the DB CheckConstraint on event must list exactly
    # Event.values. If a new Event member is added without updating the
    # constraint, inserting it trips chk_daily_submission_event and this reddens.
    # AMENDED additionally requires reason+sanction (5.4a constraint) — supply
    # them so this test exercises chk_daily_submission_event, not the new one.
    for value in DailySubmission.Event.values:
        extra = (
            {"reason": "ретро-правка", "sanction": "санкция-1"}
            if value == "AMENDED"
            else {}
        )
        row = _make(division_id=uuid.uuid4(), event=value, **extra)
        assert row.event == value


# --- 5.4a amendment fields + constraint -------------------------------------


def test_amendment_field_defaults():
    # 5.4a: reason/sanction default "" (not null) so 5.3 create() — which never
    # passes them — stays valid; triggered_by_status_id defaults NULL.
    row = _make()
    row.refresh_from_db()
    assert row.reason == ""
    assert row.sanction == ""
    assert row.triggered_by_status_id is None


def test_amended_requires_reason_and_sanction():
    # 5.4a: chk_daily_submission_amended_requires_reason_sanction — an AMENDED row
    # with both reason and sanction is valid.
    row = _make(event=DailySubmission.Event.AMENDED, reason="r", sanction="s")
    row.refresh_from_db()
    assert row.event == DailySubmission.Event.AMENDED


def test_amended_empty_reason_rejected():
    # 5.4a backstop: AMENDED with empty reason trips the CheckConstraint.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(event=DailySubmission.Event.AMENDED, reason="", sanction="s")


def test_amended_empty_sanction_rejected():
    # 5.4a backstop: AMENDED with empty sanction trips the CheckConstraint.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(event=DailySubmission.Event.AMENDED, reason="r", sanction="")


def test_non_amended_unconstrained_by_reason_sanction():
    # 5.4a: CHANGED/CONFIRMED_NO_CHANGES rows are NOT required to carry
    # reason/sanction — the constraint only binds AMENDED.
    row = _make(event=DailySubmission.Event.CHANGED, reason="", sanction="")
    row.refresh_from_db()
    assert row.event == DailySubmission.Event.CHANGED


def test_amended_whitespace_reason_rejected():
    # 5.4a review п1: the `\S` constraint rejects whitespace-only reason, not just
    # "" — a semantically-empty AMENDED row must not pass the backstop.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(event=DailySubmission.Event.AMENDED, reason="   ", sanction="s")


def test_amended_whitespace_sanction_rejected():
    # 5.4a review п1: whitespace-only sanction (tab) is rejected by `\S` too.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(event=DailySubmission.Event.AMENDED, reason="r", sanction="\t")


def test_empty_event_rejected():
    # Review D1: event="" (the silent default for a no-default CharField on the
    # create() path) is rejected by chk_daily_submission_event.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(division_id=uuid.uuid4(), event="")


def test_bogus_event_rejected():
    # Review D1: a non-vocabulary event value is rejected at the DB level.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(division_id=uuid.uuid4(), event="WHATEVER")


def test_version_zero_rejected():
    # Review D1: version=0 passes the field's auto CHECK (>= 0) but is rejected
    # by chk_daily_submission_version_min (>= 1) — versions start at 1.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _make(division_id=uuid.uuid4(), version=0)
