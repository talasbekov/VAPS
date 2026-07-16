"""Селекторы app documents: read-канал Attachment (Story 6.1) и row-lock
счётчика DocumentSequence (Story 6.2). architecture.md#L451: селектор —
единственный канал чтения; view остаётся тонкой.

Канонизация pk — здесь, НЕ в DRF ``get_object()``: невалидный UUID в pk у
DRF-пути кидает ``ValueError`` → 500 (Ловушка №5). Каждый вход проверяется на
whitespace/тип/канонический формат (ретро E5 §4.1); мусорный id неотличим от
несуществующего — оба 404 ``ENTITY_NOT_FOUND``.
"""

import uuid

from apps.core.exceptions import DomainError
from apps.documents.models import Attachment, DocumentSequence, IssuedDocument


def _not_found():
    return DomainError("ENTITY_NOT_FOUND", 404, detail={"entity": "attachment"})


def get_attachment(attachment_id):
    """Attachment по id; мусорный/неизвестный id → 404, не 500."""
    try:
        canonical = uuid.UUID(str(attachment_id).strip())
    except (ValueError, AttributeError, TypeError) as exc:
        raise _not_found() from exc
    try:
        return Attachment.objects.get(id=canonical)
    except Attachment.DoesNotExist as exc:
        raise _not_found() from exc


class IssuedDocumentSelector:
    """Read-канал выпусков документов (Story 6.5)."""

    @staticmethod
    def current_issued(*, doc_type, division_id, business_date):
        """Действующий (ISSUED) выпуск для (тип, подразделение, день), или None.

        Контракт вызова (Ловушка №4): сервис выпуска читает это ВНУТРИ своей
        транзакции ПОД submission-локом (``latest_for(lock=True)``) — выпуск и
        amendment сериализуются на том же row-локе, потому select_for_update
        здесь не нужен; partial-unique ``uq_issued_document_current`` — DB-ремень
        на тот же инвариант.
        """
        return IssuedDocument.objects.filter(
            doc_type=doc_type,
            division_id=division_id,
            business_date=business_date,
            status=IssuedDocument.Status.ISSUED,
        ).first()

    @staticmethod
    def history_for(*, doc_type, division_ids):
        """Журнал выпусков (Story 10.5): ВСЕ выпуски (ISSUED и SUPERSEDED)
        данного типа по подразделениям ``division_ids``, новые сверху
        (``-year, -number`` — номер монотонен внутри года, порядок
        детерминирован). Потребитель — history-роут ExpenseReportViewSet;
        NFR-инвариант: ОДИН запрос с ``select_related("attachment",
        "supersedes")`` (sha256 и цепочка «взамен» без per-row обращений) —
        никогда не звать в цикле по подразделениям.
        """
        return (
            IssuedDocument.objects.filter(
                doc_type=doc_type, division_id__in=division_ids
            )
            .select_related("attachment", "supersedes")
            .order_by("-year", "-number")
        )


def lock_sequence(*, doc_type, year):
    """Row-lock строки счётчика (doc_type, year) для выдачи номера (Story 6.2).

    Use inside a transaction (зеркало ``CoreEmployeeLockSelector
    .lock_employee``): лок живёт до коммита вызывающего — это и есть механизм
    «откат без дырки». Строка обязана существовать (bootstrap делает
    ``allocate_number`` через ``get_or_create`` ДО перечитки под локом).
    """
    return DocumentSequence.objects.select_for_update().get(
        doc_type=doc_type, year=year
    )
