"""GET /api/operations/documents/ — реестр выпущенных документов.

Реестр отвечает на вопрос «какие документы сейчас в силе», и потому по
умолчанию слеп к отозванным: вперемешку они превратили бы его в ленту, где на
один день три строки и не видно, какая настоящая. История — по флагу.

Остальное — общие правила списков раздела: область сужает выборку всегда, чужое
подразделение даёт 403, а порядок задаёт сервер.
"""
from datetime import timedelta

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.document_release import (
    issue_expense_document,
    reissue_expense_document,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/operations/documents/"
ACTOR = "7"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def issue_for(division, days_back=0):
    """Сдать и выпустить день, отстоящий на days_back назад.

    Часы сдвигаются вместе с деловым днём: окно сдачи прошлое не принимает, и
    сдать позавчерашний день «сегодняшними» часами нельзя.
    """
    business_date = TODAY - timedelta(days=days_back)
    at = MORNING - timedelta(days=days_back)
    in_slot(division)
    submit(division, business_date=business_date, at=at)
    with clock.override(at):
        return issue_expense_document(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def reader(name="doc-reader", scope=None):
    return client_for(name, "ORGD", ["document.view"], scope)


def rows(api, **params):
    response = api.get(URL, params)
    assert response.status_code == 200, response.content
    return response.json()["results"]


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(storage, types, division):  # noqa: F811
    assert APIClient().get(URL).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(
    storage, types, division  # noqa: F811
):
    api, _ = client_for("no-perm", "ORGD", ["status.view"])

    assert api.get(URL).status_code == 403


# ── Слепота к отозванным ─────────────────────────────────────────────────


def test_only_documents_in_force_are_listed_by_default(storage, types, division):  # noqa: F811
    first = issue_for(division)
    with clock.override(MORNING):
        second = reissue_expense_document(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="исправлен наряд",
        )
    api, _ = reader()

    listed = rows(api)

    assert [row["id"] for row in listed] == [second.pk]
    assert first.pk not in [row["id"] for row in listed]


def test_the_history_flag_brings_the_withdrawn_ones_back(storage, types, division):  # noqa: F811
    first = issue_for(division)
    with clock.override(MORNING):
        second = reissue_expense_document(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="исправлен наряд",
        )
    api, _ = reader()

    listed = rows(api, history="true")

    assert sorted(row["id"] for row in listed) == sorted([first.pk, second.pk])


# ── Область ──────────────────────────────────────────────────────────────


def test_a_scoped_reader_never_sees_another_divisions_documents(
    storage, types, division  # noqa: F811
):
    """Область сужает выборку ДАЖЕ БЕЗ division_id: без этого «мой реестр» без
    параметров показал бы весь раздел."""
    other = Division.objects.create(name="Чужое управление")
    mine = issue_for(division)
    issue_for(other)
    api, _ = reader(scope=division.id)

    assert [row["id"] for row in rows(api)] == [mine.pk]


def test_asking_for_a_foreign_division_is_refused_rather_than_answered_empty(
    storage, types, division  # noqa: F811
):
    """Пустой ответ неотличим от «там ничего нет» и прячет отказ."""
    other = Division.objects.create(name="Чужое управление")
    issue_for(other)
    api, _ = reader(scope=division.id)

    assert api.get(URL, {"division_id": other.id}).status_code == 403


def test_an_unscoped_reader_sees_every_division(storage, types, division):  # noqa: F811
    other = Division.objects.create(name="Второе управление")
    mine = issue_for(division)
    theirs = issue_for(other)
    api, _ = reader()

    assert sorted(row["id"] for row in rows(api)) == sorted([mine.pk, theirs.pk])


# ── Период ───────────────────────────────────────────────────────────────


def test_the_period_includes_both_of_its_ends(storage, types, division):  # noqa: F811
    """«С 1 по 31 августа» в обиходе означает и первое, и тридцать первое:
    полуоткрытый интервал молча терял бы последний день."""
    earlier = issue_for(division, days_back=2)
    later = issue_for(division)
    api, _ = reader()

    listed = rows(
        api,
        date_from=(TODAY - timedelta(days=2)).isoformat(),
        date_to=TODAY.isoformat(),
    )

    assert sorted(row["id"] for row in listed) == sorted([earlier.pk, later.pk])


def test_a_day_outside_the_period_is_left_out(storage, types, division):  # noqa: F811
    issue_for(division, days_back=2)
    inside = issue_for(division)
    api, _ = reader()

    listed = rows(api, date_from=TODAY.isoformat())

    assert [row["id"] for row in listed] == [inside.pk]


def test_an_unreadable_date_is_a_form_error(storage, types, division):  # noqa: F811
    api, _ = reader()

    assert api.get(URL, {"date_from": "позавчера"}).status_code == 400


# ── Порядок ──────────────────────────────────────────────────────────────


def test_the_server_decides_the_order_and_fresh_days_come_first(
    storage, types, division  # noqa: F811
):
    """ТРИ дня, и заводятся они не по порядку: на двух элементах «порядок задаёт
    сервер» совпало бы с любой клиентской сортировкой, а совпадение с порядком
    создания ничего бы не доказало."""
    middle = issue_for(division, days_back=1)
    oldest = issue_for(division, days_back=3)
    newest = issue_for(division)
    api, _ = reader()

    assert [row["id"] for row in rows(api)] == [newest.pk, middle.pk, oldest.pk]


def test_within_one_day_the_senior_number_comes_first(storage, types, division):  # noqa: F811
    first = issue_for(division)
    with clock.override(MORNING):
        second = reissue_expense_document(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="исправлен наряд",
        )
        third = reissue_expense_document(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="вторая поправка",
        )
    api, _ = reader()

    listed = rows(api, history="true")

    assert [row["id"] for row in listed] == [third.pk, second.pk, first.pk]


# ── Один выпуск ──────────────────────────────────────────────────────────


def test_a_single_document_can_be_read_by_its_id(storage, types, division):  # noqa: F811
    issued = issue_for(division)
    api, _ = reader()

    response = api.get(f"{URL}{issued.pk}/")

    assert response.status_code == 200
    assert response.json()["number"] == issued.number


@pytest.mark.parametrize("junk", ["abc", "999999", "1.5"])
def test_junk_and_missing_ids_answer_the_same_way(storage, types, division, junk):  # noqa: F811
    issue_for(division)
    api, _ = reader()

    assert api.get(f"{URL}{junk}/").status_code == 404


def test_reading_a_foreign_document_by_id_is_refused(storage, types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    foreign = issue_for(other)
    api, _ = reader(scope=division.id)

    assert api.get(f"{URL}{foreign.pk}/").status_code == 403


def test_the_registry_never_carries_the_name_of_the_file_on_disk(
    storage, types, division  # noqa: F811
):
    """То же правило, что у ответа выпуска: ключ хранения — имя файла во
    внутренней локации, и наружу он не выходит ни одним полем."""
    issued = issue_for(division)
    api, _ = reader()

    raw = api.get(URL).content.decode()

    assert str(issued.attachment.storage_key) not in raw
    assert "storage_key" not in raw
