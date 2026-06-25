"""Story 3.2 — provenance fields (source/source_ref/comment/document_basis)
+ the OM_AUTO-edit guard. Postgres-backed (ARCH-DATA-020)."""

import datetime
import re
from pathlib import Path

import pytest
from django.conf import settings

from apps.core.exceptions import DomainError
from apps.operations.statuses.models.employee_status import EmployeeStatus

pytestmark = pytest.mark.django_db


def _create(**kw):
    base = dict(
        employee_id="11111111-1111-1111-1111-111111111111",
        status_type_code="VACATION",
        date_start=datetime.date(2026, 1, 1),
        date_end=datetime.date(2026, 1, 10),
    )
    base.update(kw)
    return EmployeeStatus.objects.create(**base)


def test_source_defaults_to_user():
    # AC-1: an operator-created status (no explicit source) is USER.
    assert _create().source == EmployeeStatus.Source.USER


def test_provenance_fields_persist():
    s = _create(
        source=EmployeeStatus.Source.OM_AUTO,
        source_ref="DUTY:42",
        comment="ночное дежурство",
        document_basis="Приказ №7",
    )
    s.refresh_from_db()
    assert s.source == "OM_AUTO"
    assert s.source_ref == "DUTY:42"
    assert s.comment == "ночное дежурство"
    assert s.document_basis == "Приказ №7"


def test_optional_fields_blank_by_default():
    # New columns must not break fixtures that omit them (regression surface).
    s = _create()
    assert s.source_ref is None
    assert s.comment == ""
    assert s.document_basis == ""


def test_user_status_is_editable():
    _create().assert_user_editable()  # must not raise (AC-2: USER editable)


@pytest.mark.parametrize("src", ["OM_AUTO", "KU_SYNC"])
def test_non_user_status_edit_raises_422(src):
    # AC-2: a projection-owned record edited by an operator → 422.
    s = _create(source=src)
    with pytest.raises(DomainError) as ei:
        s.assert_user_editable()
    assert ei.value.http_status == 422
    assert ei.value.code == "AUTO_STATUS_READONLY"


def test_auto_status_readonly_code_in_registry():
    # Closed world: the new code MUST exist in error-codes.yaml (same PR) AND
    # carry the 422 the guard raises — so a regression to 409/other is caught.
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    block = re.search(r"^  AUTO_STATUS_READONLY:\n((?:    .*\n)+)", text, re.M)
    assert block, "AUTO_STATUS_READONLY missing from error-codes.yaml"
    assert "http_status: 422" in block.group(1)
