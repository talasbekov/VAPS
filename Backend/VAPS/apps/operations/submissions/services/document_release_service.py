"""Сервис выпуска расхода (Story 6.5): ``issue_expense_document``.

Финализация: снапшот текущей сдачи → release-гварды (schema/сходимость) →
генерация .docx → файл (``create_attachment``: sha256/size + свой аудит) +
номер (``allocate_number``) + строка ``IssuedDocument``. При amendment сдачи —
новый выпуск «взамен исх. №…» (``supersedes`` → прежний, прежний
``ISSUED→SUPERSEDED``, его байты НЕ трогаются).

Транзакционный дизайн (Ловушка №4, Д13): ВСЁ тело выпуска — одна
``transaction.atomic()``, первым действием ``latest_for(lock=True)`` — тот же
row-лок берёт ``amend_day``, поэтому выпуск и amendment строго сериализуются;
TOCTOU «сгенерили v1 — выпустили при живом v2» невозможен конструктивно.
Порядок локов ЕДИНЫЙ: submission-голова ПЕРВОЙ, счётчик номеров ВТОРЫМ
(анти-deadlock). ``allocate_number`` своего atomic не открывает — лок счётчика
живёт до коммита: отказ 409 после аллокации откатывает и инкремент, дырки в
нумерации нет (gap-free).

Release-ассерт (Д4, дефер ревью 6.3): НЕЗАВИСИМЫЙ ``derive_report`` в сервисе
— непустые ``violations ∪ warnings`` (staff_lt_list / no_staffing_record,
которые билдер 6.3 сознательно не читает) → 422 ``REPORT_NOT_CONVERGENT``
ДО генерации и траты номера. Плюс кросс-ассерт: числа построенного контракта
== числам независимого derive — дрейф билдер↔derive падает громко, а не
выпускает мусор (двойной derive — осознанная цена, Ловушка №3).

Файл-сирота (Ловушка №6, Д11 — принятый trade-off): ``create_attachment``
кладёт байты на диск ДО коммита внешней транзакции; откат ПОСЛЕ его savepoint
(экзотическая гонка на insert выпуска) оставит на диске файл без строки. Это
безопасно (uuid-имя, никем не адресуется) — компенсаций не строим; окно
минимизировано: все отказные гварды исполняются ДО записи файла.

Имя файла (Ловушка №10, Д10): детерминированное, без wall-clock —
``расход_{business_date}_исх-{number}.docx``; §34.1-паттерн
``{yyyyMMdd_HHmmss}`` относится к async-джобам и отложен до 6.6. На диске
файл лежит под uuid — original_name только для Content-Disposition.

HTTP-поверхности НЕТ (Д3, зона 6.10): actor приходит строкой, права проверит
API-слой (RBAC-гейт ``daily_report.generate``); аудит ``DOCUMENT_ISSUED``/
``DOCUMENT_SUPERSEDED`` — здесь (Д9: ``DOCUMENT_GENERATED`` не эмитится —
в синхронном выпуске нет наблюдаемого состояния «собраны, не выпущены»).
"""

import uuid
from datetime import date

from django.core.files.base import ContentFile
from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector, CoreStaffingSelector
from apps.documents.generators import generate_expense_docx
from apps.documents.models import EXPENSE_DOC_TYPE, IssuedDocument
from apps.documents.selectors import IssuedDocumentSelector
from apps.documents.services import allocate_number, create_attachment
from apps.operations.statuses.services.strength_report import (
    REPORT_COLUMNS,
    derive_report,
)
from apps.operations.submissions.expense_document import build_expense_document
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services.snapshot import SCHEMA_VERSION

_DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")


def _json_safe_findings(findings):
    """Финдинги derive для §36 details: UUID → str, остальное JSON-safe."""
    return [
        {
            key: str(value) if isinstance(value, uuid.UUID) else value
            for key, value in finding.items()
        }
        for finding in findings
    ]


def _parse_snapshot_rows(snapshot):
    """ISO-строки интервалов снапшота → date-объекты derive (зеркало билдера)."""
    return [
        {
            "employee_id": row["employee_id"],
            "status_type_code": row["status_type_code"],
            "date_start": date.fromisoformat(row["date_start"]),
            "date_end": date.fromisoformat(row["date_end"]),
        }
        for row in snapshot["rows"]
    ]


