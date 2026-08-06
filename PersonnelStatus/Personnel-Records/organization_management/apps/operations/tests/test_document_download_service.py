"""Подготовка выдачи: порядок «сверка → журнал → путь» и его цена.

Порядок здесь не стилистика. Строка «такой-то скачал документ» рядом с молча
выданными порчеными байтами — худший из возможных ответов: она ПОДТВЕРЖДАЕТ то,
чего не было. Поэтому проверяется не только что журнал пишется, но и что на
отказе сверки он молчит, и что сбой самого журнала роняет выдачу.
"""
import io

import pytest
from django.test import override_settings

from organization_management.apps.operations import audit_service, document_service
from organization_management.apps.operations.document_service import prepare_download
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog

pytestmark = pytest.mark.django_db

BYTES = "расход за 6 августа".encode()
ACTOR = "7"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


def write(payload=BYTES):
    return document_service.create_attachment(
        source=io.BytesIO(payload),
        original_name="расход.docx",
        content_type="text/plain",
        actor=ACTOR,
    )


def downloads():
    return OpsAuditLog.objects.filter(action=audit_service.DOCUMENT_DOWNLOADED)


# ── Счастливый путь ──────────────────────────────────────────────────────


def test_the_path_of_the_verified_file_is_returned(storage):
    attachment = write()

    path = prepare_download(attachment=attachment, actor=ACTOR)

    assert path == storage / str(attachment.storage_key)
    assert path.read_bytes() == BYTES


def test_the_handover_is_recorded_against_the_attachment(storage):
    """Событие пишется на ВЛОЖЕНИЕ, а не на выпуск: выдаются байты, и у
    отозванного выпуска они по-прежнему свои."""
    attachment = write()

    prepare_download(attachment=attachment, actor="42")

    entry = downloads().get()
    assert entry.entity_type == audit_service.ENTITY_ATTACHMENT
    assert entry.entity_id == attachment.pk
    assert entry.actor_user_id == "42"
    assert entry.new_value["sha256"] == attachment.sha256


def test_every_handover_leaves_its_own_row(storage):
    """«Кто и когда получил» — предмет разбирательства, а не статистика:
    схлопни повторную выдачу в одну строку, и второй получатель исчезнет."""
    attachment = write()

    prepare_download(attachment=attachment, actor="42")
    prepare_download(attachment=attachment, actor="43")

    assert sorted(downloads().values_list("actor_user_id", flat=True)) == ["42", "43"]


# ── Порядок ──────────────────────────────────────────────────────────────


def test_corrupted_bytes_leave_no_row_claiming_they_were_handed_over(storage):
    """Несущий тест среза.

    Переставь журнал перед сверкой — здесь появится строка о выдаче документа,
    который на самом деле не выдавался, и именно на неё сошлются в разборе.
    """
    attachment = write()
    (storage / str(attachment.storage_key)).write_bytes("подмена".encode())

    with pytest.raises(DomainError) as exc:
        prepare_download(attachment=attachment, actor=ACTOR)

    assert exc.value.code == "DOCUMENT_INTEGRITY_FAILED"
    assert downloads().count() == 0


def test_missing_bytes_leave_no_row_either(storage):
    attachment = write()
    (storage / str(attachment.storage_key)).unlink()

    with pytest.raises(DomainError):
        prepare_download(attachment=attachment, actor=ACTOR)

    assert downloads().count() == 0


def test_a_failing_journal_takes_the_handover_down_with_it(storage, monkeypatch):
    """Обязательность журнала буквальна: нет журнала — нет выдачи.

    Смягчение («записать как получится») завело бы путь, на котором документ
    уходит бесследно. Проба ломает запись журнала и требует, чтобы путь наружу
    не вернулся.
    """
    attachment = write()

    def broken(**kwargs):
        raise RuntimeError("журнал недоступен")

    monkeypatch.setattr(document_service.audit_service, "record", broken)

    with pytest.raises(RuntimeError):
        prepare_download(attachment=attachment, actor=ACTOR)


def test_an_empty_actor_is_refused_before_anything_is_written(storage):
    """Безымянная выдача — та же выдача без журнала."""
    attachment = write()

    with pytest.raises(DomainError):
        prepare_download(attachment=attachment, actor="   ")

    assert downloads().count() == 0
