"""Запись вложения: что остаётся на диске и в базе на КАЖДОМ пути отказа.

Счастливый путь здесь наименее интересен. Несущее — что после любого отказа не
остаётся строки без байтов (ложь) и не остаётся временных файлов; и что мусор
(байты без строки) появляется только там, где он объявлен принятой ценой.

Хранилище на каждый тест своё — tmp_path: общий каталог сделал бы пробы
зависимыми от порядка, а «файлов в каталоге ровно один» — вакуумным.
"""
import hashlib
import io

import pytest
from django.db import transaction
from django.test import override_settings

from organization_management.apps.operations import audit_service, document_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_document import OpsAttachment

pytestmark = pytest.mark.django_db

BYTES = "расход за 6 августа".encode()
ACTOR = "7"
CTYPE = "text/plain"


@pytest.fixture
def storage(tmp_path):
    """Свой приватный корень на тест."""
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


def write(payload=BYTES, *, name="расход.docx", ctype=CTYPE, actor=ACTOR):
    return document_service.create_attachment(
        source=io.BytesIO(payload),
        original_name=name,
        content_type=ctype,
        actor=actor,
    )


# ── Счастливый путь ──────────────────────────────────────────────────────


def test_the_bytes_land_under_the_storage_key_and_nowhere_else(storage):
    attachment = write()

    assert (storage / str(attachment.storage_key)).read_bytes() == BYTES
    assert sorted(p.name for p in storage.iterdir()) == [str(attachment.storage_key)]


def test_the_stored_digest_is_of_the_bytes_that_were_actually_written(storage):
    """Дайджест считается на лету, за тот же проход, что и запись.

    Ассерт сравнивает с хэшем, посчитанным независимо ЗДЕСЬ, а не с прочитанным
    обратно файлом: второе сравнивало бы диск сам с собой.
    """
    attachment = write()

    assert attachment.sha256 == hashlib.sha256(BYTES).hexdigest()
    assert attachment.size == len(BYTES)


def test_a_large_payload_is_written_across_chunks_intact(storage):
    """Больше одного чанка: обрыв на границе чанка иначе никогда не проявится."""
    payload = bytes(range(256)) * 2000  # ≈512 КиБ, восемь чанков

    attachment = write(payload)

    assert (storage / str(attachment.storage_key)).read_bytes() == payload
    assert attachment.sha256 == hashlib.sha256(payload).hexdigest()


def test_the_upload_is_recorded_in_the_journal_against_the_attachment(storage):
    attachment = write()

    entry = OpsAuditLog.objects.get(
        action=audit_service.ATTACHMENT_UPLOADED,
        entity_type=audit_service.ENTITY_ATTACHMENT,
    )
    assert entry.entity_id == attachment.pk
    assert entry.actor_user_id == ACTOR
    assert entry.new_value["sha256"] == attachment.sha256


def test_the_bytes_are_already_at_the_final_name_when_the_row_is_inserted(storage):
    """Порядок «сначала байты, потом строка» — несущий, и проверяется он ИЗНУТРИ
    вставки, а не по результату.

    По результату оба порядка неотличимы: в конце успешного вызова и файл на
    месте, и строка есть. Разъезжаются они только на отказе, которого тест
    устроить не может (падение процесса между двумя операциями), — поэтому
    сигнал ловит МОМЕНТ вставки и спрашивает диск. Перенеси os.replace за
    создание строки — здесь окажется False, и это ровно то состояние, в котором
    прод отдал бы «документ выпущен, файла нет».
    """
    from django.db.models.signals import post_save

    seen = {}

    def spy(sender, instance, **kwargs):
        seen["file_exists"] = (storage / str(instance.storage_key)).exists()

    post_save.connect(spy, sender=OpsAttachment)
    try:
        write()
    finally:
        post_save.disconnect(spy, sender=OpsAttachment)

    assert seen["file_exists"] is True


