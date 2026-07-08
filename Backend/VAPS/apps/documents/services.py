"""Сервисы app documents: запись вложений (Story 6.1, ``create_attachment`` —
единственный write-канал Attachment) и выдача номеров документов
(Story 6.2, ``allocate_number``).

Контракт хранения (Д2/Д3): байты лежат плоско ``{VAPS_PRIVATE_STORAGE_ROOT}/
{uuid}`` — без расширения, без подкаталогов, вне MEDIA_URL. Отдача — заголовок
``X-Accel-Redirect: {VAPS_XACCEL_LOCATION}/{uuid}`` (nginx internal location
``location {VAPS_XACCEL_LOCATION}/ {{ internal; alias {root}/; }}`` — конфиг
зона E12/12.1); dev-fallback ``VAPS_XACCEL_ENABLED=0`` → ``FileResponse``.

Атомарность «файл + строка» (Ловушка №6): стриминговая запись во временный
файл В ТОМ ЖЕ каталоге (один filesystem → ``os.replace`` атомарен) с попутным
sha256/size; replace в финальное имя ДО create строки; при любом исключении
дальше — ``unlink(final)`` и re-raise. Осиротевший файл при жёстком падении
процесса — допустимая деградация (строки нет → ссылок нет), компенсационные
джобы не строим.

Аудит: ``ATTACHMENT_UPLOADED`` синхронно в той же транзакции (Д7, канон 4.4).
Аудит СКАЧИВАНИЯ здесь не эмитится — это Story 6.7 (Ловушка №2).
"""

import hashlib
import os
import uuid
from pathlib import Path

from django.conf import settings
from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import DomainError
from apps.documents import selectors
from apps.documents.models import Attachment, DocumentSequence

_CHUNK_SIZE = 64 * 1024  # 64 KiB
_MAX_NAME_LENGTH = 255  # = Attachment.original_name.max_length


def _sanitize_original_name(original_name):
    """Санитизация границы (ретро E5 §4.1): strip → basename → длина/пустота.

    Имя НЕ участвует в пути на диске (файл лежит под uuid) — оно попадает
    только в БД и в RFC-5987 Content-Disposition; basename всё равно режем,
    чтобы «C:\\evil\\расход.docx» из некоторых браузеров не хранился путём.
    """
    name = (original_name or "").strip()
    # basename для обоих сепараторов: клиентский путь может быть Windows-style.
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        raise DomainError("VALIDATION_ERROR", 400, detail={"file": "пустое имя файла"})
    if len(name) > _MAX_NAME_LENGTH:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"file": f"имя файла длиннее {_MAX_NAME_LENGTH} символов"},
        )
    return name


def create_attachment(*, uploaded_file, original_name, content_type, actor):
    """Записать файл в приватное хранилище и создать строку Attachment.

    ``uploaded_file`` — Django ``UploadedFile`` (форма уже валидна: whitelist
    content-type и лимит размера — зона сериализатора); ``original_name``/
    ``content_type`` берутся из файл-части multipart. ``actor`` —
    ``request.actor_id`` (ARCH-SEC-030), уходит в ``created_by`` и аудит.
    """
    name = _sanitize_original_name(original_name)
    ctype = (content_type or "").strip()
    if not ctype:
        raise DomainError(
            "VALIDATION_ERROR", 400, detail={"file": "пустой content-type"}
        )

    root = Path(settings.VAPS_PRIVATE_STORAGE_ROOT)
    os.makedirs(root, exist_ok=True)

    attachment_id = uuid.uuid4()
    final_path = root / str(attachment_id)
    tmp_path = root / f"{attachment_id}.tmp"

    digest = hashlib.sha256()
    size = 0
    try:
        with open(tmp_path, "wb") as tmp:
            for chunk in uploaded_file.chunks(_CHUNK_SIZE):
                digest.update(chunk)
                size += len(chunk)
                tmp.write(chunk)
        # Пустой файл (Д9): форма отбивает раньше; здесь — защита прямого
        # вызова сервиса, согласованная с DB-floor size >= 1.
        if size == 0:
            raise DomainError("VALIDATION_ERROR", 400, detail={"file": "пустой файл"})
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    # replace ДО create строки (один каталог → атомарно); дальше любой сбой
    # транзакции обязан прибрать файл — иначе на диске останется сирота.
    os.replace(tmp_path, final_path)
    try:
        with transaction.atomic():
            attachment = Attachment.objects.create(
                id=attachment_id,
                original_name=name,
                content_type=ctype,
                size=size,
                sha256=digest.hexdigest(),
                created_by=actor,
            )
            record(
                actor=actor,
                action="ATTACHMENT_UPLOADED",
                entity_type="attachment",
                entity_id=attachment.id,
                new_value={
                    "original_name": name,
                    "content_type": ctype,
                    "size": size,
                    "sha256": attachment.sha256,
                },
            )
    except Exception:
        final_path.unlink(missing_ok=True)
        raise
    return attachment


