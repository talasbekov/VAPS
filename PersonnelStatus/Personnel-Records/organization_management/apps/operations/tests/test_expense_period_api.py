"""GET /api/operations/strength-report/period/ — расход за период.

Зона вьюхи (страницы, границы и запрет будущего покрыты test_expense_period):
гейт права, область видимости, обязательность обеих дат и перевод доменных
отказов в коды ответа.

Обе даты обязательны намеренно, и это проверяется отдельно: у однодневного
расхода умолчание «сегодня» осмысленно, а здесь любое умолчание было бы выдумкой
маршрута — спросивший получил бы не тот период, что имел в виду, не узнав об этом.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.expense_period import MAX_PERIOD_DAYS
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

URL = "/api/operations/strength-report/period/"


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def viewer(name="period-viewer", scope=None):
    return client_for(name, "ORGD", ["status.view"], scope)


def get(api, date_from=None, date_to=None, at=MORNING, **params):
    if date_from is not None:
        params["date_from"] = date_from.isoformat()
    if date_to is not None:
        params["date_to"] = date_to.isoformat()
    with clock.override(at):
        return api.get(URL, params)


def pages_of(response):
    return response.json()["pages"]


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(types, division):  # noqa: F811
    assert get(APIClient(), TODAY, TODAY).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(types, division):  # noqa: F811
    api, _ = client_for("no-perm", "ORGD", ["audit.view"])

    assert get(api, TODAY, TODAY).status_code == 403


def test_the_read_permission_is_enough(types, division):  # noqa: F811
    in_slot(division)
    api, _ = viewer()

    assert get(api, TODAY, TODAY).status_code == 200


def test_a_post_is_a_method_error_not_a_denial(types, division):  # noqa: F811
    api, _ = viewer()

    assert api.post(URL).status_code == 405


# ── Обязательность обеих дат ─────────────────────────────────────────────


def test_a_missing_start_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    response = get(api, None, TODAY)

    assert response.status_code == 400
    assert "date_from" in response.json()["details"]


def test_a_missing_end_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    response = get(api, TODAY, None)

    assert response.status_code == 400
    assert "date_to" in response.json()["details"]


def test_both_missing_names_both(types, division):  # noqa: F811
    """Отказ называет ОБА пропущенных параметра: назвав один, маршрут заставил
    бы исправлять запрос по одному кругу на каждую забытую дату."""
    api, _ = viewer()

    details = get(api, None, None).json()["details"]

    assert set(details) == {"date_from", "date_to"}


def test_an_unreadable_date_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    with clock.override(MORNING):
        response = api.get(URL, {"date_from": "позавчера", "date_to": TODAY.isoformat()})

    assert response.status_code == 400


# ── Страницы ─────────────────────────────────────────────────────────────


def test_the_response_carries_a_page_per_date(types, division):  # noqa: F811
    in_slot(division)
    api, _ = viewer()

    pages = pages_of(get(api, TODAY - timedelta(days=2), TODAY))

    assert [page["business_date"] for page in pages] == [
        (TODAY - timedelta(days=2)).isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
        TODAY.isoformat(),
    ]


def test_the_period_is_not_wrapped_in_a_page_envelope(types, division):  # noqa: F811
    """Страничной обёртки нет намеренно: период сам ограничен сверху, и вторая
    нарезка поверх первой заставила бы клиента складывать страницы страниц."""
    in_slot(division)
    api, _ = viewer()

    body = get(api, TODAY, TODAY).json()

    assert set(body) == {"pages"}


# ── Область видимости ────────────────────────────────────────────────────


def test_a_foreign_division_is_refused_rather_than_answered_empty(types, division):  # noqa: F811
    """Пустой ответ неотличим от «там никого нет» и прячет отказ."""
    other = Division.objects.create(name="Чужое управление")
    in_slot(other)
    api, _ = viewer(scope=division.id)

    assert get(api, TODAY, TODAY, division_id=other.id).status_code == 403


def test_the_scope_narrows_the_pages_even_without_a_division(types, division):  # noqa: F811
    """Без этого «мой период» без параметров показал бы весь раздел."""
    other = Division.objects.create(name="Чужое управление")
    in_slot(division)
    in_slot(other)
    in_slot(other)
    api, _ = viewer(scope=division.id)

    page = pages_of(get(api, TODAY, TODAY))[0]

    assert page["totals"]["list_total"] == 1


def test_an_unscoped_viewer_sees_every_division(types, division):  # noqa: F811
    other = Division.objects.create(name="Второе управление")
    in_slot(division)
    in_slot(other)
    api, _ = viewer()

    page = pages_of(get(api, TODAY, TODAY))[0]

    assert page["totals"]["list_total"] == 2


# ── Доменные отказы ──────────────────────────────────────────────────────


def test_an_inverted_range_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    assert get(api, TODAY, TODAY - timedelta(days=1)).status_code == 400


def test_a_range_beyond_the_cap_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    response = get(api, TODAY - timedelta(days=MAX_PERIOD_DAYS), TODAY)

    assert response.status_code == 400
    assert response.json()["details"]["max"] == MAX_PERIOD_DAYS


def test_a_range_reaching_into_the_future_is_a_form_error(types, division):  # noqa: F811
    api, _ = viewer()

    assert get(api, TODAY, TODAY + timedelta(days=1)).status_code == 400


# ── Выгрузка периода ─────────────────────────────────────────────────────

EXPORT_URL = "/api/operations/strength-report/period-export/"


def export(api, date_from=TODAY, date_to=TODAY, at=MORNING, **params):
    if date_from is not None:
        params["date_from"] = date_from.isoformat()
    if date_to is not None:
        params["date_to"] = date_to.isoformat()
    with clock.override(at):
        return api.get(EXPORT_URL, params)


def csv_rows(response):
    text = response.content.decode("utf-8-sig")
    return [line.split(";") for line in text.splitlines() if line]


def test_the_export_is_gated_by_the_same_permission(types, division):  # noqa: F811
    assert export(APIClient()).status_code == 403


def test_the_export_returns_a_row_per_date(types, division):  # noqa: F811
    """СТРОКА НА ДАТУ — та ось, которой у дневного документа нет.

    Три дня, а не два: на двух «строка на дату» неотличимо от «две строки».
    """
    in_slot(division)
    api, _ = viewer()

    rows = csv_rows(export(api, TODAY - timedelta(days=2), TODAY))

    # титул + шапка + три даты
    assert len(rows) == 5
    assert [row[0] for row in rows[2:]] == [
        (TODAY - timedelta(days=2)).isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
        TODAY.isoformat(),
    ]


def test_the_export_carries_no_totals_row(types, division):  # noqa: F811
    """Сложить расходы разных дней не во что: человек в отпуске три дня дал бы
    «три отпуска». Строка «ИТОГО» выглядела бы осмысленной и была бы неверной."""
    in_slot(division)
    api, _ = viewer()

    rows = csv_rows(export(api, TODAY - timedelta(days=1), TODAY))

    assert all("ИТОГО" not in ";".join(row) for row in rows)


def test_the_export_opens_in_excel_the_same_way_the_daily_one_does(types, division):  # noqa: F811
    """Тот же диалект, что у дневного .csv: файлы открывает тот же человек в том
    же Excel, и разойдись они кодировкой — вторая выгрузка открылась бы мусором.

    BOM проверяется по СЫРЫМ байтам: декодированная строка его уже не содержит.
    """
    in_slot(division)
    api, _ = viewer()

    payload = export(api).content

    assert payload.startswith(b"\xef\xbb\xbf")
    assert b";" in payload


def test_the_export_is_sent_as_a_file_named_by_the_period(types, division):  # noqa: F811
    in_slot(division)
    api, _ = viewer()

    response = export(api, TODAY - timedelta(days=1), TODAY)

    disposition = response["Content-Disposition"]
    assert "attachment" in disposition
    assert TODAY.isoformat() in disposition
    assert (TODAY - timedelta(days=1)).isoformat() in disposition


def test_the_export_and_the_screen_answer_with_the_same_days(types, division):  # noqa: F811
    """Разъедься они границей периода — файл показал бы не то, что человек видел
    на экране, и расхождение обнаружилось бы уже в отчёте."""
    in_slot(division)
    api, _ = viewer()

    screen = [page["business_date"] for page in pages_of(get(api, TODAY - timedelta(days=2), TODAY))]
    file_days = [row[0] for row in csv_rows(export(api, TODAY - timedelta(days=2), TODAY))[2:]]

    assert screen == file_days


def test_the_export_obeys_the_same_scope(types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    in_slot(other)
    api, _ = viewer(scope=division.id)

    assert export(api, division_id=other.id).status_code == 403


def test_the_export_refuses_the_same_broken_ranges(types, division):  # noqa: F811
    api, _ = viewer()

    assert export(api, TODAY, TODAY - timedelta(days=1)).status_code == 400
    assert export(api, TODAY, TODAY + timedelta(days=1)).status_code == 400
    assert export(api, None, TODAY).status_code == 400
