import pytest
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