def _assert_matches_derive(data, report):
    """Кросс-ассерт (Ловушка №3): числа контракта == независимому derive.

    Построчно (Д11: ровно одна строка) и totals: staff/list/vacancies/columns/
    attached. Расхождение = дрейф билдер↔derive — программная ошибка, выпуск
    падает громко (STOP-семантика), не выпускает мусор.
    """
    (report_row,) = report.rows
    (row,) = data.rows
    pairs = [
        ("row.staff_total", row.staff_total, report_row.staff_total),
        ("row.list_total", row.list_total, report_row.list_total),
        ("row.vacancies", row.vacancies, report_row.vacancies),
        ("row.attached", row.attached.count, report_row.attached),
        ("totals.staff_total", data.totals.staff_total, report.totals.staff_total),
        ("totals.list_total", data.totals.list_total, report.totals.list_total),
        ("totals.vacancies", data.totals.vacancies, report.totals.vacancies),
        ("totals.attached", data.totals.attached, report.totals.attached),
    ]
    for key in REPORT_COLUMNS:
        pairs.append(
            (f"row.columns[{key}]", row.cells[key].count, report_row.columns[key])
        )
        pairs.append(
            (
                f"totals.columns[{key}]",
                data.totals.columns[key],
                report.totals.columns[key],
            )
        )
    mismatches = [
        f"{name}: {built} != {derived}"
        for name, built, derived in pairs
        if built != derived
    ]
    if mismatches:
        raise AssertionError(
            "expense release broke контракт == derive: " + "; ".join(mismatches)
        )


def _issued_audit_value(issued, attachment):
    """Лёгкий JSON-safe payload аудита (Ловушка №7): БЕЗ снапшота."""
    return {
        "doc_type": issued.doc_type,
        "number": issued.number,
        "year": issued.year,
        "business_date": issued.business_date.isoformat(),
        "division_id": str(issued.division_id),
        "submission_id": issued.submission_id,
        "submission_version": issued.submission_version,
        "attachment_id": str(attachment.id),
        "sha256": attachment.sha256,
    }


