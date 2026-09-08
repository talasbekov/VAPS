"""Нечисловой parent_id в `move` подразделения — Plane №960.

`POST /api/divisions/divisions/{id}/move/` сравнивал `int(parent_id)` с
`instance.id` до какой-либо валидации: нечисловое значение падало
необработанным `ValueError` и превращалось в 500 вместо понятного 400.

Проба стережёт эту границу мутацией: убрать try/except обратно на голый
`int(parent_id)` красит `test_move_rejects_non_numeric_parent_id`, а корректный
числовой parent_id по-прежнему обязан перемещать узел (не даёт зафиксировать
фикс так, что он попутно ломает рабочий сценарий).
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division

pytestmark = pytest.mark.django_db

DivisionType = Division.DivisionType


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(get_user_model().objects.create_user("division-move-reader"))
    return client


@pytest.fixture
def tree():
    root = Division.objects.create(name="Корень", division_type=DivisionType.ORGANIZATION, code="MV-ROOT")
    branch_a = Division.objects.create(
        name="Ветка А", division_type=DivisionType.DEPARTMENT, parent=root, code="MV-A"
    )
    branch_b = Division.objects.create(
        name="Ветка Б", division_type=DivisionType.DEPARTMENT, parent=root, code="MV-B"
    )
    return root, branch_a, branch_b


def move_url(division):
    return f"/api/divisions/divisions/{division.id}/move/"


def test_move_rejects_non_numeric_parent_id(api, tree):
    _root, branch_a, _branch_b = tree

    response = api.post(move_url(branch_a), {"parent_id": "abc"}, format="json")

    assert response.status_code == 400
    assert response.json().get("detail")


def test_move_accepts_numeric_parent_id(api, tree):
    _root, branch_a, branch_b = tree

    response = api.post(move_url(branch_a), {"parent_id": branch_b.id}, format="json")

    assert response.status_code == 200
    branch_a.refresh_from_db()
    assert branch_a.parent_id == branch_b.id
