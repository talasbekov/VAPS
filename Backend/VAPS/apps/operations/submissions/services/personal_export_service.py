"""Story 10.8 — сервис личной копии сданного дня («щит»).

ORM-обвязка вокруг чистого билдера ``build_personal_export_xlsx``: резолвит
то, чего в снапшоте нет (имя подразделения, справочные имена типов статусов,
локальное время сдачи), проверяет версию схемы снапшота и ФИКСИРУЕТ САМ ФАКТ
ВЫГРУЗКИ в аудите.

Порядок жёсткий (эталон ``documents.services.prepare_download``): schema-guard
→ генерация байтов → ``record(SUBMISSION_EXPORTED)`` → возврат. Журнал
означает «файл отдан», а не «попытка была», поэтому отказ по схеме строки
аудита не оставляет. ``record()`` НЕ оборачивается в ``atomic`` и НЕ глушится
``try/except``: GET идёт в autocommit, а падение записи обязано дать 500 —
нет журнала ⇒ нет выдачи.

``entity_id`` — ``division_id`` (UUID), а НЕ pk сдачи: ``AuditLog.entity_id``
это ``UUIDField``, а pk сдачи целый; int-pk кладётся в ``new_value``
(действующая конвенция реестра). Ошибка здесь молчалива — ``UUIDField``
преобразует int в правдоподобный UUID вместо отказа.

Часы здесь НЕ читаются вовсе: время сдачи берётся из строки БД, а не с
``Clock``. Личная копия — не документ учёта: номер, sha256 и место на диске
ей не нужны, байты живут только в памяти ответа.
"""

from zoneinfo import ZoneInfo

from django.conf import settings

from apps.audit.services import record
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.statuses.selectors import StatusTypeSelector
from apps.operations.submissions.personal_export import build_personal_export_xlsx
from apps.operations.submissions.services.snapshot import SCHEMA_VERSION

# Русские лейблы события сдачи. Незнакомый код печатается сам — реестр
# событий может вырасти раньше, чем этот словарь, и файл обязан это пережить.
EVENT_LABELS = {
    "CONFIRMED_NO_CHANGES": "Без изменений",
    "CHANGED": "С изменениями",
    "AMENDED": "Исправление",
}
_SUBMITTED_AT_FORMAT = "%d.%m.%Y %H:%M"


def event_label(event) -> str:
    """Русский лейбл события сдачи; неизвестный код — дословно."""
    return EVENT_LABELS.get(event, event)


def _submitted_at_label(submitted_at) -> str:
    """tz-aware время сдачи → строка в локальной зоне.

    Строка, а не ``datetime``: openpyxl не пишет tz-aware в ячейку.
    """
    local = submitted_at.astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
    return local.strftime(_SUBMITTED_AT_FORMAT)


def _assert_snapshot_schema_supported(snapshot):
    """Отказ на неподдерживаемом снапшоте ДО генерации и ДО аудита.

    Зеркало гварда выпуска расхода: сравнение по КОНСТАНТЕ, не по литералу, и
    через ``type is not int`` — ``isinstance`` пропустил бы ``True`` как ``1``.
    """
    schema_version = snapshot.get("schema_version")
    if type(schema_version) is not int or schema_version != SCHEMA_VERSION:
        raise DomainError(
            "SNAPSHOT_SCHEMA_UNSUPPORTED",
            422,
            detail={
                "schema_version": repr(schema_version),
                "supported": SCHEMA_VERSION,
            },
            message="Снапшот сдачи имеет неподдерживаемую версию схемы.",
        )


def export_submission(*, submission, actor) -> tuple[bytes, str]:
    """Сдача → (байты .xlsx, имя файла) + строка аудита о выгрузке."""
    snapshot = submission.snapshot
    _assert_snapshot_schema_supported(snapshot)

    # ARCH-003: имя подразделения — через core-СЕЛЕКТОР, никогда не модель.
    # Подразделение легально может отсутствовать в выборке — тогда печатается
    # сам UUID; это корректное поведение, а не баг.
    division_names = CoreDivisionTreeSelector.divisions_map([submission.division_id])
    division_title = division_names.get(submission.division_id) or str(
        submission.division_id
    )

    payload = build_personal_export_xlsx(
        snapshot=snapshot,
        division_title=division_title,
        business_date=submission.business_date,
        version=submission.version,
        is_current=submission.is_current,
        event_label=event_label(submission.event),
        submitted_by=submission.submitted_by,
        submitted_at_label=_submitted_at_label(submission.submitted_at),
        late=submission.late,
        status_names=StatusTypeSelector.names_map(),
    )
    filename = (
        f"сдача_{submission.business_date.isoformat()}_v{submission.version}.xlsx"
    )

    record(
        actor=actor,
        action="SUBMISSION_EXPORTED",
        entity_type="daily_submission",
        entity_id=submission.division_id,
        new_value={
            "submission_id": submission.pk,
            "division_id": str(submission.division_id),
            "business_date": submission.business_date.isoformat(),
            "version": submission.version,
            "is_current": submission.is_current,
            "event": submission.event,
            "roster_size": len(snapshot.get("roster") or []),
            "row_count": len(snapshot.get("rows") or []),
            "filename": filename,
        },
    )
    return payload, filename
