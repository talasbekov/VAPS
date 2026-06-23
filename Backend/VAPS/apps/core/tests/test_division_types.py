import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.core.models import DivisionType

pytestmark = pytest.mark.django_db


def test_division_type_code_is_primary_key():
    dt = DivisionType.objects.create(
        code="department", name="Департамент", sort_order=1
    )
    assert dt.pk == "department"


def test_seed_creates_canonical_division_types():
    call_command("seed_core")
    codes = set(DivisionType.objects.values_list("code", flat=True))
    assert {"department", "management", "division", "office", "group"} <= codes


def test_division_type_rejects_negative_sort_order():
    # Story 2.12 / deferred #L193: catalog ordinals must be non-negative.
    with pytest.raises(ValidationError) as exc:
        DivisionType(code="x", name="Тип", sort_order=-1).full_clean(
            validate_unique=False
        )
    assert "sort_order" in exc.value.message_dict


def test_division_type_allows_zero_sort_order():
    DivisionType(code="x", name="Тип", sort_order=0).full_clean(validate_unique=False)