def test_no_temporary_file_survives_a_successful_write(storage):
    write()

    assert [p for p in storage.iterdir() if p.name.endswith(".tmp")] == []


# ── Имя файла ────────────────────────────────────────────────────────────


def test_a_client_supplied_path_is_reduced_to_its_last_segment(storage):
    """Полный путь с чужой машины не должен храниться целиком."""
    attachment = write(name="C:\\Users\\ivanov\\Документы\\расход.docx")

    assert attachment.original_name == "расход.docx"


def test_a_posix_path_is_reduced_the_same_way(storage):
    assert write(name="/var/tmp/расход.docx").original_name == "расход.docx"


def test_a_name_of_only_separators_is_rejected_rather_than_stored_empty(storage):
    """После срезки разделителей от имени не остаётся ничего — и это отказ, а
    не пустая строка: пустое имя ушло бы в заголовок отдачи."""
    with pytest.raises(DomainError) as exc:
        write(name="///")

    assert exc.value.code == "VALIDATION_ERROR"


def test_an_overlong_name_is_rejected_before_the_database_truncates_it(storage):
    with pytest.raises(DomainError):
        write(name="я" * 256 + ".docx")


def test_an_empty_content_type_is_rejected(storage):
    with pytest.raises(DomainError):
        write(ctype="   ")


# ── Пути отказа ──────────────────────────────────────────────────────────


def test_an_empty_payload_leaves_neither_a_row_nor_a_file(storage):
    """Ноль байт — след оборванной записи, и дайджест такого файла законен."""
    with pytest.raises(DomainError):
        write(b"")

    assert OpsAttachment.objects.count() == 0
    assert list(storage.iterdir()) == []


def test_a_source_that_raises_midway_leaves_no_temporary_file_behind(storage):
    """Обрыв ЧТЕНИЯ на середине: временный файл уже создан и частично записан.

    Именно этот путь оставляет мусор, если убрать уборку в except, — и мусор
    накапливающийся, потому что оборвавшихся загрузок много.
    """

    class Failing(io.BytesIO):
        def read(self, *args):
            chunk = super().read(*args)
            if chunk:
                return chunk
            raise OSError("обрыв канала")

    with pytest.raises(OSError):
        document_service.create_attachment(
            source=Failing(b"x" * 1000),
            original_name="x.docx",
            content_type=CTYPE,
            actor=ACTOR,
        )

    assert list(storage.iterdir()) == []
    assert OpsAttachment.objects.count() == 0


def test_a_rejected_actor_never_touches_the_storage(storage):
    """Отказ по актору идёт ДО открытия файла: каталог остаётся нетронутым."""
    with pytest.raises(DomainError):
        write(actor="  ")

    assert not storage.exists() or list(storage.iterdir()) == []


# ── Согласованность с транзакцией вызывающего ────────────────────────────


def test_a_rolled_back_caller_transaction_takes_the_row_and_its_journal_entry(storage):
    """Вложение — часть операции вызывающего, а не самостоятельный факт.

    Своя транзакция внутри сервиса (та, что коммитится сама) оставила бы строку
    вложения от откатившегося выпуска — то есть строку без владельца. Проба
    «завести здесь свой atomic вместо вложенного» краснит этот тест.
    """
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            write()
            raise RuntimeError("выпуск не сложился")

    assert OpsAttachment.objects.count() == 0
    assert OpsAuditLog.objects.filter(
        action=audit_service.ATTACHMENT_UPLOADED
    ).count() == 0


def test_the_journal_entry_shares_the_fate_of_the_row_within_one_call(storage):
    """Запись в журнал идёт в той же транзакции, что и строка: «файл записан,
    а событие потерялось» невозможно."""
    write()

    assert OpsAttachment.objects.count() == 1
    assert OpsAuditLog.objects.filter(
        action=audit_service.ATTACHMENT_UPLOADED
    ).count() == 1
