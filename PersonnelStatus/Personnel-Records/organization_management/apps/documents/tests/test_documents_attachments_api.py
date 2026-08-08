"""Срез 159: контракт /api/documents/attachments/ поверх старых вложений.

СТРОКА — донорская, МЕТОД — НЕТ, и это надо назвать прямо. В схеме донора по
этому адресу объявлен только POST (загрузка) и GET на {id}/download/;
списочного GET у него нет вовсе. Здесь переносится РЯД полей донорской
проекции Attachment (id, original_name, content_type, size, sha256,
created_at) — она у донора описана как «ответ upload (201) и retrieve-форм», —
а сам список поверх неё заводится заново. Перенос загрузки в этот срез не
входит: правка живёт на старой стороне со своими проверками.

ВСЕ ШЕСТЬ ПОЛЕЙ КОНТРАКТА ИМЕЮТ ИСТОЧНИК — кейсов «поле без источника» здесь
поэтому нет ни одного. `storage_key` наружу НЕ выходит: это имя файла на
диске, и раскладка хранилища клиента не касается.

ОБЛАСТЬ ЗДЕСЬ — ГЛАВНОЕ, и правило берётся не с потолка, а у соседнего
маршрута тех же байт (/api/operations/attachments/{id}/download/): вложение не
знает ни подразделения, ни дня, поэтому право его показать выводится из
ВЫПУСКА, которому байты принадлежат. Список без этого вывода отдавал бы
держателю document.view имена файлов любого управления — то есть протекал бы
ровно там, где выдача байт закрыта. Вложение без выпуска не адресуемо и в
списке не появляется.
"""
import io

import pytest
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.document_release import (
    issue_expense_document,
)
from organization_management.apps.operations.document_service import create_attachment
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

URL = "/api/documents/attachments/"
ACTOR = "7"

CONTRACT_FIELDS = {
    "id",
    "original_name",
    "content_type",
    "size",
    "sha256",
    "created_at",
}


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def issued_in(division):
    in_slot(division)
    submit(division)
    with clock.override(MORNING):
        return issue_expense_document(
            division_id=division.id, business_date=TODAY, actor=ACTOR
        )


@pytest.fixture
def issued(types, division):  # noqa: F811
    return issued_in(division)


def reader(name="doc-list-reader", scope=None):
    return client_for(name, "ORGD", ["document.view"], scope)


def rows(response):
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


def ids(response):
    return {row["id"] for row in rows(response)}


def orphan_attachment():
    """Вложение без выпуска — байты откатившегося выпуска, принятый мусор."""
    return create_attachment(
        source=io.BytesIO(b"osirotevshie bajty"),
        original_name="расход.docx",
        content_type="text/plain",
        actor=ACTOR,
    )


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(storage, issued):
    assert APIClient().get(URL).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(storage, issued):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("attachment-list-no-perm", "ORGD", ["status.view"])

    assert api.get(URL).status_code == 403


def test_the_permission_opens_the_list(storage, issued):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт строки ──────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(storage, issued):
    """Поля пиним точным равенством, а не проверкой «поле присутствует»:
    клиент донора сгенерирован из схемы, и поле сверх контракта разошлось бы
    с ней молча.

    `storage_key` тут не просто лишний ключ: это имя файла на диске, и
    раскладка приватного хранилища наружу выходить не должна.
    """
    api, _ = reader()
    row = rows(api.get(URL))[0]

    assert set(row) == CONTRACT_FIELDS
    assert "storage_key" not in row
    assert "created_by" not in row
    assert "updated_at" not in row


def test_the_row_echoes_the_stored_metadata(storage, issued):
    """Метаданные — единственный источник заголовков скачивания, и список
    обязан показывать ИХ, а не пересчитанные значения."""
    api, _ = reader()
    row = rows(api.get(URL))[0]
    stored = issued.attachment

    assert row["original_name"] == stored.original_name
    assert row["content_type"] == stored.content_type
    assert row["size"] == stored.size
    assert row["sha256"] == stored.sha256
    assert row["size"] > 0


def test_the_listed_id_is_the_one_the_download_route_accepts(storage, issued):
    """Список без пригодного идентификатора бесполезен: клиент берёт строку
    отсюда и идёт за байтами. Отдай мы `storage_key` под именем `id` — обе
    формы выглядели бы одинаково правдоподобно, а скачивание давало бы 404.
    """
    api, _ = reader()
    listed = rows(api.get(URL))[0]

    assert listed["id"] == issued.attachment_id
    assert (
        api.get(f"/api/operations/attachments/{listed['id']}/download/").status_code
        == 200
    )


# ── Область по владельцу байт ────────────────────────────────────────────


def test_attachments_of_a_foreign_division_are_not_listed(storage, types, division):  # noqa: F811
    """Несущий кейс среза: без вывода области из выпуска держатель
    document.view читал бы имена файлов любого управления."""
    mine = issued_in(division)
    other = Division.objects.create(name="Чужое управление")
    foreign = issued_in(other)
    api, _ = reader(scope=division.id)

    listed = ids(api.get(URL))
    assert foreign.attachment_id not in listed
    # Вторая половина обязательна: без неё отказ объяснялся бы отсутствием
    # права вообще, а не областью, и кейс прошёл бы на пустом списке.
    assert mine.attachment_id in listed


def test_an_unscoped_reader_sees_both_divisions(storage, types, division):  # noqa: F811
    """Безскоуповый грант видит всё дерево — иначе кейс выше зеленел бы от
    выборки, которая не показывает ничего и никому."""
    mine = issued_in(division)
    other = Division.objects.create(name="Чужое управление")
    foreign = issued_in(other)
    api, _ = reader(name="doc-list-wide")

    listed = ids(api.get(URL))
    assert {mine.attachment_id, foreign.attachment_id} <= listed


def test_an_attachment_that_belongs_to_no_issue_is_not_listed(storage, issued):
    """Байты откатившегося выпуска остаются на диске — это принятый мусор.

    Показать их в списке значило бы завести дыру ровно там, где выдача байт
    её закрывает: файл лежит, строка есть, владельца нет.
    """
    orphan = orphan_attachment()
    api, _ = reader()

    listed = ids(api.get(URL))
    assert orphan.pk not in listed
    assert issued.attachment_id in listed


# ── Цена выборки ─────────────────────────────────────────────────────────


def test_query_count_does_not_grow_with_the_number_of_attachments(
    storage, types, division  # noqa: F811
):
    """Гвард N+1 — сравнением ДВУХ размеров выборки, а не пином на число
    запросов: выборка ходит по выпускам, и обход поимённо дал бы рост.
    """
    issued_in(division)
    api, _ = reader()
    with CaptureQueriesContext(connection) as small:
        few = api.get(URL)

    for index in range(6):
        issued_in(Division.objects.create(name=f"Управление {index}"))

    with CaptureQueriesContext(connection) as big:
        many = api.get(URL)

    assert len(rows(few)) == 1
    assert len(rows(many)) == 7
    assert len(big.captured_queries) == len(small.captured_queries)
