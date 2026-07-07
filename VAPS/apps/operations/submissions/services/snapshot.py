"""Срез-билдер (Story 5.3a): self-contained иммутабельный снапшот сдачи.

``build_division_snapshot`` собирает для (``division_id``, ``business_date``)
снапшот ``{schema_version, roster, rows}``:

* ``roster`` — denominator: по строке на КАЖДОГО сотрудника списочного состава
  на дату (own-level ``roster_on``), с денормализованными ФИО и званием.
  Денорм заморожен на момент СДАЧИ (текущие значения Employee при построении —
  поздний rename/promotion не переписывает прошлую сдачу), НЕ as-of business_date.
  Сотрудник без статусов всё равно здесь (derive → «В строю»).
* ``rows`` — действующие на дату интервалы-факты статусов (полуоткрытые
  ``[date_start, date_end)``, cancelled исключены), с ``status_id`` и ``source``.

Self-contained — derive(снапшот, дата) считает расход ТОЛЬКО из roster+rows, не
обращаясь к ``roster_on``/EmployeeStatus повторно (ARCH-DATA-021; фундамент
иммутабельности 5.10). Даты в ``rows`` — ISO-строки "YYYY-MM-DD" (JSONField);
derive-потребитель парсит их (``date.fromisoformat``) перед ``resolve_status``,
которому нужны ``date``-объекты — парс тривиален и без потерь, снапшот остаётся
единственным источником. READ-ONLY: рядов DailySubmission не пишет, транзакцию
не открывает (атомарность даёт вызывающий сервис 5.3b). ``business_date`` —
ЯВНЫЙ параметр (ARCH-DATA-022, без чтения часов).

Снапшот НЕ хранит штат/вакансии — отдельная ось; 5.10 требует иммутабельность
по статусам. Роллап вверх по дереву — отдельная DailySubmission родителя (5.11),
здесь только own-level.
"""

import uuid

from apps.core.selectors import CoreEmployeeSelector, HistoricalEmployeeSelector
from apps.operations.statuses.selectors import EmployeeStatusSelector

SCHEMA_VERSION = 1


def build_division_snapshot(division_id, business_date) -> dict:
    """Build the self-contained снапшот dict for one division on a date.

    Read-only; deterministic order (roster by employee_id, rows by
    (employee_id, status_id)) so the diff/event (5.3b) and property test (5.10)
    compare snapshots without false CHANGED. JSON-safe: uuid -> str, date ->
    "YYYY-MM-DD".
    """
    # roster_on keys its dict by UUID; a str division_id would miss every key
    # and SILENTLY yield an empty snapshot. Coerce so a str works and a
    # malformed id fails loud (ValueError) instead of returning a wrong-empty.
    if not isinstance(division_id, uuid.UUID):
        division_id = uuid.UUID(str(division_id))

    roster_map = HistoricalEmployeeSelector.roster_on(business_date, {division_id})
    employee_ids = roster_map.get(division_id, [])

    # Denormalised ФИО/звание (frozen at сдача time) via the core selector —
    # operations never imports core.models (ARCH-003 isolation; Rank.name inside).
    denorm = CoreEmployeeSelector.denorm_for(employee_ids)
    roster = sorted(
        (
            {
                "employee_id": str(employee_id),
                "full_name": info["full_name"],
                "rank": info["rank"],
            }
            for employee_id, info in denorm.items()
        ),
        key=lambda r: r["employee_id"],
    )

    # Scope facts to the SAME present-employee set as the roster (denorm.keys())
    # so rows ⊆ roster holds by construction — a fact can never reference an
    # employee absent from the denominator.
    facts = EmployeeStatusSelector.snapshot_facts_on(business_date, list(denorm.keys()))
    rows = sorted(
        (
            {
                "employee_id": str(fact["employee_id"]),
                "status_type_code": fact["status_type_code"],
                "status_id": fact["id"],
                "date_start": fact["date_start"].isoformat(),
                "date_end": fact["date_end"].isoformat(),
                "source": fact["source"],
            }
            for fact in facts
        ),
        key=lambda r: (r["employee_id"], r["status_id"]),
    )

    return {"schema_version": SCHEMA_VERSION, "roster": roster, "rows": rows}
