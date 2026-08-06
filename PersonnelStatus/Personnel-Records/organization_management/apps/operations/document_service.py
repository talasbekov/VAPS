"""Запись файла в приватное хранилище — единственный канал появления вложений
(порт create_attachment из Backend/VAPS apps/documents/services.py).

Задача среза не «сохранить файл», а НЕ ОСТАВИТЬ РАСХОЖДЕНИЯ между диском и
базой ни на одном из путей отказа. Расхождение бывает двух видов, и они не
равноценны:

- строка есть, байтов нет — ЛОЖЬ. Документ числится выпущенным, скачивание
  падает, и узнаёт об этом тот, кому он понадобился;
- байты есть, строки нет — МУСОР. Файл лежит под неугадываемым именем, на него
  никто не ссылается, места он занимает столько же, сколько занял бы.

Отсюда весь порядок действий: сначала байты, потом строка. Первый вид
расхождения исключён конструктивно, второй — сведён к окну между os.replace и
коммитом внешней транзакции и прибирается обработчиком отказа. Полностью
второй вид неустраним: процесс может быть убит между двумя операциями, а
компенсирующая уборка сама была бы новым источником расхождения (она стирала
бы файлы транзакций, которые ещё не закоммитились). Мусор — принятая цена.

ХЭШ И РАЗМЕР СЧИТАЮТСЯ НА ЛЕТУ, за один проход записи: второй проход по уже
записанному файлу читал бы ДРУГОЕ состояние диска, а не то, что мы записали, и
сверка «байт-в-байт» проверяла бы сама себя.

ЧТЕНИЕ ЧАНКАМИ, а не .read(): расход памяти не должен зависеть от размера
загружаемого файла — иначе один большой документ роняет процесс целиком.
"""
import hashlib
import os

from django.db import transaction

from organization_management.apps.operations import audit_service, document_storage
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsDocumentSequence,
)
from organization_management.apps.operations.selectors import (
    OpsDocumentSequenceSelector,
)

_CHUNK_SIZE = 64 * 1024
_MAX_NAME_LENGTH = 255  # = OpsAttachment.original_name.max_length


def _invalid(detail):
    return DomainError("VALIDATION_ERROR", 400, detail={"file": detail})


def _clean_name(original_name):
    """Привести имя файла к тому, что можно положить в строку и в заголовок.

    Имя НЕ участвует в пути на диске (там storage_key), поэтому «..» здесь не
    опасно — но разделители всё равно срезаются: браузеры некоторых платформ
    присылают полный путь («C:\\Users\\...\\расход.docx»), и хранить его целиком
    значило бы показывать получателю чужую файловую систему.

    Оба разделителя, а не только os.sep: сервер живёт под одной платформой, а
    файл приходит с любой.
    """
    name = (original_name or "").strip().replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        raise _invalid("пустое имя файла")
    if len(name) > _MAX_NAME_LENGTH:
        raise _invalid(f"имя файла длиннее {_MAX_NAME_LENGTH} символов")
    return name


def _clean_content_type(content_type):
    ctype = (content_type or "").strip()
    if not ctype:
        raise _invalid("пустой content-type")
    return ctype


def _iter_chunks(source):
    """Чанки исходного файла: и Django-загрузка, и обычный файловый объект.

    Сервис зовут и с HTTP-границы (UploadedFile умеет .chunks()), и изнутри —
    выпуск документа подаёт сгенерированные байты. Требовать от вызывающего
    оборачивать свои байты в UploadedFile значило бы тащить HTTP-тип в путь,
    где никакого HTTP нет.
    """
    chunks = getattr(source, "chunks", None)
    if callable(chunks):
        return chunks(_CHUNK_SIZE)
    return iter(lambda: source.read(_CHUNK_SIZE), b"")


