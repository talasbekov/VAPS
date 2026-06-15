import pytest
from django.core.management import call_command

from apps.core.models import Rank

pytestmark = pytest.mark.django_db


def test_rank_code_primary_key_and_index():
    r = Rank.objects.create(
        code="MAJOR", name="Майор", category="officer", rank_index=5
    )
    assert r.pk == "MAJOR"
    assert r.rank_index == 5


def test_seed_creates_ranks_with_indices():
    call_command("seed_core")
    lt = Rank.objects.get(code="LT")
    col = Rank.objects.get(code="COL")
    assert lt.rank_index < col.rank_index