_DOC_TYPE_MAX_LENGTH = 50  # = DocumentSequence.doc_type.max_length
_YEAR_MIN, _YEAR_MAX = 2000, 2200  # зеркало chk_document_sequence_year_range


def allocate_number(*, doc_type, year):
    """Выдать следующий номер документа для пары (doc_type, year) — Story 6.2.

    Контракт вызова (канон для счётчиков, механика «create-then-lock внутри
    чужой транзакции»):

    - Сервис MUST вызываться ВНУТРИ ``transaction.atomic`` финализации
      вызывающего (6.5); своего ``atomic`` НЕ открывает. Row-лок
      ``select_for_update`` держится до коммита вызывающего — это и есть
      механизм «откат без дырки»: откат транзакции отменяет и инкремент,
      следующий вызов выдаст тот же номер (gap-tolerant). Вне транзакции
      ``select_for_update`` кидает ``TransactionManagementError`` —
      имплицитный энфорс контракта (house style: docstring, не runtime-assert).
    - Bootstrap нового ``(doc_type, year)`` (первый документ типа / нового
      года, §82.3): ``get_or_create`` — Django оборачивает create в savepoint
      и при проигрыше INSERT-гонки на ``uq_document_sequence_doc_type_year``
      откатывает ТОЛЬКО savepoint и повторяет get; внешняя транзакция не
      отравлена, наружу IntegrityError не летит. Счётчик нового года
      стартует с 1 (year-rollover = просто новая строка).
    - Объект из ``get_or_create`` НЕ залочен — обязательна перечитка через
      ``selectors.lock_sequence`` (пропуск = lost update: два потока читают
      одно значение, оба пишут +1 → дубль номера).
    - Против дедлока: один вызов = лок одной строки. При будущей
      мульти-аллокации нескольких типов в ОДНОЙ транзакции — вызывать в
      отсортированном порядке ``(doc_type, year)`` (зеркало ``lock_employees``
      с ``order_by``); retry на DeadlockDetected не строим.

    ``year`` подаёт вызывающий (политика «какой год у документа» — зона 6.5);
    wall-clock здесь не читается. Нарушение контракта входов → ``ValueError``
    (внутренний вызов, не HTTP-граница). Возвращает голый ``int`` — формат
    строки номера — зона генераторов (6.5).
    """
    if not isinstance(doc_type, str):
        raise ValueError("allocate_number: doc_type должен быть строкой")
    cleaned_type = doc_type.strip()
    if not cleaned_type:
        raise ValueError("allocate_number: doc_type пуст")
    if len(cleaned_type) > _DOC_TYPE_MAX_LENGTH:
        raise ValueError(
            f"allocate_number: doc_type длиннее {_DOC_TYPE_MAX_LENGTH} символов"
        )
    # bool — подкласс int: year=True прошёл бы как 1; отвергаем явно.
    if isinstance(year, bool) or not isinstance(year, int):
        raise ValueError("allocate_number: year должен быть int")
    if not _YEAR_MIN <= year <= _YEAR_MAX:
        raise ValueError(
            f"allocate_number: year вне диапазона {_YEAR_MIN}..{_YEAR_MAX}"
        )

    DocumentSequence.objects.get_or_create(
        doc_type=cleaned_type, year=year, defaults={"last_number": 0}
    )
    row = selectors.lock_sequence(doc_type=cleaned_type, year=year)
    row.last_number += 1
    row.save(update_fields=["last_number", "updated_at"])
    return row.last_number


def xaccel_redirect_path(attachment):
    """Значение X-Accel-Redirect для вложения: ``{location}/{uuid}`` (Д3)."""
    return f"{settings.VAPS_XACCEL_LOCATION}/{attachment.id}"


def storage_path(attachment):
    """Путь к байтам на диске: ``{root}/{uuid}`` — derivable от PK (Д2)."""
    return Path(settings.VAPS_PRIVATE_STORAGE_ROOT) / str(attachment.id)
