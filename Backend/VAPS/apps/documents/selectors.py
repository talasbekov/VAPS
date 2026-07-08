"""Story 6.1 — read-канал Attachment (architecture.md#L451: селектор —
единственный канал чтения; view остаётся тонкой).

Канонизация pk — здесь, НЕ в DRF ``get_object()``: невалидный UUID в pk у
DRF-пути кидает ``ValueError`` → 500 (Ловушка №5). Каждый вход проверяется на
whitespace/тип/канонический формат (ретро E5 §4.1); мусорный id неотличим от
несуществующего — оба 404 ``ENTITY_NOT_FOUND``.
"""

import uuid

from apps.core.exceptions import DomainError
from apps.documents.models import Attachment


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
