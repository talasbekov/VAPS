"""Story 15.6 — Group: model smoke."""

import pytest

from apps.operations.events.models import Group

pytestmark = pytest.mark.django_db


def test_db_table():
    assert Group._meta.db_table == "ops_groups"


def test_create_and_persist():
    group = Group.objects.create(code="RECON_DOGS", name="Кинология", sort_order=1)
    group.refresh_from_db()
    assert group.name == "Кинология"
    assert group.is_active is True


def test_default_ordering_by_sort_order_then_code():
    Group.objects.create(code="B", name="B", sort_order=2)
    Group.objects.create(code="A", name="A", sort_order=1)
    codes = list(Group.objects.values_list("code", flat=True))
    assert codes == ["A", "B"]
