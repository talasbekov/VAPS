"""GET /api/operations/attachments/{id}/download/ — выдача байт документа.

Зона вьюхи (сверка и журнал покрыты test_document_download_service.py): гейт
права, область по ВЛАДЕЛЬЦУ байт, неадресуемость вложения без выпуска, и два
режима отдачи с одинаковыми заголовками.

Область здесь — главное. Вложение не знает ни подразделения, ни дня, и право
отдать его выводится из выпуска: ошибись тут — и держатель права document.view
скачивал бы поимённый состав любого управления.
"""
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.document_release import (
    issue_expense_document,
    reissue_expense_document,
)
from organization_management.apps.operations.document_service import create_attachment
from organization_management.apps.operations.models_audit import OpsAuditLog
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

ACTOR = "7"


def url(attachment_id):
    return f"/api/operations/attachments/{attachment_id}/download/"


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


def reader(name="doc-reader", scope=None):
    return client_for(name, "ORGD", ["document.view"], scope)


def body_of(response):
    return b"".join(response.streaming_content)


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(storage, issued):
    assert APIClient().get(url(issued.attachment_id)).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(storage, issued):
    api, _ = client_for("no-perm", "ORGD", ["status.view"])

    assert api.get(url(issued.attachment_id)).status_code == 403


def test_the_permission_is_enough_to_download(storage, issued):
    api, _ = reader()

    assert api.get(url(issued.attachment_id)).status_code == 200


def test_a_post_is_a_method_error_not_a_denial(storage, issued):
    api, _ = reader()

    assert api.post(url(issued.attachment_id)).status_code == 405


# ── Область по владельцу байт ────────────────────────────────────────────


def test_bytes_of_a_foreign_divisions_document_are_refused(storage, types, division):  # noqa: F811
    """Несущий тест среза: без вывода области из выпуска держатель
    document.view скачивал бы поимённый состав любого управления."""
    other = Division.objects.create(name="Чужое управление")
    foreign = issued_in(other)
    api, _ = reader(scope=division.id)

    assert api.get(url(foreign.attachment_id)).status_code == 403


def test_bytes_inside_the_scope_are_served(storage, types, division):  # noqa: F811
    """Соседний вызов тем же клиентом проходит — иначе отказ выше объяснялся бы
    отсутствием права вообще, а не областью."""
    mine = issued_in(division)
    api, _ = reader(scope=division.id)

    assert api.get(url(mine.attachment_id)).status_code == 200


# ── Что не адресуемо ─────────────────────────────────────────────────────


def test_an_attachment_that_belongs_to_no_issue_is_not_addressable(storage, division):
    """Байты откатившегося выпуска остаются на диске — это принятый мусор.

    Открыть к ним доступ снаружи значило бы завести дыру ровно там, где мы на
    мусор согласились: файл лежит, строка есть, владельца нет.
    """
    orphan = create_attachment(
        source=__import__("io").BytesIO(b"osirotevshie bajty"),
        original_name="расход.docx",
        content_type="text/plain",
        actor=ACTOR,
    )
    api, _ = reader()

    assert api.get(url(orphan.pk)).status_code == 404


@pytest.mark.parametrize("junk", ["abc", "0", "999999", "1.5"])
def test_junk_and_missing_ids_answer_the_same_way(storage, issued, junk):
    """Разница в ответах рассказывала бы, что лежит в хранилище."""
    api, _ = reader()

    assert api.get(url(junk)).status_code == 404


# ── Отдача ───────────────────────────────────────────────────────────────


def test_the_bytes_served_are_the_bytes_on_disk(storage, issued):
    api, _ = reader()

    response = api.get(url(issued.attachment_id))

    assert body_of(response) == (
        storage / str(issued.attachment.storage_key)
    ).read_bytes()


def test_the_handover_is_journalled(storage, issued):
    api, user = reader()

    api.get(url(issued.attachment_id))

    entry = OpsAuditLog.objects.get(action=audit_service.DOCUMENT_DOWNLOADED)
    assert entry.entity_id == issued.attachment_id
    assert entry.actor_user_id == str(user.pk)


def test_corrupted_bytes_are_refused_instead_of_being_served(storage, issued):
    """500, и ответа с телом не возникает вовсе: порченый документ не должен
    доехать до получателя под номером целого."""
    (storage / str(issued.attachment.storage_key)).write_bytes("подмена".encode())
    api, _ = reader()

    response = api.get(url(issued.attachment_id))

    assert response.status_code == 500
    assert OpsAuditLog.objects.filter(
        action=audit_service.DOCUMENT_DOWNLOADED
    ).count() == 0


def test_the_bytes_of_a_withdrawn_document_are_still_served(storage, issued):
    """Отозванный документ по-прежнему предъявляют, и отказ в его байтах стёр
    бы историю у того, кто держит его на руках."""
    with clock.override(MORNING):
        reissue_expense_document(
            division_id=issued.division_id,
            business_date=TODAY,
            actor=ACTOR,
            reason="исправлен наряд",
        )
    api, _ = reader()

    assert api.get(url(issued.attachment_id)).status_code == 200


# ── Два режима отдачи ────────────────────────────────────────────────────


def test_without_the_accelerator_django_writes_the_body_itself(storage, issued):
    api, _ = reader()

    with override_settings(OPS_XACCEL_ENABLED=False):
        response = api.get(url(issued.attachment_id))

    assert "X-Accel-Redirect" not in response
    assert body_of(response) != b""


def test_with_the_accelerator_the_body_is_empty_and_the_header_points_inward(
    storage, issued
):
    """Тело пишет nginx. Заголовок обязан указывать во ВНУТРЕННЮЮ локацию — по
    нему и только по нему файл находится, снаружи этот адрес не открывается."""
    api, _ = reader()

    with override_settings(OPS_XACCEL_ENABLED=True, OPS_XACCEL_LOCATION="/ops-private"):
        response = api.get(url(issued.attachment_id))

    assert response.status_code == 200
    assert response.content == b""
    assert response["X-Accel-Redirect"] == (
        f"/ops-private/{issued.attachment.storage_key}"
    )


def test_both_modes_name_the_file_identically(storage, issued):
    """Включение ускорителя не должно незаметно менять имя скачиваемого файла."""
    api, _ = reader()

    with override_settings(OPS_XACCEL_ENABLED=False):
        plain = api.get(url(issued.attachment_id))
    with override_settings(OPS_XACCEL_ENABLED=True):
        accelerated = api.get(url(issued.attachment_id))

    assert plain["Content-Disposition"] == accelerated["Content-Disposition"]
    assert plain["Content-Type"] == accelerated["Content-Type"]


def test_the_download_is_named_after_the_document_and_not_the_key_on_disk(
    storage, issued
):
    api, _ = reader()

    with override_settings(OPS_XACCEL_ENABLED=False):
        response = api.get(url(issued.attachment_id))

    disposition = response["Content-Disposition"]
    assert "attachment" in disposition
    assert str(issued.attachment.storage_key) not in disposition
