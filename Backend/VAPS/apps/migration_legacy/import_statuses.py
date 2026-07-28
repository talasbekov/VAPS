"""Story 7.4 — идемпотентный импорт интервалов статусов (включая
секондменты ATTACHED/DETACHED — уже покрыты ``transform.DONOR_STATUS_TYPE_MAP``,
ничего нового не требуется) + convergence-проверка derived-статуса.

Ядро write-логики перенесено из ``import_donor_slice.Command._import_statuses``
(Story 1.6) буквально: та же конверсия inclusive-донорских дат в half-open
VAPS-интервалы (ARCH-DATA-023).

AC-1 "интервалы не пересекаются (constraint выдержан)" — ТОЛЬКО для HARD
кодов (``excl_hard_status_overlap`` — SICK_LEAVE/LEAVE_BY_REPORT/VACATION/
COMMAND, см. миграцию 0001); SOFT-типы (STUDY, ATTACHED/DETACHED и др.)
constraint'ом НЕ ограничены и МОГУТ законно сосуществовать — именно поэтому
нужна отдельная convergence-проверка ниже (ревью-фикс: исходная версия
докстринга/чеклиста стори звучала так, будто ВСЕ пересечения отвергаются
схемой — неточно, поправлено).

Convergence-проверка (AC-1, "derived-статусы... совпадают или расхождение в
отчёте"): после записи интервала — ``resolve_status()`` (чистая функция,
``apps.operations.statuses.services.strength_report``, BR-001 приоритетное
разрешение) на ``date_start`` И на дату старта КАЖДОГО ДРУГОГО живого
интервала того же сотрудника, попадающего строго внутрь только что
записанного интервала — именно эти точки и есть места, где приоритетный
победитель МОГ ПОМЕНЯТЬСЯ (ревью-фикс: более ранняя версия сэмплировала
только собственные start/end записанного интервала — этого недостаточно,
если ДРУГОЙ, более приоритетный интервал начинается СТРОГО В СЕРЕДИНЕ,
не касаясь ни одной границы проверяемого). Не полный day-by-day скан —
только реальные точки смены победителя. Запросы батчатся по сотруднику (не
по интервалу) — избегаем N+1 при нескольких интервалах одного сотрудника в
одной выгрузке. Список находок ограничен (см. ``MISMATCH_LIMIT``) — как и
все report-секции
в этом модуле (`EXAMPLE_LIMIT`-паттерн).

ЧЕСТНАЯ ГРАНИЦА (ревью-фикс — усилено после review): донор НЕ отдаёт
независимое "derived-статус на дату" поле для сверки — донор сам
интервальный (те же строки, что мы уже трансформируем). Эта проверка —
SELF-CONSISTENCY (совпадает ли только что записанный интервал с приоритетным
разрешением VAPS ПО ЕГО ЖЕ СОБСТВЕННЫМ, только что импортированным, данным),
а НЕ независимая сверка с donor-side расчётом, которого в экспорте нет.
AC-1 буквально говорит "совпадают с донором" — трактовка здесь: "донор" =
исходные интервальные факты донора (то, что мы импортировали), а не
отдельно вычисленный на donor-стороне derived-статус (такого поля в
6-моделньом рецепте выгрузки — spikes/1.11 — нет).

Требует ORM — создаёт ``EmployeeStatus``, читает обратно для convergence.
"""

import logging

from django.db import DataError, IntegrityError, transaction

from apps.migration_legacy.transform import Skip, transform_status
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services.strength_report import resolve_status

logger = logging.getLogger(__name__)

MISMATCH_LIMIT = 50


