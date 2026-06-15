import pytest
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
