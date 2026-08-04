"""Чтение сдач: GET /api/operations/daily-submissions/ и /{id}/.

Зона вьюхи и селектора: право чтения (status.view, НЕ право записи), область
видимости у списка и у точечного чтения, дефолт «только действующие версии»,
полный порядок, отсутствие снимка в списке и его присутствие в детали.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    submitted,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

URL = "/api/operations/daily-submissions/"
READ_PERMS = ["status.view"]

LIST_FIELDS = {
    "id", "division_id", "business_date", "version", "is_current",
    "event", "submitted_by", "submitted_at", "late",
}


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def other_division():
    return Division.objects.create(name="Управление 2")


def get(api, url=URL, **params):
    with clock.override(TODAY):
        return api.get(url, params)


def detail_url(submission_id):
    return f"{URL}{submission_id}/"


def amend_row(division, business_date=TODAY, version=2):
    """Вытеснить текущую версию новой — как это делает поправка."""
    OpsDailySubmission.objects.filter(
        division_id=division.id, business_date=business_date, is_current=True
    ).update(is_current=False)
    row = submitted(division, business_date, version=version)
    row.event = OpsDailySubmission.Event.AMENDED
    row.reason = "ошибка"
    row.sanction = "замечание"
    row.save(update_fields=["event", "reason", "sanction"])
    return row


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    submitted(division, TODAY)
    assert_denied_by_gate(get(APIClient()))


def test_viewer_reads_without_any_write_right(types, division):
    # Наблюдатель не обязан иметь права отмечать: чтение под status.view.
    api, _ = client_for("read-viewer", "VIEWER", READ_PERMS)
    submitted(division, TODAY)
    response = get(api)
    assert response.status_code == 200
    assert response.data["count"] == 1


@pytest.mark.parametrize(
    "perm", ["daily_report.mark_update", "daily_report.correct"]
)
def test_write_rights_alone_do_not_open_reading(types, division, perm):
    api, _ = client_for(f"read-writer-{perm}", "WRITER", [perm])
    row = submitted(division, TODAY)
    assert_denied_by_gate(get(api))
    assert_denied_by_gate(get(api, detail_url(row.pk)))


# ── Область видимости ────────────────────────────────────────────────────

def test_list_shows_only_the_actors_divisions(types, division, other_division):
    api, _ = client_for(
        "read-scoped", "VIEWER", READ_PERMS, scope_division_id=division.id
    )
    mine = submitted(division, TODAY)
    submitted(other_division, TODAY)
    response = get(api)
    assert [row["id"] for row in response.data["results"]] == [mine.pk]


def test_foreign_division_filter_is_403_not_empty(types, division, other_division):
    # Пустой ответ неотличим от «там не сдавали» и прятал бы отказ.
    api, _ = client_for(
        "read-foreign", "VIEWER", READ_PERMS, scope_division_id=division.id
    )
    submitted(other_division, TODAY)
    assert get(api, division_id=other_division.id).status_code == 403


def test_detail_of_a_foreign_division_is_403_envelope(
    types, division, other_division
):
    api, _ = client_for(
        "read-foreign-detail", "VIEWER", READ_PERMS, scope_division_id=division.id
    )
    row = submitted(other_division, TODAY)
    response = get(api, detail_url(row.pk))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert "snapshot" not in response.data


def test_subtree_is_visible_to_the_parent(types):
    parent = Division.objects.create(name="Управление")
    child = Division.objects.create(name="Отдел", parent=parent)
    api, _ = client_for(
        "read-subtree", "VIEWER", READ_PERMS, scope_division_id=parent.id
    )
    row = submitted(child, TODAY)
    response = get(api)
    assert [entry["id"] for entry in response.data["results"]] == [row.pk]


# ── Что попадает в список ────────────────────────────────────────────────

def test_only_current_versions_by_default(types, division):
    # Иначе спросивший «кто сдал за 4 августа» получил бы вытесненные
    # заявления вперемешку с действующими.
    submitted(division, TODAY)
    head = amend_row(division)
    api, _ = client_for("read-current", "ADMIN", ["*"])
    response = get(api)
    assert [row["id"] for row in response.data["results"]] == [head.pk]
    assert response.data["count"] == 1


def test_history_flag_opens_the_previous_versions(types, division):
    first = submitted(division, TODAY)
    head = amend_row(division)
    api, _ = client_for("read-history", "ADMIN", ["*"])
    response = get(api, history="true")
    assert [row["id"] for row in response.data["results"]] == [head.pk, first.pk]


def test_broken_flag_is_400_not_a_silent_no(types, division):
    api, _ = client_for("read-flag", "ADMIN", ["*"])
    submitted(division, TODAY)
    response = get(api, history="yes")
    assert response.status_code == 400
    assert "history" in response.data


def test_filters_narrow_the_list(types, division, other_division):
    api, _ = client_for("read-filters", "ADMIN", ["*"])
    today_row = submitted(division, TODAY)
    submitted(division, TODAY - timedelta(days=1))
    submitted(other_division, TODAY)
    by_day = get(api, business_date=TODAY.isoformat())
    assert {row["id"] for row in by_day.data["results"]} == {
        today_row.pk,
        OpsDailySubmission.objects.get(
            division_id=other_division.id, business_date=TODAY
        ).pk,
    }
    by_division = get(api, division_id=division.id)
    assert {row["division_id"] for row in by_division.data["results"]} == {
        division.id
    }


def test_broken_date_is_400(types, division):
    api, _ = client_for("read-date", "ADMIN", ["*"])
    response = get(api, business_date="вчера")
    assert response.status_code == 400
    assert "business_date" in response.data


# ── Порядок и страницы ───────────────────────────────────────────────────

def test_server_orders_by_day_then_version(types, division):
    # Три элемента: на двух «порядок задаёт сервер» доказать нечем.
    api, _ = client_for("read-order", "ADMIN", ["*"])
    older = submitted(division, TODAY - timedelta(days=1))
    first = submitted(division, TODAY)
    head = amend_row(division)
    response = get(api, history="true")
    assert [row["id"] for row in response.data["results"]] == [
        head.pk,
        first.pk,
        older.pk,
    ]


def test_pages_do_not_lose_or_repeat_rows(types, division):
    api, _ = client_for("read-pages", "ADMIN", ["*"])
    expected = {
        submitted(division, TODAY - timedelta(days=offset)).pk for offset in range(7)
    }
    seen = []
    for offset in range(0, 7, 2):
        page = get(api, limit=2, offset=offset)
        seen.extend(row["id"] for row in page.data["results"])
    assert sorted(seen) == sorted(expected)
    assert len(seen) == len(set(seen))


# ── Снимок: где он есть и где его нет ────────────────────────────────────

def test_list_carries_no_snapshot_and_does_not_even_fetch_it(types, division):
    api, _ = client_for("read-nosnap", "ADMIN", ["*"])
    submitted(
        division,
        TODAY,
        snapshot={"schema_version": 1, "roster": [{"employee_id": 1}], "rows": []},
    )
    with CaptureQueriesContext(connection) as captured:
        response = get(api)
    assert set(response.data["results"][0]) == LIST_FIELDS
    # Тяжёлая колонка не выбирается вовсе: сериализатор без неё ещё не
    # гарантирует, что страница не вытащила мегабайты из базы.
    selects = [
        query["sql"]
        for query in captured.captured_queries
        if "ops_daily_submissions" in query["sql"] and "SELECT" in query["sql"]
    ]
    assert selects
    assert not any("snapshot" in sql for sql in selects), selects


def test_detail_carries_the_snapshot_and_the_amendment_fields(types, division):
    api, _ = client_for("read-detail", "ADMIN", ["*"])
    snapshot = {
        "schema_version": 1,
        "roster": [{"employee_id": 7, "full_name": "Иванов И.", "rank": "капитан"}],
        "rows": [],
    }
    row = submitted(division, TODAY, snapshot=snapshot)
    response = get(api, detail_url(row.pk))
    assert response.status_code == 200
    assert set(response.data) == LIST_FIELDS | {
        "snapshot", "reason", "sanction", "triggered_by_status_id",
    }
    assert response.data["snapshot"] == snapshot


def test_detail_returns_the_requested_version_not_the_head(types, division):
    # Щит доказывает КОНКРЕТНОЕ заявление: подстановка головы означала бы,
    # что ссылка на вытесненную версию показывает не то, что подписано.
    api, _ = client_for("read-stale", "ADMIN", ["*"])
    first = submitted(division, TODAY)
    amend_row(division)
    response = get(api, detail_url(first.pk))
    assert response.data["id"] == first.pk
    assert response.data["version"] == 1
    assert response.data["is_current"] is False


@pytest.mark.parametrize("pk", ["не-число", "999999"])
def test_unknown_detail_is_404_envelope(types, division, pk):
    api, _ = client_for(f"read-404-{pk}", "ADMIN", ["*"])
    response = get(api, detail_url(pk))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"
