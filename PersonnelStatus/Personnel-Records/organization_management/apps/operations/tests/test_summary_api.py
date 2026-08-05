"""Маршруты сводки: три действия — три права, область и форма ответа.

Зона вьюхи, а не сервиса (пины, гарды и журнал покрыты test_summary_*.py):
что открывает каждое право, в каком порядке стоят гарды, чем отвечает
отсутствие сводки и что подпись берётся из аутентификации.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.summary_service import assemble_summary
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/operations/daily-summaries/"
REBUILD_URL = URL + "rebuild/"
FRESHNESS_URL = URL + "freshness/"
ACTOR = "7"


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)
    in_slot(left, iin="800000000001")
    in_slot(right, iin="800000000002")
    return root, left, right


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def amend(division):
    with clock.override(MORNING):
        return amend_day(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )


def assembled(root):
    with clock.override(MORNING):
        return assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR
        )


def client(name, perms, scope_division_id=None):
    api, user = client_for(name, "ROLE", perms, scope_division_id=scope_division_id)
    return api, user


def post(api, url=URL, **body):
    body.setdefault("business_date", TODAY.isoformat())
    with clock.override(MORNING):
        return api.post(url, body, format="json")


# ── Три действия — три права ─────────────────────────────────────────────


def test_assembling_needs_the_generate_right(types, tree):
    """Собрать эшелон и отмечать статусы в своём отделе — разные полномочия."""
    root, left, right = tree
    submit(left)
    submit(right)
    api, _ = client("sa-marker", ["daily_report.mark_update"])

    response = post(api, division_id=root.id)

    assert response.status_code == 403
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 0


def test_assembling_writes_the_summary(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    api, user = client("sa-generator", ["daily_report.generate"])

    response = post(api, division_id=root.id)

    assert response.status_code == 201
    assert response.data["division_id"] == root.id
    assert response.data["version"] == 1
    # Подпись — из аутентификации, а не из тела.
    assert response.data["submitted_by"] == str(user.pk)


def test_the_actor_from_the_body_is_ignored(types, tree):
    """Подпись под сводкой — факт аутентификации, а не присланное имя."""
    root, left, right = tree
    submit(left)
    submit(right)
    api, user = client("sa-gen-actor", ["daily_report.generate"])

    response = post(api, division_id=root.id, actor="999", submitted_by="999")

    assert response.status_code == 201
    assert response.data["submitted_by"] == str(user.pk)


def test_the_right_to_assemble_is_not_the_right_to_rebuild(types, tree):
    """Пересборка вытесняет уже подписанное.

    Общий код со сборкой выдал бы право переписывать сводку каждому, кому
    разрешили её собрать.
    """
    root, left, right = tree
    submit(left)
    submit(right)
    assembled(root)
    api, _ = client("sa-gen2", ["daily_report.generate"])

    response = post(
        api, REBUILD_URL, division_id=root.id, reason="повод", sanction="замечание"
    )

    assert response.status_code == 403
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 1


def test_rebuilding_writes_a_new_version(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assembled(root)
    amend(left)
    api, _ = client("sa-corrector", ["daily_report.correct"])

    response = post(
        api, REBUILD_URL, division_id=root.id, reason="повод", sanction="замечание"
    )

    assert response.status_code == 201
    assert response.data["version"] == 2
    assert response.data["reason"] == "повод"


def test_reading_freshness_needs_only_the_read_right(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assembled(root)
    api, _ = client("sa-reader", ["status.view"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": root.id})

    assert response.status_code == 200
    assert response.data["status"] == "FRESH"


def test_freshness_separates_the_axes(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assembled(root)
    amend(left)
    api, _ = client("sa-reader2", ["status.view"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": root.id})

    assert response.data["status"] == "STALE"
    assert response.data["superseded"] == [
        {"division_id": left.id, "pinned_version": 1, "current_version": 2}
    ]
    assert response.data["missing"] == []
    assert response.data["unpinned"] == []


# ── Отсутствие сводки ────────────────────────────────────────────────────


def test_a_day_without_a_summary_is_404(types, tree):
    root, _, _ = tree
    api, _ = client("sa-reader3", ["status.view"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": root.id})

    assert response.status_code == 404


def test_a_plain_submission_is_not_a_fresh_summary(types, tree):
    """Обычная сдача сводкой не считается.

    Ответить на её свежесть FRESH значило бы объявить свежей сводку,
    которой не существует.
    """
    _, left, _ = tree
    submit(left)
    api, _ = client("sa-reader4", ["status.view"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": left.id})

    assert response.status_code == 404


def test_division_id_is_required_for_freshness(types, tree):
    api, _ = client("sa-reader5", ["status.view"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL)

    assert response.status_code == 400


# ── Область и порядок гардов ─────────────────────────────────────────────


def test_anonymous_403(types, tree):
    root, _, _ = tree

    response = post(APIClient(), division_id=root.id)

    assert response.status_code == 403


def test_a_foreign_division_is_403_not_404(types, tree):
    """Порядок гардов: область раньше существования.

    Обратный сделал бы 404 оракулом существования для чужака.
    """
    root, left, _ = tree
    api, _ = client("sa-scoped", ["status.view"], scope_division_id=left.id)

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": root.id})

    assert response.status_code == 403


def test_an_unknown_division_in_scope_is_404(types, tree):
    root, _, _ = tree
    api, _ = client("sa-admin", ["*"])

    with clock.override(MORNING):
        response = api.get(FRESHNESS_URL, {"division_id": root.id + 10_000})

    assert response.status_code == 404


def test_assembling_a_leaf_is_400(types, tree):
    _, left, _ = tree
    api, _ = client("sa-gen3", ["daily_report.generate"])

    response = post(api, division_id=left.id)

    assert response.status_code == 400


def test_children_not_submitted_is_422_with_laggards(types, tree):
    root, left, right = tree
    api, _ = client("sa-gen4", ["daily_report.generate"])

    response = post(api, division_id=root.id)

    assert response.status_code == 422
    assert response.data["error_code"] == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert sorted(response.data["details"]["laggards"]) == sorted([left.id, right.id])