def create_attachment(*, source, original_name, content_type, actor):
    """Записать байты и создать строку вложения. Возвращает вложение.

    Вызывается ВНУТРИ транзакции вызывающего, когда та есть (выпуск документа):
    строка вложения и строка выпуска обязаны появляться и исчезать вместе.
    Своей транзакции для этого достаточно вложенной — Django не откроет вторую,
    и откат внешней снимет и запись вложения, и его событие журнала.
    """
    if not actor or not str(actor).strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    name = _clean_name(original_name)
    ctype = _clean_content_type(content_type)

    # Объект собирается НЕсохранённым ради storage_key: имя файла на диске
    # нужно до вставки строки (см. models_document).
    attachment = OpsAttachment(
        original_name=name, content_type=ctype, size=0, sha256="", created_by=actor
    )
    root = document_storage.storage_root()
    os.makedirs(root, exist_ok=True)
    final_path = document_storage.storage_path(attachment)
    # Временное имя — в ТОМ ЖЕ каталоге: os.replace атомарен только внутри
    # одной файловой системы, а системный /tmp запросто окажется другой.
    tmp_path = root / f"{attachment.storage_key}.tmp"

    digest = hashlib.sha256()
    size = 0
    try:
        with open(tmp_path, "wb") as tmp:
            for chunk in _iter_chunks(source):
                digest.update(chunk)
                size += len(chunk)
                tmp.write(chunk)
        if size == 0:
            # Пустой файл отбивается ЗДЕСЬ, до появления финального имени:
            # дайджест пустых байт совершенно законен, и дальше по пути такой
            # файл был бы неотличим от целого.
            raise _invalid("пустой файл")
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    # Финальное имя появляется ПЕРЕД строкой: между этими двумя действиями
    # возможен только мусор, но не ложь (см. докстринг модуля).
    os.replace(tmp_path, final_path)
    try:
        with transaction.atomic():
            attachment.size = size
            attachment.sha256 = digest.hexdigest()
            attachment.save()
            audit_service.record(
                actor=actor,
                action=audit_service.ATTACHMENT_UPLOADED,
                entity_type=audit_service.ENTITY_ATTACHMENT,
                entity_id=attachment.pk,
                new_value={
                    "storage_key": str(attachment.storage_key),
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


# ── Выдача исходящего номера ─────────────────────────────────────────────

_DOC_TYPE_MAX_LENGTH = 50  # = OpsDocumentSequence.doc_type.max_length
_YEAR_MIN, _YEAR_MAX = 2000, 2200  # зеркало chk_ops_document_sequence_year_range


def allocate_number(*, doc_type, year):
    """Выдать следующий исходящий номер для пары (вид, год).

    КОНТРАКТ ВЫЗОВА, и он же — вся механика «откат без дырки»:

    - зовётся ВНУТРИ транзакции того, кто выпускает документ; своей не
      открывает. Построчный замок держится до коммита ВЫЗЫВАЮЩЕГО, поэтому
      откат снимает и инкремент: следующий выпуск возьмёт тот же номер.
      Собственная транзакция здесь всё сломала бы ровно наоборот — она
      закоммитила бы инкремент отдельно от выпуска, и отказ после аллокации
      съедал бы номер, то есть вернула бы поведение последовательности базы,
      от которого мы и ушли;
    - строка счётчика заводится через get_or_create ДО перечитки под замком.
      Django оборачивает вставку в точку сохранения, и проигравшая гонку
      транзакция откатывает ТОЛЬКО её, повторяя чтение — внешняя транзакция не
      отравлена, наружу IntegrityError не летит;
    - объект из get_or_create НЕ залочен, и перечитка обязательна. Пропусти её
      — два потока прочтут одно значение, оба запишут +1, и один номер уйдёт в
      два документа.

    Год подаёт вызывающий: «какой год у документа» — его политика, а не
    показание часов (документ за 31 декабря выпускают 1 января). Нарушение
    контракта входов — ValueError: это дефект вызывающего кода, а не ситуация
    данных, и HTTP-границы здесь нет.

    Возвращается голое целое. Как номер печатается в документе — дело
    печатающего; счётчик знает только «сколько выдано».
    """
    if not isinstance(doc_type, str):
        raise ValueError("allocate_number: вид документа должен быть строкой")
    cleaned = doc_type.strip()
    if not cleaned:
        raise ValueError("allocate_number: вид документа пуст")
    if len(cleaned) > _DOC_TYPE_MAX_LENGTH:
        raise ValueError(
            f"allocate_number: вид документа длиннее {_DOC_TYPE_MAX_LENGTH} символов"
        )
    # Отдельного гварда на bool здесь нет намеренно: True и False — подклассы
    # int, но приходят как 1 и 0, а обе величины лежат ВНЕ допустимого
    # диапазона годов и отвергаются проверкой ниже. Второй владелец одного
    # правила дал бы вакуумную пробу — его снятие ничего не краснит.
    if not isinstance(year, int):
        raise ValueError("allocate_number: год должен быть целым")
    if not _YEAR_MIN <= year <= _YEAR_MAX:
        raise ValueError(
            f"allocate_number: год вне диапазона {_YEAR_MIN}..{_YEAR_MAX}"
        )

    OpsDocumentSequence.objects.get_or_create(
        doc_type=cleaned, year=year, defaults={"last_number": 0}
    )
    row = OpsDocumentSequenceSelector.lock(doc_type=cleaned, year=year)
    row.last_number += 1
    row.save(update_fields=["last_number", "updated_at"])
    return row.last_number
