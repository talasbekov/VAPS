import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.core.models import Position

pytestmark = pytest.mark.django_db


def test_position_code_primary_key_and_level():
    p = Position.objects.create(
        code="NACH_OTD", name="Начальник отдела", level=3, sort_order=10
    )
    assert p.pk == "NACH_OTD"
    assert p.level == 3


def test_seed_creates_positions():
    call_command("seed_core")
    assert Position.objects.filter(code="OPER").exists()


def test_position_rejects_negative_level():
    # Story 2.12 / deferred #L193: negative level sorts "senior" to level 0 in
    # the roster canon; the Admin edit path (full_clean) must reject it.
    with pytest.raises(ValidationError) as exc:
        Position(code="X", name="Должность", level=-1).full_clean(
            validate_unique=False
        )
    assert "level" in exc.value.message_dict


def test_position_rejects_negative_sort_order():
    with pytest.raises(ValidationError) as exc:
        Position(code="X", name="Должность", sort_order=-1).full_clean(
            validate_unique=False
        )
    assert "sort_order" in exc.value.message_dict


def test_position_allows_zero_ordinals():
    # Zero is the boundary and must pass.
    Position(code="X", name="Должность", level=0, sort_order=0).full_clean(
        validate_unique=False
    )
