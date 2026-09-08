"""RBAC-граница legacy CRUD оргструктуры (Plane №955).

До этих проб `DivisionViewSet` проверял только факт входа: любая
учётка могла создавать, править, архивировать, восстанавливать
и перемещать узлы. Что можно, решает `orgstructure.manage`; чьи
узлы и родители можно менять — область того же гранта.
"""

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/divisions/divisions/"


@pytest.fixture
def tree():
    root = Division.objects.create(
        name="Организация", code="DIV-WRITE-ROOT",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    own = Division.objects.create(
        name="Свой департамент", code="DIV-WRITE-OWN",
        division_type=Division.DivisionType.DEPARTMENT, parent=root,
    )
    own_leaf = Division.objects.create(
        name="Свой отдел", code="DIV-WRITE-LEAF",
        division_type=Division.DivisionType.DIVISION, parent=own,
    )
    foreign = Division.objects.create(
        name="Чужой департамент", code="DIV-WRITE-FOREIGN",
        division_type=Division.DivisionType.DEPARTMENT, parent=root,
    )
    return {"root": root, "own": own, "own_leaf": own_leaf, "foreign": foreign}


@pytest.mark.parametrize(
    "operation",
    ["create", "put", "patch", "destroy", "restore", "move"],
)
def test_authenticated_user_cannot_mutate_divisions(tree, operation):
    """Красная матрица №955: один `IsAuthenticated` не право."""
    user = get_user_model().objects.create_user(
        username=f"division-no-right-{operation}", password="x"
    )
    api = APIClient()
    api.force_authenticate(user)

    if operation == "create":
        response = api.post(
            URL,
            {
                "name": "Новый отдел", "code": "DIV-WRITE-NEW",
                "division_type": Division.DivisionType.DIVISION,
                "parent": tree["own"].pk,
            },
            format="json",
        )
    elif operation == "put":
        response = api.put(
            f"{URL}{tree['own_leaf'].pk}/",
            {
                "name": "Взлом", "code": tree["own_leaf"].code,
                "division_type": tree["own_leaf"].division_type,
                "parent": tree["own"].pk,
            },
            format="json",
        )
    elif operation == "patch":
        response = api.patch(
            f"{URL}{tree['own_leaf'].pk}/", {"name": "Взлом"}, format="json"
        )
    elif operation == "destroy":
        response = api.delete(f"{URL}{tree['own_leaf'].pk}/")
    elif operation == "restore":
        Division.objects.filter(pk=tree["own_leaf"].pk).update(
            is_active=False, archived_at=timezone.now()
        )
        response = api.post(f"{URL}{tree['own_leaf'].pk}/restore/")
    else:
        response = api.post(
            f"{URL}{tree['own_leaf'].pk}/move/",
            {"parent_id": tree["foreign"].pk},
            format="json",
        )

    assert response.status_code == 403, response.content


def test_scoped_manager_edits_own_node_but_not_a_foreign_node(tree):
    api, _ = client_for(
        "division-scoped-manager", "DIVISION_SCOPED_MANAGER",
        ["orgstructure.manage"], tree["own"].pk,
    )

    own = api.patch(
        f"{URL}{tree['own_leaf'].pk}/", {"name": "Своё новое имя"},
        format="json",
    )
    foreign = api.patch(
        f"{URL}{tree['foreign'].pk}/", {"name": "Чужое новое имя"},
        format="json",
    )
    foreign_put = api.put(
        f"{URL}{tree['foreign'].pk}/",
        {
            "name": "Чужое новое имя", "code": tree["foreign"].code,
            "division_type": tree["foreign"].division_type,
            "parent": tree["root"].pk,
        },
        format="json",
    )

    assert own.status_code == 200, own.content
    assert foreign.status_code == 404, foreign.content
    assert foreign_put.status_code == 404, foreign_put.content


def test_scoped_manager_cannot_create_or_move_outside_its_scope(tree):
    api, _ = client_for(
        "division-parent-manager", "DIVISION_PARENT_MANAGER",
        ["orgstructure.manage"], tree["own"].pk,
    )
    body = {
        "name": "Дочерний отдел", "code": "DIV-WRITE-CHILD",
        "division_type": Division.DivisionType.DIVISION,
    }

    own_create = api.post(URL, {**body, "parent": tree["own"].pk}, format="json")
    foreign_create = api.post(
        URL, {**body, "code": "DIV-WRITE-FOREIGN-CHILD", "parent": tree["foreign"].pk},
        format="json",
    )
    root_create = api.post(
        URL, {**body, "code": "DIV-WRITE-SECOND-ROOT", "parent": None},
        format="json",
    )
    patch_parent = api.patch(
        f"{URL}{tree['own_leaf'].pk}/", {"parent": tree["foreign"].pk},
        format="json",
    )
    move_parent = api.post(
        f"{URL}{tree['own_leaf'].pk}/move/",
        {"parent_id": tree["foreign"].pk}, format="json",
    )

    assert own_create.status_code == 201, own_create.content
    assert foreign_create.status_code == 403, foreign_create.content
    assert root_create.status_code == 403, root_create.content
    assert patch_parent.status_code == 403, patch_parent.content
    assert move_parent.status_code == 403, move_parent.content


def test_global_manager_can_create_a_root_division(tree):
    api, _ = client_for(
        "division-global-manager", "DIVISION_GLOBAL_MANAGER",
        ["orgstructure.manage"], None,
    )

    response = api.post(
        URL,
        {
            "name": "Второй корень", "code": "DIV-WRITE-GLOBAL-ROOT",
            "division_type": Division.DivisionType.ORGANIZATION,
            "parent": None,
        },
        format="json",
    )

    assert response.status_code == 201, response.content
