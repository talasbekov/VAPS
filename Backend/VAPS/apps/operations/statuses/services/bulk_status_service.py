"""Story 3.8 — atomic mass status creation (FR-12), no N+1.

``bulk_create_statuses`` is the single validated write-path for an operator's
morning mass update of one management unit: a list of deviation rows, all-or-
nothing, with per-row error detail. Unlisted employees get NO record — they are
derived «В строю» (IN_SERVICE) by story 3.7.

NFR-4 contract: the SQL query count is CONSTANT regardless of row count. The
donor died of COUNT()-in-a-loop; we must not reproduce it. So this does NOT call
``create_status`` in a loop (that locks + conflict-queries per row). Instead:
bulk-lock all employees (1 query), prefetch the referenced status types (1),
bulk-fetch their live statuses (1), validate every row IN MEMORY (reusing the
3.3 ``_validate_interval`` and the 3.4 pure ``detect_conflicts``), then one
``bulk_create``. Validation order is fail-fast on structural/security errors
(duplicate → 400, missing → 404, scope → 403) and aggregating on per-row
business errors (422/409 collected into ``detail.rows[]``).
"""

from collections import Counter

from django.db import transaction

from apps.core.exceptions import DomainError
from apps.core.selectors import CoreEmployeeLockSelector
from apps.operations.statuses.conflict_matrix import detect_conflicts
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.status_service import (
    _conflict_details,
    _require_actor,
    _validate_interval,
)

# Keys every payload row must carry. Accessed via ``[]`` below, so a missing one
# would raise KeyError → 500; the up-front shape check turns that into a 400.
_REQUIRED_ROW_KEYS = ("employee_id", "status_type_code", "date_start", "date_end")


def _overlaps(existing_rows, date_start, date_end):
    """Half-open interval overlap, in Python (the predicate that lives in the
    selector query for the single-row path stays here for the bulk path)."""
    return [
        row
        for row in existing_rows
        if row["date_start"] < date_end and row["date_end"] > date_start
    ]


