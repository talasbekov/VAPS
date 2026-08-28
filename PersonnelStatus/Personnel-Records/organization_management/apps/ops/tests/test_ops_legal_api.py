"""API нормативной базы ОМ (спека: паттерн ГВО, ночная смена 21.08).

Контракт мока 1:1: GET /api/ops/legal-documents/ → {"results": [...]},
id строкой, kind/status ограничены CheckConstraint на уровне БД.
Право чтения — event.view (как у остальных read-ручек раздела).
"""
import pytest
from django.db import IntegrityError
from rest_framework.test import APIClient

from organization_management.apps.operations.models_legal import OpsLegalDocument
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

URL = "/api/ops/legal-documents/"

pytestmark = pytest.mark.django_db


def viewer(name="ops-legal-viewer"):
    # `catalog.view`, а не `event.view`: нормативная база с 28.08.2026 под
    # своим правом — рядовой сотрудник видит её, не видя реестра мероприятий
    # (решение заказчика, Plane №267).
    api, _ = client_for(name, "VIEWER", ["catalog.view"])
    return api


def make_doc(**kw):
    row = dict(
        kind="LAW",
        code="№ 1 ЗРК",
        title="Тестовый закон",
        description="",
        revision="актуален с 01.2026",
        status="IN_FORCE",
        pages=1,
    )
    row.update(kw)
    return OpsLegalDocument.objects.create(**row)


def test_kind_constraint_rejects_unknown():
    with pytest.raises(IntegrityError):
        make_doc(kind="MEMO")


def test_status_constraint_rejects_unknown():
    with pytest.raises(IntegrityError):
        make_doc(status="DRAFT")


def test_list_shape_ordering_and_string_ids():
    # Порядок заведения не совпадает с ожидаемым порядком выдачи (kind, code):
    # совпади он — проверка прошла бы и без order_by.
    make_doc(kind="ORDER", code="Приказ № 2", title="Второй")
    make_doc(kind="LAW", code="№ 1 ЗРК", title="Первый")
    make_doc(kind="LAW", code="№ 0 ЗРК", title="Нулевой", is_active=False)
    r = viewer().get(URL)
    assert r.status_code == 200
    rows = r.json()["results"]
    assert [x["code"] for x in rows] == ["№ 1 ЗРК", "Приказ № 2"]
    assert set(rows[0]) == {
        "id", "kind", "code", "title", "description",
        "revision", "status", "pages", "fileUrl",
    }
    assert isinstance(rows[0]["id"], str)
    assert rows[0]["fileUrl"] is None


def test_list_denied_without_permission_and_anonymous():
    api, _ = client_for("ops-legal-nobody")
    assert api.get(URL).status_code == 403
    assert APIClient().get(URL).status_code == 403


def test_seed_is_idempotent():
    from django.core.management import call_command

    call_command("seed_legal_documents")
    call_command("seed_legal_documents")
    assert OpsLegalDocument.objects.count() == 8
    assert OpsLegalDocument.objects.filter(status="UNDER_REVIEW").count() == 1
