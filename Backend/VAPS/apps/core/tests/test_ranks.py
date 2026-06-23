import pytest
from django.core.exceptions import ValidationError
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


def test_rank_rejects_negative_index():
    # Story 2.12 / deferred #L193: catalog ordinals must be non-negative; the
    # Admin edit path (full_clean) rejects a negative rank_index.
    with pytest.raises(ValidationError) as exc:
        Rank(code="X", name="Звание", rank_index=-1).full_clean(validate_unique=False)
    assert "rank_index" in exc.value.message_dict


def test_rank_allows_zero_index():
    Rank(code="X", name="Звание", rank_index=0).full_clean(validate_unique=False)