def import_statuses(rows, employee_map, window_start, until, report):
    """rows: statuses.employeestatus dumpdata rows. employee_map: {donor_pk:
    Employee.id} from ``import_employees``. Returns (clamped: int,
    derived_mismatches: list of {"employee_id", "date", "written",
    "resolved"})."""
    transformed = []
    clamped = 0
    for row in rows:
        report.read += 1
        result = transform_status(row["fields"], window_start, until)
        if isinstance(result, Skip):
            report.skip(result.reason, row["pk"])
            continue
        if result.employee_pk not in employee_map:
            report.skip("employee_skipped", row["pk"])
            continue
        transformed.append((row["pk"], result))
        if result.open_end_clamped:
            # Counted here, not on create: the number of shortened
            # intervals in the slice must be identical on every run
            # (decision #6 — 1.8 reads it), including idempotent ones.
            clamped += 1

    # Deterministic insert order decides which of two overlapping donor
    # rows survives the exclusion constraint. Clamped open-end rows go
    # LAST per employee: their stretched [start, window_end+1) interval
    # is an import artifact and must never displace a real closed one.
    transformed.sort(
        key=lambda item: (
            item[1].employee_pk,
            item[1].open_end_clamped,
            item[1].date_start,
            item[1].date_end,
            item[0],
        )
    )

    written_intervals = []  # [(employee_id, date_start, date_end, status_type_code)]
    derived_mismatches = []
    for donor_pk, status in transformed:
        employee_id = employee_map[status.employee_pk]
        # Natural-key idempotency: a cancelled and a live duplicate of
        # the same interval are distinguishable. For clamped rows the
        # key excludes date_end — it equals window_end+1 and would
        # change with --until/--days, breaking idempotency across runs
        # with a different window.
        natural_key = {
            "employee_id": employee_id,
            "status_type_code": status.status_type_code,
            "date_start": status.date_start,
            "cancelled_at__isnull": status.cancelled_at is None,
        }
        if not status.open_end_clamped:
            natural_key["date_end"] = status.date_end
        if EmployeeStatus.objects.filter(**natural_key).exists():
            report.skip("already_exists", donor_pk)
            continue
        try:
            # Savepoint per insert: a bare except inside the outer
            # atomic would leave the transaction aborted.
            with transaction.atomic():
                EmployeeStatus.objects.create(
                    employee_id=employee_id,
                    status_type_code=status.status_type_code,
                    date_start=status.date_start,
                    date_end=status.date_end,
                    cancelled_at=status.cancelled_at,
                )
        except IntegrityError as exc:
            # Donor validation was app-level and leaky: hard×hard
            # overlaps are real data-quality findings for 1.8, not a
            # crash. The import continues. A clamped loser is an
            # artifact of the clamp, not donor data — separate reason.
            message = str(exc)
            if "excl_hard_status_overlap" in message:
                if status.open_end_clamped:
                    report.skip("overlap_with_clamped", donor_pk)
                else:
                    report.skip("hard_overlap", donor_pk)
            elif "chk_status_dates" in message:
                report.skip("invalid_dates", donor_pk)
            else:
                report.skip("integrity_error", donor_pk)
            continue
        except DataError:
            # start > end through the generated column raises DataError
            # before the CHECK fires (review finding of 1.5).
            report.skip("invalid_dates", donor_pk)
            continue
        report.created += 1
        if status.cancelled_at is None:
            written_intervals.append(
                (
                    employee_id,
                    status.date_start,
                    status.date_end,
                    status.status_type_code,
                )
            )

    # --- Convergence check (AC-1, Task 2): only for LIVE (non-cancelled)
    # intervals actually committed above — a cancelled fact never wins
    # resolve_status() and comparing it would be a false mismatch.
    # Batched by employee_id (one query per EMPLOYEE, not per interval) —
    # review fix for an N+1 pattern when one employee has several written
    # intervals in the same slice. ---
    by_employee: dict = {}
    for employee_id, date_start, date_end, code in written_intervals:
        by_employee.setdefault(employee_id, []).append((date_start, date_end, code))

    for employee_id, intervals in by_employee.items():
        live_rows = list(
            EmployeeStatus.objects.filter(
                employee_id=employee_id, cancelled_at__isnull=True
            ).values("status_type_code", "date_start", "date_end")
        )
        seen_checks = set()
        for date_start, date_end, written_code in intervals:
            # Sample date_start PLUS every OTHER live interval's date_start
            # that falls strictly inside [date_start, date_end) — those are
            # exactly the points where the priority winner could flip away
            # from this interval mid-span. Sampling only this interval's
            # OWN start/end (an earlier, insufficient version of this fix)
            # would miss a higher-priority fact that starts in the middle
            # of a long interval without touching either of its edges.
            sample_dates = {date_start}
            for other in live_rows:
                other_start = other["date_start"]
                if date_start < other_start < date_end:
                    sample_dates.add(other_start)
            for on_date in sample_dates:
                # Dedup key MUST include written_code (not just the date) —
                # two different intervals of the SAME employee can each
                # legitimately need checking at the same date (e.g. one
                # interval's own start coincides with a point sampled while
                # checking a different interval); an earlier, buggier
                # version deduped by (employee_id, date) alone and silently
                # skipped a real mismatch whenever two intervals shared a
                # sample date (caught by the golden-fixture regression test).
                dedup_key = (employee_id, on_date, written_code)
                if dedup_key in seen_checks:
                    continue
                seen_checks.add(dedup_key)
                try:
                    resolved_code = resolve_status(live_rows, on_date)
                except Exception:  # noqa: BLE001
                    # Informational check MUST NOT crash the import
                    # transaction (review fix) — log and move on.
                    logger.warning(
                        "resolve_status failed during convergence check "
                        "(employee_id=%s, on_date=%s) — skipping",
                        employee_id,
                        on_date,
                        exc_info=True,
                    )
                    continue
                is_mismatch = resolved_code != written_code
                if is_mismatch and len(derived_mismatches) < MISMATCH_LIMIT:
                    derived_mismatches.append(
                        {
                            "employee_id": employee_id,
                            "date": on_date.isoformat(),
                            "written": written_code,
                            "resolved": resolved_code,
                        }
                    )

    return clamped, derived_mismatches
