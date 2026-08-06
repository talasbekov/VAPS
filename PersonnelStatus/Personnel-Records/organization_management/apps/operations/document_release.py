"""Выпуск расхода: превращение сданного дня в официальный документ с номером
(порт issue_expense_document из Backend/VAPS
apps/operations/submissions/services/document_release_service.py).

Выгрузка и выпуск — РАЗНЫЕ действия, и это главное различие среза. Выгрузка
(маршрут export) отдаёт файл, собранный на лету: попросили — построили,
следующий раз построят заново. Выпуск ФИКСИРУЕТ: те самые байты, тот самый
дайджест, тот самый исходящий номер, — и с этого момента документ существует
как объект переписки, а не как результат запроса.

ПОРЯДОК ЗАМКОВ ЕДИНЫЙ И ЖЁСТКИЙ: голова сдачи ПЕРВОЙ, счётчик номеров ВТОРЫМ.
Тот же замок головы берёт поправка дня, поэтому выпуск и поправка строго
сериализуются: собрать документ по версии 1 и выпустить его, когда уже живёт
версия 2, конструктивно невозможно. Обратный порядок (номер, потом сдача) дал
бы клинч с любым путём, который трогает эти же строки в естественном порядке.

НОМЕР БЕРЁТСЯ ПОСЛЕ ВСЕХ ОТКАЗОВ, но до записи строки: отказ после аллокации
номер не съедает (счётчик откатывается вместе с транзакцией), однако тратить
его на заведомо отказной путь незачем.

ЧТО ИМЕННО ЗАФИКСИРОВАНО, записано в строке выпуска рядом с номером —
идентификатор сдачи И ЕЁ ВЕРСИЯ. Без версии ссылка указывала бы на «сдачу
вообще», а поправка меняет её содержание.

Повторный выпуск уже выпущенного дня здесь ОТКАЗ. Замена документа новым
«взамен исходящего №…» — отдельное решение со своей причиной, и приходит она
следующим срезом; молча выпустить второй документ на тот же день значило бы
оставить в переписке два действующих расхода.
"""
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.document_service import (
    allocate_number,
    create_attachment,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_docx import generate_expense_docx
from organization_management.apps.operations.expense_release import (
    build_submitted_expense_document,
)
from organization_management.apps.operations.models_document import OpsIssuedDocument
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    OpsIssuedDocumentSelector,
)

from django.db import transaction

# Единственный выпускаемый вид документа. Литерал живёт здесь, а не в модели:
# модель знает, что вид бывает, а какой именно — политика выпускающего.
EXPENSE_DOC_TYPE = "расход"

_DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def _document_filename(business_date, number):
    """Имя файла для получателя: день и исходящий номер, без часов.

    Без номера две выгрузки одного дня легли бы в одну папку под одним именем и
    вторая затёрла бы первую. Время суток не участвует намеренно: имя обязано
    быть воспроизводимым — тот же выпуск, названный по-разному в двух местах,
    читается как два разных документа.
    """
    return f"расход_{business_date.isoformat()}_исх-{number}.docx"


@transaction.atomic
def issue_expense_document(*, division_id, business_date, actor):
    """Выпустить расход подразделения за день. Возвращает строку выпуска.

    Транзакция одна на всё тело: номер, байты и строка выпуска появляются
    вместе или не появляются вовсе. Байты при откате остаются на диске мусором
    — это принятая цена (см. document_service), и окно сведено к минимуму тем,
    что все отказы стоят ДО записи файла.
    """
    if not actor or not str(actor).strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")

    # Замок головы ПЕРВЫМ действием: дальше по телу состояние дня уже не
    # изменится под руками.
    submission = DailySubmissionSelector.latest_for(
        division_id, business_date, lock=True
    )
    if submission is None:
        raise DomainError(
            "DAY_NOT_SUBMITTED",
            404,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День не сдан: выпускать нечего.",
        )

    existing = OpsIssuedDocumentSelector.current(
        doc_type=EXPENSE_DOC_TYPE,
        division_id=division_id,
        business_date=business_date,
    )
    if existing is not None:
        raise DomainError(
            "DOCUMENT_ALREADY_ISSUED",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
                "number": existing.number,
                "year": existing.year,
            },
            message=f"День уже выпущен исходящим №{existing.number}.",
        )

    return _build_and_record(
        division_id=division_id,
        business_date=business_date,
        submission=submission,
        actor=actor,
    )


