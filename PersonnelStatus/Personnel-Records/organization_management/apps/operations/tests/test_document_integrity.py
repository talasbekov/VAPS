"""Сверка байт перед выдачей: что считается порчей и что уходит наружу.

Проверяется не «хэш совпадает» — это арифметика, — а три решения. Дайджест
пересчитывается по ТЕКУЩЕМУ содержимому диска, а не берётся из строки (иначе
сверка сравнивала бы запись саму с собой). Порча даёт пятисотый БЕЗ подробностей
— описание приватного хранилища снаружи не нужно никому, кроме того, кто его
подменил. И пропажа байт — та же порча, а не «не найдено».

Мутируются здесь БАЙТЫ НА ДИСКЕ, а не поле строки: подмена поля проверяла бы
равенство двух чисел в базе, а не то, что файл на диске тот самый.
"""
import io

import pytest
from django.test import override_settings

from organization_management.apps.operations import document_service
from organization_management.apps.operations.document_service import verify_integrity
from organization_management.apps.operations.exceptions import DomainError

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


# ── Целое проходит ───────────────────────────────────────────────────────


def test_an_untouched_file_passes_silently(storage):
    """Опора остальных проб: на исправном файле сверка молчит.

    Без неё каждый отказ ниже объяснялся бы тем, что сверка отказывает всегда.
    """
    assert verify_integrity(write()) is None


def test_a_file_larger_than_one_chunk_passes_too(storage):
    """Больше одного чанка: расхождение с записью на границе чанка иначе не
    проявится, и сверка отказывала бы на исправных больших документах."""
    payload = bytes(range(256)) * 2000  # ≈512 КиБ

    assert verify_integrity(write(payload)) is None


# ── Порча ────────────────────────────────────────────────────────────────


def test_bytes_replaced_on_disk_are_caught(storage):
    """Подменённый файл — главный сценарий: строка в базе при этом нетронута,
    и без пересчёта система выдала бы чужой документ под своим номером."""
    attachment = write()
    path = storage / str(attachment.storage_key)
    path.write_bytes("совсем другой документ".encode())

    with pytest.raises(DomainError) as exc:
        verify_integrity(attachment)

    assert exc.value.code == "DOCUMENT_INTEGRITY_FAILED"


def test_a_file_truncated_by_a_disk_failure_is_caught(storage):
    """Обрезанный файл открывается и читается — «файл на месте» его не ловит."""
    attachment = write()
    path = storage / str(attachment.storage_key)
    path.write_bytes(BYTES[:-1])

    with pytest.raises(DomainError):
        verify_integrity(attachment)


def test_a_single_flipped_byte_is_caught(storage):
    """Тот же размер, то же имя: отличается ровно один байт."""
    attachment = write()
    path = storage / str(attachment.storage_key)
    damaged = bytearray(BYTES)
    damaged[0] ^= 0x01
    path.write_bytes(bytes(damaged))

    with pytest.raises(DomainError):
        verify_integrity(attachment)


def test_missing_bytes_are_corruption_and_not_a_missing_object(storage):
    """Строка есть — значит документ выпускался. Ответ «нет такого» списал бы
    серверный сбой на спрашивающего."""
    attachment = write()
    (storage / str(attachment.storage_key)).unlink()

    with pytest.raises(DomainError) as exc:
        verify_integrity(attachment)

    assert exc.value.code == "DOCUMENT_INTEGRITY_FAILED"
    assert exc.value.http_status == 500


# ── Что уходит наружу и что в журнал процесса ────────────────────────────


def test_the_refusal_is_a_server_fault_and_not_the_callers_mistake(storage):
    """Пятисотый: спрашивающий попросил существующий документ и имеет на него
    право — ошибки с его стороны нет."""
    attachment = write()
    (storage / str(attachment.storage_key)).write_bytes("подмена".encode())

    with pytest.raises(DomainError) as exc:
        verify_integrity(attachment)

    assert exc.value.http_status == 500


def test_no_detail_about_the_private_storage_leaks_outward(storage):
    """Ожидаемый и фактический дайджесты — описание приватного хранилища.

    Ассерт по ВСЕМУ, что уносит отказ (нагрузка И сообщение), а не по знакомым
    ключам: то же значение, вынесенное в текст сообщения, утекло бы так же.
    """
    attachment = write()
    (storage / str(attachment.storage_key)).write_bytes("подмена".encode())

    with pytest.raises(DomainError) as exc:
        verify_integrity(attachment)

    carried = f"{exc.value.detail}{exc.value.message}"
    assert exc.value.detail == {}
    assert attachment.sha256 not in carried
    assert str(attachment.storage_key) not in carried


def test_the_specifics_go_to_the_process_log_instead(storage, caplog):
    """Наружу молчим, но разбирать инцидент чем-то надо: в журнале процесса
    остаются и вложение, и оба дайджеста."""
    attachment = write()
    (storage / str(attachment.storage_key)).write_bytes("подмена".encode())

    with caplog.at_level("ERROR"):
        with pytest.raises(DomainError):
            verify_integrity(attachment)

    logged = caplog.text
    assert attachment.sha256 in logged
    assert str(attachment.pk) in logged


def test_a_missing_file_is_logged_with_the_path_that_was_expected(storage, caplog):
    attachment = write()
    (storage / str(attachment.storage_key)).unlink()

    with caplog.at_level("ERROR"):
        with pytest.raises(DomainError):
            verify_integrity(attachment)

    assert str(attachment.storage_key) in caplog.text
