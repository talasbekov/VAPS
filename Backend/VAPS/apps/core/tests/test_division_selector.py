import pytest

from apps.core.models import Division, DivisionType, Organization
from apps.core.selectors import CoreDivisionTreeSelector

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    org = Organization.objects.create(name="Главк", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(
        organization=org, type_code=dt, name="root", code="R"
    )
    a = Division.objects.create(
        organization=org, type_code=dt, name="a", code="A", parent=root
    )
    b = Division.objects.create(
        organization=org, type_code=dt, name="b", code="B", parent=root
    )
    a1 = Division.objects.create(
        organization=org, type_code=dt, name="a1", code="A1", parent=a
    )
    return {"root": root, "a": a, "b": b, "a1": a1}


def test_leaf_descendants_returns_only_leaves(tree):
    leaves = CoreDivisionTreeSelector.leaf_descendants(tree["root"].id)
    leaf_ids = {d.id for d in leaves}
    assert leaf_ids == {tree["a1"].id, tree["b"].id}


def test_subtree_ids_includes_self_and_all_descendants(tree):
    ids = CoreDivisionTreeSelector.subtree_ids(tree["root"].id)
    assert ids == {tree["root"].id, tree["a"].id, tree["b"].id, tree["a1"].id}