@transaction.atomic
def reissue_expense_document(*, division_id, business_date, actor, reason):
    """Выпустить расход дня ВЗАМЕН действующего. Возвращает новый выпуск.

    Отдельная точка входа, а не флаг у выпуска, и разделяет их не техника, а
    смысл: у замены есть ПРИЧИНА, и обязательность причины проверяется на
    границе, а не «если флаг взведён». Флаг допускал бы вызов «выпусти, а если
    уже выпущено — замени», в котором замена происходит по недосмотру.

    Байты и номер прежнего выпуска НЕ ТРОГАЮТСЯ: он остаётся ровно тем, что
    было предъявлено, и лишь помечается отозванным. Тот, у кого на руках
    исходящий №5, обязан по журналу узнать, что тот отозван, — иначе история
    документа переписывается задним числом.
    """
    if not actor or not str(actor).strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if not reason or not str(reason).strip():
        raise DomainError(
            "VALIDATION_ERROR", 400, message="Замена документа требует причины."
        )

    submission = DailySubmissionSelector.latest_for(
        division_id, business_date, lock=True
    )
    if submission is None:
        raise DomainError(
            "DAY_NOT_SUBMITTED",
            404,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День не сдан: заменять нечего.",
        )

    previous = OpsIssuedDocumentSelector.current(
        doc_type=EXPENSE_DOC_TYPE,
        division_id=division_id,
        business_date=business_date,
    )
    if previous is None:
        raise DomainError(
            "DOCUMENT_NOT_ISSUED",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День не выпускался: заменять нечего.",
        )

    # ОТЗЫВ ИДЁТ ПЕРВЫМ, и порядок здесь держит не договорённость, а база:
    # частичная уникальность «не более одного действующего на день»
    # проверяется НЕМЕДЛЕННО, и вставка нового выпуска до снятия прежнего
    # упёрлась бы в неё. Перестановка не «менее аккуратна» — она не работает.
    previous.status = OpsIssuedDocument.Status.SUPERSEDED
    previous.save(update_fields=["status", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DOCUMENT_SUPERSEDED,
        entity_type=audit_service.ENTITY_ISSUED_DOCUMENT,
        entity_id=previous.pk,
        old_value={"status": OpsIssuedDocument.Status.ISSUED},
        new_value={"status": OpsIssuedDocument.Status.SUPERSEDED},
        reason=str(reason).strip(),
    )
    return _build_and_record(
        division_id=division_id,
        business_date=business_date,
        submission=submission,
        actor=actor,
        supersedes=previous,
        reason=str(reason).strip(),
    )


def _build_and_record(
    *, division_id, business_date, submission, actor, supersedes=None, reason=""
):
    """Собрать документ, записать байты, взять номер, создать строку выпуска.

    Общее тело первого выпуска и замены. Разделять их здесь было бы вредно:
    разойдись они хоть в одном поле — и заменяющий документ перестал бы быть
    тем же документом, что первый, отличаясь не только номером.
    """
    data = build_submitted_expense_document(division_id, business_date)
    payload = generate_expense_docx(data)

    number = allocate_number(doc_type=EXPENSE_DOC_TYPE, year=business_date.year)
    attachment = create_attachment(
        source=_Bytes(payload),
        original_name=_document_filename(business_date, number),
        content_type=_DOCX_CONTENT_TYPE,
        actor=actor,
    )
    issued = OpsIssuedDocument.objects.create(
        doc_type=EXPENSE_DOC_TYPE,
        number=number,
        # Год номера и год документа — ОДИН год делового дня, а не показание
        # часов: расход за 31 декабря, выпущенный 1 января, обязан лечь в
        # нумерацию декабря, иначе исходящий номер противоречит своей дате.
        year=business_date.year,
        business_date=business_date,
        division_id=division_id,
        submission_id=submission.pk,
        submission_version=submission.version,
        attachment=attachment,
        supersedes=supersedes,
        reason=reason,
        status=OpsIssuedDocument.Status.ISSUED,
        created_by=actor,
    )
    audit_service.record(
        actor=actor,
        action=audit_service.DOCUMENT_ISSUED,
        entity_type=audit_service.ENTITY_ISSUED_DOCUMENT,
        entity_id=issued.pk,
        new_value={
            "doc_type": EXPENSE_DOC_TYPE,
            "number": number,
            "year": issued.year,
            "business_date": business_date.isoformat(),
            "division_id": division_id,
            "submission_id": submission.pk,
            "submission_version": submission.version,
            "attachment_id": attachment.pk,
            "sha256": attachment.sha256,
            "supersedes_number": supersedes.number if supersedes else None,
        },
        reason=reason,
    )
    return issued


class _Bytes:
    """Готовые байты как источник для записи вложения.

    Документ уже собран целиком в памяти (генератор .docx иначе не умеет), и
    оборачивать его в загруженный файл значило бы тащить HTTP-тип в путь, где
    никакого HTTP нет. Читается чанками — ровно тем же способом, что и
    настоящая загрузка, поэтому путь записи у обоих источников один.
    """

    def __init__(self, payload):
        self._payload = payload
        self._offset = 0

    def read(self, size=-1):
        if size is None or size < 0:
            size = len(self._payload) - self._offset
        chunk = self._payload[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk
