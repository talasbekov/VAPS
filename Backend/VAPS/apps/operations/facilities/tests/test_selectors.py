"""Selector tests (14.1): strict pk canonization + list contract.

The pk canon mirrors DailySubmissionSelector.by_id (reviews 5.8b/5.8c):
canonical ASCII digits only — coercions (float truncation, bool, "+5"/"05"
aliases) must 404, never resolve a DIFFERENT facility.
"""

from decimal import Decimal

import pytest

from apps.core.exceptions import DomainError
from apps.operations.facilities.models import Facility
from apps.operations.facilities.selectors import FacilitySelector

pytestmark = pytest.mark.django_db


def _facility(code, name, **overrides):
    fields = {"code": code, "name": name, "address": "адрес"}
    fields.update(overrides)
    return Facility.objects.create(**fields)


@pytest.mark.parametrize(
    "bad_pk",
    ["12abc", "", "  ", None, "1.5", -1, 999_999, "+5", "05", 1.9, True]
    + [Decimal("2.7")],
)
def test_get_garbage_or_coercible_pk_is_404_not_500(bad_pk):
    # Floats/bools/Decimals would silently truncate through int(); alias
    # spellings ("+5", "05") would fork one resource across many write-URLs.
    with pytest.raises(DomainError) as excinfo:
        FacilitySelector.get(bad_pk)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"
    assert excinfo.value.http_status == 404


def test_float_pk_never_resolves_another_facility():
    facility = _facility("OBJ-1", "Штаб")
    assert facility.pk >= 1
    with pytest.raises(DomainError):
        FacilitySelector.get(float(facility.pk) + 0.9)


def test_get_accepts_int_and_padded_string_pk():
    facility = _facility("OBJ-1", "Штаб")
    assert FacilitySelector.get(facility.pk).pk == facility.pk
    assert FacilitySelector.get(f"  {facility.pk}  ").pk == facility.pk


def test_list_active_only_sorted_by_name_then_id():
    b = _facility("OBJ-B", "Бастион")
    a = _facility("OBJ-A", "Арсенал")
    _facility("OBJ-C", "Цитадель", is_active=False)
    dup = _facility("OBJ-D", "Бастион")  # same name → id is the tie-breaker
    rows = list(FacilitySelector.list(actor="user-14"))
    assert [f.pk for f in rows] == [a.pk, b.pk, dup.pk]
