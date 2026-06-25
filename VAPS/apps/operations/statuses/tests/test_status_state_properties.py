"""Story 3.2 — derived `state` equivalence (AC-3, ARCH-DATA-022).

The ORM annotation (Case/When, SQL) and the Python @property must produce the
SAME lifecycle state for any (interval, cancelled_at, business_date). This is
the architecture's mandatory annotation↔property equivalence test.
"""

import datetime

import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from apps.core import clock
from apps.operations.statuses.models.employee_status import (
    EmployeeStatus,
    derive_state,
)

pytestmark = [pytest.mark.property, pytest.mark.django_db]

_dates = st.dates(
    min_value=datetime.date(2020, 1, 1), max_value=datetime.date(2030, 12, 31)
)


@st.composite
def _rows(draw):
    date_start = draw(_dates)
    span = draw(st.integers(min_value=1, max_value=400))  # date_end > date_start
    date_end = date_start + datetime.timedelta(days=span)
    cancelled = draw(st.booleans())
    business_date = draw(_dates)
    return date_start, date_end, cancelled, business_date


_D1, _D2 = datetime.date(2026, 1, 10), datetime.date(2026, 1, 20)


class TestStateEquivalence:
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    # Pin the half-open boundaries the equivalence MUST guard deterministically
    # (a random date strategy lands on them with ~1/4000 odds otherwise).
    @example((_D1, _D2, False, _D1 - datetime.timedelta(days=1)))  # D<start → PLANNED
    @example((_D1, _D2, False, _D1))  # D==start → ACTIVE (half-open)
    @example((_D1, _D2, False, _D2 - datetime.timedelta(days=1)))  # last ACTIVE day
    @example((_D1, _D2, False, _D2))  # D==end → COMPLETED (half-open)
    @example((_D1, _D2, True, _D1))  # cancelled wins over any date
    @given(_rows())
    def test_annotation_equals_property_equals_canonical(self, row):
        date_start, date_end, cancelled, business_date = row
        cancelled_at = (
            datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
            if cancelled
            else None
        )
        canonical = derive_state(date_start, date_end, cancelled_at, business_date)

        # STUDY is a soft type → no excl_hard_status_overlap when examples pile up.
        obj = EmployeeStatus.objects.create(
            employee_id="22222222-2222-2222-2222-222222222222",
            status_type_code="STUDY",
            date_start=date_start,
            date_end=date_end,
            cancelled_at=cancelled_at,
        )
        annotated = EmployeeStatus.objects.with_state(business_date).get(pk=obj.pk)
        with clock.override(business_date):
            property_value = obj.state

        assert annotated.state_annotation == canonical  # SQL annotation
        assert property_value == canonical  # Python @property
