"""POST /api/operations/documents/{release,reissue}/ — маршруты выпуска.

Зона вьюхи, а не сервиса (номер, байты, отзыв и журнал покрыты
test_document_release.py): гейт права, область видимости, подпись из
аутентификации, форма тела и перевод доменных отказов в коды ответа.

Отдельная нить — что маршрут замены отличается от маршрута выпуска не только
именем: у него ОБЯЗАТЕЛЬНАЯ причина, и попросить замену молча нельзя.
"""
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.document_release import (
    EXPENSE_DOC_TYPE,
    issue_expense_document,
)
from organization_management.apps.operations.models_document import OpsIssuedDocument
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

RELEASE_URL = "/api/operations/documents/release/"
REISSUE_URL = "/api/operations/documents/reissue/"
REASON = "исправлен наряд"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


@pytest.fixture
def submitted(types, division):  # noqa: F811
    in_slot(division)
    submit(division)
    return division


def clerk(name="doc-clerk", scope=None):
    return client_for(name, "ORGD", ["daily_report.generate"], scope)


def post(api, url=RELEASE_URL, division=None, business_date=TODAY, **body):
    if division is not None:
        body["division_id"] = division.id
    if business_date is not None:
        body["business_date"] = business_date.isoformat()
    with clock.override(MORNING):
        return api.post(url, body, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(storage, submitted):
    assert post(APIClient(), division=submitted).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(storage, submitted):
    api, _ = client_for("no-perm", "ORGD", ["status.view"])

    assert post(api, division=submitted).status_code == 403


def test_the_permission_alone_is_enough_to_release(storage, submitted):
    api, _ = clerk()

    assert post(api, division=submitted).status_code == 201


def test_a_get_on_the_release_route_is_a_method_error_not_a_denial(storage):
    """405, а не мнимый 403: маршрут существует, глагол не тот."""
    api, _ = clerk()

    assert api.get(RELEASE_URL).status_code == 405


# ── Область видимости ────────────────────────────────────────────────────


def test_a_foreign_division_is_refused_rather_than_silently_released(
    storage, types, division  # noqa: F811
):
    """403, а не 404 и не молчаливый выпуск: ответ «не найдено» рассказывал бы
    о существовании чужих подразделений ровно столько же, но выпуск при этом
    мог бы состояться."""
    other = Division.objects.create(name="Чужое управление")
    in_slot(other)
    submit(other)
    api, _ = clerk(scope=division.id)

    response = post(api, division=other)

    assert response.status_code == 403
    assert OpsIssuedDocument.objects.count() == 0


def test_a_division_inside_the_scope_is_released(storage, types, division):  # noqa: F811
    """Соседний вызов с тем же клиентом проходит — иначе отказ выше объяснялся
    бы отсутствием права вообще, а не областью."""
    in_slot(division)
    submit(division)
    api, _ = clerk(scope=division.id)

    assert post(api, division=division).status_code == 201


# ── Подпись и тело ───────────────────────────────────────────────────────


def test_the_signature_comes_from_authentication_and_not_from_the_body(
    storage, submitted
):
    api, user = clerk()

    post(api, division=submitted, actor="999", created_by="999")

    issued = OpsIssuedDocument.objects.get()
    assert issued.created_by == str(user.pk)


@pytest.mark.parametrize(
    "body",
    [
        {"business_date": None},
        {"division": None},
        {"division": None, "business_date": None},
    ],
)
def test_an_incomplete_body_is_a_form_error(storage, submitted, body):
    api, _ = clerk()
    kwargs = {"division": submitted, "business_date": TODAY}
    kwargs.update(body)

    assert post(api, **kwargs).status_code == 400


def test_an_unreadable_date_is_a_form_error(storage, submitted):
    api, _ = clerk()

    with clock.override(MORNING):
        response = api.post(
            RELEASE_URL,
            {"division_id": submitted.id, "business_date": "позавчера"},
            format="json",
        )

    assert response.status_code == 400


# ── Ответ ────────────────────────────────────────────────────────────────


def test_the_response_describes_the_document_that_was_issued(storage, submitted):
    api, _ = clerk()

    body = post(api, division=submitted).json()

    assert body["doc_type"] == EXPENSE_DOC_TYPE
    assert body["number"] == 1
    assert body["status"] == OpsIssuedDocument.Status.ISSUED
    assert body["business_date"] == TODAY.isoformat()
    assert body["sha256"] == OpsIssuedDocument.objects.get().attachment.sha256


def test_the_response_never_carries_the_name_of_the_file_on_disk(storage, submitted):
    """Ключ хранения — имя файла во внутренней локации веб-сервера.

    Отданный клиенту, он превратил бы приватное хранилище в адресуемое:
    скачивание пошло бы мимо права, мимо сверки дайджеста и мимо журнала.
    Ассерт по ВСЕМУ телу ответа, а не по знакомым ключам — производное поле
    вынесло бы то же значение под другим именем.
    """
    api, _ = clerk()

    raw = post(api, division=submitted).content.decode()

    key = str(OpsIssuedDocument.objects.get().attachment.storage_key)
    assert key not in raw
    assert "storage_key" not in raw


# ── Доменные отказы ──────────────────────────────────────────────────────


def test_an_unsubmitted_day_is_not_found(storage, types, division):  # noqa: F811
    in_slot(division)
    api, _ = clerk()

    assert post(api, division=division).status_code == 404


def test_releasing_the_same_day_twice_is_a_conflict(storage, submitted):
    api, _ = clerk()
    post(api, division=submitted)

    assert post(api, division=submitted).status_code == 409


# ── Замена ───────────────────────────────────────────────────────────────


def test_the_reissue_route_replaces_the_current_document(storage, submitted):
    with clock.override(MORNING):
        first = issue_expense_document(
            division_id=submitted.id, business_date=TODAY, actor="7"
        )
    api, _ = clerk()

    body = post(api, url=REISSUE_URL, division=submitted, reason=REASON).json()

    first.refresh_from_db()
    assert body["supersedes"] == first.pk
    assert body["supersedes_number"] == first.number
    assert body["reason"] == REASON
    assert first.status == OpsIssuedDocument.Status.SUPERSEDED


def test_the_reissue_route_demands_a_reason(storage, submitted):
    """Причина обязательна на ФОРМЕ: отказ по форме внятнее, чем отказ по
    бизнес-правилу за то же самое."""
    with clock.override(MORNING):
        issue_expense_document(
            division_id=submitted.id, business_date=TODAY, actor="7"
        )
    api, _ = clerk()

    assert post(api, url=REISSUE_URL, division=submitted).status_code == 400
    assert post(
        api, url=REISSUE_URL, division=submitted, reason="   "
    ).status_code == 400


def test_the_release_route_ignores_a_reason_instead_of_quietly_replacing(
    storage, submitted
):
    """Замена — свой маршрут, а не поле в общем теле.

    Причина, поданная выпуску, не делает его заменой: день уже выпущен, и ответ
    обязан остаться конфликтом.
    """
    api, _ = clerk()
    post(api, division=submitted)

    response = post(api, division=submitted, reason=REASON)

    assert response.status_code == 409
    assert OpsIssuedDocument.objects.count() == 1


def test_reissuing_a_day_that_was_never_issued_is_a_conflict(storage, submitted):
    api, _ = clerk()

    assert post(
        api, url=REISSUE_URL, division=submitted, reason=REASON
    ).status_code == 409


def test_the_reissue_route_is_gated_by_the_same_scope(storage, types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    in_slot(other)
    submit(other)
    with clock.override(MORNING):
        issue_expense_document(
            division_id=other.id, business_date=TODAY, actor="7"
        )
    api, _ = clerk(scope=division.id)

    response = post(api, url=REISSUE_URL, division=other, reason=REASON)

    assert response.status_code == 403
    assert OpsIssuedDocument.objects.get().status == OpsIssuedDocument.Status.ISSUED