def issue_expense_document(*, division_id, business_date, actor):
    """Выпустить расход по текущей сдаче (division, business_date).

    Args:
        division_id: UUID подразделения (flat, ARCH-003); str коэрцируется.
        business_date: дата сдачи (ЯВНЫЙ параметр; year номера = её год, Д6).
        actor: внешний account-id (строка) → created_by и аудит.

    Returns the created IssuedDocument (status=ISSUED).

    Raises DomainError: 400 (actor пуст), 409 REPORT_NOT_READY_FOR_DATE (сдачи
        за дату нет), 422 SNAPSHOT_SCHEMA_UNSUPPORTED (schema guard, Д5), 422
        REPORT_NOT_CONVERGENT (release-ассерт, Д4), 409 DOCUMENT_ALREADY_ISSUED
        (повтор той же версии сдачи, Д7 — откат возвращает номер, gap-free).
        Отклонённый выпуск не оставляет ни строки, ни аудита DOCUMENT_*.
    """
    _require_actor(actor)
    # str-ключ vs UUID-ключи селекторов даёт ДВЕ строки derive и роняет
    # распаковку (report_row,); малформный id падает громко (зеркало snapshot.py).
    if not isinstance(division_id, uuid.UUID):
        division_id = uuid.UUID(str(division_id))

    with transaction.atomic():
        # Submission-лок ПЕРВЫМ (Ловушка №4): тот же row-лок берёт amend_day —
        # выпуск и amendment сериализуются, выпуск устаревшего снапшота исключён.
        locked = DailySubmissionSelector.latest_for(
            division_id, business_date, lock=True
        )
        if locked is None:
            raise DomainError(
                "REPORT_NOT_READY_FOR_DATE",
                409,
                detail={
                    "division_id": str(division_id),
                    "business_date": business_date.isoformat(),
                },
                message="Нет сдачи за дату — выпускать нечего.",
            )
        if not locked.is_current:
            # Belt: head всегда current в v1-домене («ноль текущих» — не зона
            # выпуска); выпуск вытесненной версии — программная ошибка.
            raise AssertionError(
                f"expense release: head submission {locked.pk} is not current"
            )

        snapshot = locked.snapshot
        # Schema guard (Д5, Ловушка №9): по КОНСТАНТЕ, не литералу; `type is` —
        # bool проходит isinstance/== 1; отказ и на отсутствующий ключ.
        version = snapshot.get("schema_version")
        if type(version) is not int or version != SCHEMA_VERSION:
            raise DomainError(
                "SNAPSHOT_SCHEMA_UNSUPPORTED",
                422,
                detail={
                    "schema_version": repr(version),
                    "supported": SCHEMA_VERSION,
                },
                message="Снапшот сдачи имеет неподдерживаемую версию схемы.",
            )

        # ORM-обвязка derive/билдера (прод-источники, Dev Notes «Эталоны»).
        staff_map = CoreStaffingSelector.allocated_slots_on(
            business_date, [division_id]
        )
        division_names = CoreDivisionTreeSelector.divisions_map([division_id])

        # Release-ассерт (Д4): НЕЗАВИСИМЫЙ derive — мягкие финдинги
        # (staff_lt_list / no_staffing_record), которые билдер глотает,
        # отказывают выпуск ДО генерации и ДО траты номера.
        roster_ids = [member["employee_id"] for member in snapshot["roster"]]
        report = derive_report(
            {division_id: roster_ids},
            _parse_snapshot_rows(snapshot),
            staff_map,
            business_date,
            division_names=division_names,
        )
        if report.violations or report.warnings:
            raise DomainError(
                "REPORT_NOT_CONVERGENT",
                422,
                detail={
                    "violations": _json_safe_findings(report.violations),
                    "warnings": _json_safe_findings(report.warnings),
                },
                message="Формулы сходимости расхода нарушены — выпуск отказан.",
            )

        data = build_expense_document(
            snapshot,
            business_date,
            staff_map=staff_map,
            division_names=division_names,
            division_id=division_id,
        )
        _assert_matches_derive(data, report)

        docx_bytes = generate_expense_docx(data)

        # Финализация: счётчик ВТОРЫМ локом (единый порядок), в ЭТОЙ же
        # транзакции — откат 409 ниже возвращает номер, дырки нет.
        number = allocate_number(doc_type=EXPENSE_DOC_TYPE, year=business_date.year)

        prev = IssuedDocumentSelector.current_issued(
            doc_type=EXPENSE_DOC_TYPE,
            division_id=division_id,
            business_date=business_date,
        )
        if prev is not None:
            if prev.submission_id == locked.pk:
                raise DomainError(
                    "DOCUMENT_ALREADY_ISSUED",
                    409,
                    detail={
                        "number": prev.number,
                        "year": prev.year,
                        "submission_id": prev.submission_id,
                        "submission_version": prev.submission_version,
                    },
                    message=(
                        "Документ по текущей версии сдачи уже выпущен; "
                        "повторная выдача файла — операция скачивания (6.7)."
                    ),
                )
            if prev.submission_version >= locked.version:
                # Belt: под submission-локом выпуск более новой версии, чем
                # head, конструктивно невозможен — только программная ошибка.
                raise AssertionError(
                    f"expense release: issued v{prev.submission_version} "
                    f"newer than locked head v{locked.version}"
                )
            IssuedDocument.objects.filter(pk=prev.pk).update(
                status=IssuedDocument.Status.SUPERSEDED
            )

        original_name = f"расход_{business_date.isoformat()}_исх-{number}.docx"
        # create_attachment: sha256/size сам, свой вложенный savepoint + аудит
        # ATTACHMENT_UPLOADED (Ловушка №5); идёт предпоследним — все отказные
        # гварды уже позади (минимизация окна файла-сироты, Ловушка №6).
        attachment = create_attachment(
            uploaded_file=ContentFile(docx_bytes, name=original_name),
            original_name=original_name,
            content_type=_DOCX_CONTENT_TYPE,
            actor=actor,
        )

        issued = IssuedDocument.objects.create(
            doc_type=EXPENSE_DOC_TYPE,
            number=number,
            year=business_date.year,
            business_date=business_date,
            division_id=division_id,
            submission_id=locked.pk,
            submission_version=locked.version,
            attachment=attachment,
            supersedes=prev,
            status=IssuedDocument.Status.ISSUED,
            # reason выпуска = reason выпускаемой сдачи ВСЕГДА (Д7): "" у v1,
            # непустой у AMENDED — потому первый выпуск amended-сдачи несёт
            # reason при supersedes=None (chk_*_supersede_reason это допускает).
            reason=locked.reason,
            created_by=actor,
        )

        # Аудит (Д9) ПОСЛЕ вложенных savepoint-ов, в ambient atomic (канон
        # status_service 4.4): откат выше не оставляет аудит-строк DOCUMENT_*.
        if prev is not None:
            record(
                actor=actor,
                action="DOCUMENT_SUPERSEDED",
                entity_type="document",
                entity_id=prev.id,
                old_value={"status": IssuedDocument.Status.ISSUED.value},
                new_value={
                    "status": IssuedDocument.Status.SUPERSEDED.value,
                    "doc_type": prev.doc_type,
                    "number": prev.number,
                    "year": prev.year,
                    "superseded_by_number": number,
                },
                reason=locked.reason,
            )
        record(
            actor=actor,
            action="DOCUMENT_ISSUED",
            entity_type="document",
            entity_id=issued.id,
            old_value=None,
            new_value=_issued_audit_value(issued, attachment)
            | {"supersedes_number": prev.number if prev is not None else None},
            reason=locked.reason,
        )
    return issued
