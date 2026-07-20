"""Selector tests for SectorSelector/PostSelector (14.2, AC-7)."""

import pytest

from apps.core.exceptions import DomainError
from apps.operations.facilities.models import Facility, Post, PostType, Sector
from apps.operations.facilities.selectors import PostSelector, SectorSelector

pytestmark = pytest.mark.django_db


@pytest.fixture
def facility():
    return Facility.objects.create(code="OBJ-1", name="Резиденция", address="а")


@pytest.fixture
def fixed_type():
    return PostType.objects.get_or_create(code="FIXED", defaults={"name": "Пост"})[0]


@pytest.mark.parametrize("bad_pk", ["x", None, 1.9, True, "+5", "05", 999_999])
def test_sector_get_garbage_pk_404(bad_pk):
    with pytest.raises(DomainError) as excinfo:
        SectorSelector.get(bad_pk)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


@pytest.mark.parametrize("bad_pk", ["x", None, 1.9, True, 999_999])
def test_post_get_garbage_pk_404(bad_pk):
    with pytest.raises(DomainError) as excinfo:
        PostSelector.get(bad_pk)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


def test_sector_list_ordering_and_active_only(facility):
    b = Sector.objects.create(facility=facility, name="Б-сектор", sort_order=1)
    a = Sector.objects.create(facility=facility, name="А-сектор", sort_order=1)
    first = Sector.objects.create(facility=facility, name="Приоритет", sort_order=0)
    Sector.objects.create(facility=facility, name="Выкл", is_active=False)
    rows = list(SectorSelector.list_for_facility("user-14", facility.pk))
    assert [s.pk for s in rows] == [first.pk, a.pk, b.pk]


def test_post_list_ordering_active_only_scoped(facility, fixed_type):
    other = Facility.objects.create(code="OBJ-2", name="Другой", address="б")
    p2 = Post.objects.create(
        facility=facility, code="P-2", name="Пост 2", post_type=fixed_type
    )
    p1 = Post.objects.create(
        facility=facility, code="P-1", name="Пост 1", post_type=fixed_type
    )
    Post.objects.create(
        facility=facility,
        code="P-0",
        name="Выкл",
        post_type=fixed_type,
        is_active=False,
    )
    Post.objects.create(
        facility=other, code="P-1", name="Чужой", post_type=fixed_type
    )
    rows = list(PostSelector.list_for_facility("user-14", facility.pk))
    assert [p.pk for p in rows] == [p1.pk, p2.pk]
