"""Где НЕ должны оказаться байты документа и почему.

Три несущих свойства раскладки: приватный корень не пересекается с публично
раздаваемыми каталогами, путь производен от storage_key (а не от пришедшего с
клиентом имени), и адрес внутренней локации указывает внутрь.

Базы здесь нет намеренно: модуль путей её не читает, и тесту она не нужна —
хватает несохранённого объекта с ключом.
"""
import uuid
from pathlib import Path

from django.test import override_settings

from organization_management.apps.operations import document_storage
from organization_management.apps.operations.models_document import OpsAttachment

KEY = uuid.UUID("11111111-2222-3333-4444-555555555555")


def make(name="расход.docx"):
    """НЕсохранённое вложение: путь обязан считаться до вставки строки."""
    return OpsAttachment(
        storage_key=KEY, original_name=name, content_type="text/plain",
        size=1, sha256="a" * 64,
    )


# ── Приватность корня ────────────────────────────────────────────────────


def test_the_private_root_is_not_inside_the_publicly_served_media_root():
    """Несущее свойство: то, что лежит под MEDIA_ROOT, раздаётся по адресу —
    мимо прав, мимо сверки и мимо журнала.

    Проверяется отношением каталогов, а не буквой пути: перенос корня в любое
    место под media (хоть в подкаталог) краснит тест, а переименование самого
    каталога — нет.
    """
    from django.conf import settings

    root = document_storage.storage_root().resolve()
    media = Path(settings.MEDIA_ROOT).resolve()

    assert not root.is_relative_to(media)


def test_the_private_root_is_not_inside_the_static_root_either():
    from django.conf import settings

    root = document_storage.storage_root().resolve()
    static = Path(settings.STATIC_ROOT).resolve()

    assert not root.is_relative_to(static)


@override_settings(OPS_PRIVATE_STORAGE_ROOT="/srv/ops-private")
def test_the_root_follows_the_setting():
    assert document_storage.storage_root() == Path("/srv/ops-private")


# ── Путь к байтам ────────────────────────────────────────────────────────


@override_settings(OPS_PRIVATE_STORAGE_ROOT="/srv/ops-private")
def test_the_path_is_the_key_placed_flat_under_the_root():
    assert document_storage.storage_path(make()) == Path(f"/srv/ops-private/{KEY}")


@override_settings(OPS_PRIVATE_STORAGE_ROOT="/srv/ops-private")
def test_a_traversing_original_name_cannot_move_the_file_out_of_the_root():
    """Граница безопасности: имя приходит от клиента.

    Проба берёт имя, которое в собранном из него пути увело бы запись на два
    уровня вверх, и требует, чтобы путь остался прежним. Начни строить путь из
    имени — тест краснеет; проверка «путь начинается с корня» такого не
    поймала бы, потому что `/srv/ops-private/../../etc/passwd` ей удовлетворяет.
    """
    path = document_storage.storage_path(make("../../etc/passwd"))

    assert path == Path(f"/srv/ops-private/{KEY}")
    assert path.resolve() == Path(f"/srv/ops-private/{KEY}")


@override_settings(OPS_PRIVATE_STORAGE_ROOT="/srv/ops-private")
def test_the_name_on_disk_carries_no_extension_from_the_original_name():
    """Расширение на диске означало бы, что тип файла задаёт клиент: веб-сервер
    выбирает обработчик по нему, и «.php» в имени перестал бы быть просто
    буквами."""
    assert document_storage.storage_path(make("отчёт.docx")).suffix == ""


# ── Адрес внутренней локации ─────────────────────────────────────────────


@override_settings(OPS_XACCEL_LOCATION="/ops-private")
def test_the_redirect_points_at_the_key_inside_the_internal_location():
    assert document_storage.xaccel_redirect_path(make()) == f"/ops-private/{KEY}"


@override_settings(OPS_XACCEL_LOCATION="/ops-private/")
def test_a_trailing_slash_in_the_location_does_not_produce_a_protocol_relative_path():
    """`//{key}` читается как начало авторитета (`//host/...`), и заголовок
    перестал бы указывать внутрь. Убери rstrip — тест краснеет."""
    result = document_storage.xaccel_redirect_path(make())

    assert result == f"/ops-private/{KEY}"
    assert not result.startswith("//")


@override_settings(OPS_XACCEL_LOCATION="/ops-private")
def test_the_redirect_carries_the_key_and_not_the_client_supplied_name():
    result = document_storage.xaccel_redirect_path(make("../../etc/passwd"))

    assert result == f"/ops-private/{KEY}"