@transaction.atomic
def bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids):
    """Create operator-owned deviation statuses atomically (source=USER).

    ``rows``: list of dicts ``{employee_id, status_type_code, date_start,
    date_end, comment?, document_basis?, source_ref?}``. ``allowed_division_ids``
    is the operator's scope (Решение №2 — resolved from RBAC by the caller; the
    service enforces 403). Raises a single ``DomainError`` on any failure and
    writes NOTHING; returns the created rows on success.
    """
    _require_actor(actor)
    # Defend a future caller (e.g. a serializer's unfilled field): a None
    # business_date reaches detect_conflicts as ``date > None`` → TypeError → 500,
    # and it would NOT be caught by the per-row ``except DomainError`` below. The
    # single-row path can't hit this — it sources business_date from
    # Clock.today_local() internally. Fail fast as a 400 (cf. status_service
    # ``(override_reason or "")``).
    if business_date is None:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "business_date"},
            message="business_date обязателен для массового обновления.",
        )
    rows = list(rows)
    if not rows:
        raise DomainError(
            "VALIDATION_ERROR", 400, message="Пустой payload массового обновления."
        )

    # Structural shape check, before any ``row[...]`` access: a row missing a
    # required key would otherwise raise KeyError → 500. Surface it as a 400 with
    # the offending row index (the DRF serializer in E10 also guards this, but the
    # service is the single validated write-path).
    for index, row in enumerate(rows):
        missing = [key for key in _REQUIRED_ROW_KEYS if key not in row]
        if missing:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"index": index, "missing": missing},
                message="В строке payload отсутствуют обязательные поля.",
            )

    # AC-3: duplicate employee in payload — structural, before any DB work.
    employee_ids = [row["employee_id"] for row in rows]
    duplicates = sorted(
        {str(eid) for eid, count in Counter(employee_ids).items() if count > 1}
    )
    if duplicates:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "employee_id", "employee_ids": duplicates},
            message="Дубль сотрудника в payload (одна строка на сотрудника).",
        )

    # Bulk lock (1 query). Missing employee → 404 (fail-fast).
    locked = CoreEmployeeLockSelector.lock_employees(employee_ids)
    missing = [eid for eid in employee_ids if eid not in locked]
    if missing:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"employee_ids": [str(eid) for eid in missing]},
            message="Сотрудник не найден.",
        )

    # AC-5: scope (fail-fast, security). Current division of the locked row;
    # `.division_id` reads the stored FK value — no extra query.
    allowed = set(allowed_division_ids)
    out_of_scope = [
        str(eid) for eid in employee_ids if locked[eid].division_id not in allowed
    ]
    if out_of_scope:
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"employee_ids": out_of_scope},
            message="Сотрудник вне области видимости оператора.",
        )

    # Prefetch the referenced types (1 query) so per-row resolution is in-memory.
    codes = {row["status_type_code"] for row in rows}
    types = {
        st.code: st
        for st in StatusType.objects.filter(code__in=codes, is_active=True)
    }

    # Bulk-fetch live statuses for these employees (1 query), grouped in memory.
    existing_by_employee = {}
    existing = EmployeeStatus.objects.filter(
        employee_id__in=employee_ids, cancelled_at__isnull=True
    ).values("employee_id", "status_type_code", "date_start", "date_end")
    for row in existing:
        existing_by_employee.setdefault(row["employee_id"], []).append(row)

    # Per-row business validation, fully in memory (AC-4/AC-6). Each row's
    # DomainError is caught and collected; nothing is written yet.
    row_errors = []
    for index, row in enumerate(rows):
        try:
            status_type = types.get(row["status_type_code"])
            if status_type is None:
                raise DomainError(
                    "INVALID_STATUS_TYPE",
                    422,
                    detail={"status_type_code": row["status_type_code"]},
                    message="Тип статуса не найден в справочнике или неактивен.",
                )
            _validate_interval(
                date_start=row["date_start"],
                date_end=row["date_end"],
                employee=locked[row["employee_id"]],
                status_type=status_type,
            )
            overlaps = _overlaps(
                existing_by_employee.get(row["employee_id"], ()),
                row["date_start"],
                row["date_end"],
            )
            report = detect_conflicts(
                new_type=row["status_type_code"],
                existing_rows=overlaps,
                business_date=business_date,
            )
            if report.hard:
                raise DomainError(
                    "OVERLAPPING_HARD_STATUS",
                    422,
                    detail={"conflicts": _conflict_details(report.hard)},
                    message="Статус конфликтует с hard-статусом сотрудника.",
                )
            if report.soft:
                raise DomainError(
                    "STATUS_OVERLAP_WARNING",
                    409,
                    overridable=True,
                    detail={"conflicts": _conflict_details(report.soft)},
                    message="Статус пересекает soft-статус сотрудника.",
                )
        except DomainError as exc:
            row_errors.append(
                {
                    "index": index,
                    "employee_id": str(row["employee_id"]),
                    "code": exc.code,
                    "http_status": exc.http_status,
                    "message": exc.message,
                }
            )

    if row_errors:
        # AC-6: aggregate. The envelope status/code mirror the most-severe row
        # (422 > 409); detail.rows[] carries every row's own code.
        worst = max(row_errors, key=lambda err: err["http_status"])
        raise DomainError(
            worst["code"],
            worst["http_status"],
            detail={"rows": row_errors},
            message="Массовое обновление отклонено: см. detail.rows.",
        )

    # All rows valid → one bulk insert (AC-1/AC-7). Savepoint so a concurrent
    # insert tripping excl_hard_status_overlap rolls back cleanly to 422 via §36.
    objects = [
        EmployeeStatus(
            employee_id=row["employee_id"],
            status_type_code=row["status_type_code"],
            date_start=row["date_start"],
            date_end=row["date_end"],
            source=EmployeeStatus.Source.USER,
            comment=row.get("comment", ""),
            document_basis=row.get("document_basis", ""),
            source_ref=row.get("source_ref"),
        )
        for row in rows
    ]
    with transaction.atomic():
        created = EmployeeStatus.objects.bulk_create(objects)
    return created
