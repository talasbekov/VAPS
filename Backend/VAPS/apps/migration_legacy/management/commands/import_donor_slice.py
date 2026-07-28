"""Import a 5-7 day slice of donor data into the walking skeleton (1.6).

Reads a donor ``manage.py dumpdata`` JSON export, creates Employee rows
(identity mapping donor_pk -> uuid via Employee.external_id) and interval
EmployeeStatus rows. Idempotent; every skip is reported with a reason —
the skips are the first data-quality findings for the 1.8 diff and E7.

No wall clock anywhere: the window is derived from the data (--until
defaults to the max date in the export) — the donor is historical.
"""

import json
from collections import defaultdict
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import DataError, IntegrityError, transaction

from apps.core.models import Employee
from apps.migration_legacy.import_orgstructure import (
    EXAMPLE_LIMIT,
    EntityReport,
    import_divisions,
    import_positions,
    import_ranks,
    import_staffing_slots,
)
from apps.migration_legacy.transform import Skip, transform_employee, transform_status
from apps.operations.statuses.models import EmployeeStatus


class Command(BaseCommand):
    help = (
        "Import a donor dumpdata slice: employees (external_id = donor pk) "
        "and statuses for a 5-7 day window. Idempotent, reports every skip."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="path to donor dumpdata JSON export")
        parser.add_argument("--days", type=int, default=7)
        parser.add_argument(
            "--until",
            default=None,
            help="window end YYYY-MM-DD (default: max date in the export)",
        )

    def handle(self, *args, **options):
        try:
            with open(options["file"], encoding="utf-8") as fh:
                rows = json.load(fh)
        except (OSError, ValueError) as exc:
            raise CommandError(f"cannot read export: {exc}")

        by_model = defaultdict(list)
        for row in rows:
            # Unknown model keys are silently ignored: real exports carry
            # extra apps (auth, contenttypes, ...).
            by_model[row["model"]].append(row)

        if options["days"] < 1:
            raise CommandError("--days must be >= 1")

        status_rows = by_model["statuses.employeestatus"]
        until = self._resolve_until(options["until"], status_rows)
        window_start = until - timedelta(days=options["days"] - 1)

        reports = {
            name: EntityReport()
            for name in (
                "organizations",
                "divisions",
                "staffing_slots",
                "ranks",
                "positions",
                "employees",
                "statuses",
            )
        }
        clamped = 0

        with transaction.atomic():
            division_map = import_divisions(
                by_model["divisions.division"],
                reports["organizations"],
                reports["divisions"],
            )
            slot_divisions_covered = import_staffing_slots(
                by_model["staff_unit.staffunit"],
                division_map,
                window_start,
                reports["staffing_slots"],
            )
            rank_map = import_ranks(by_model["dictionaries.rank"], reports["ranks"])
            position_pks = import_positions(
                by_model["dictionaries.position"], reports["positions"]
            )
            employee_map = self._import_employees(
                by_model["employees.employee"],
                by_model["staff_unit.staffunit"],
                division_map,
                rank_map,
                position_pks,
                reports["employees"],
            )
            clamped = self._import_statuses(
                status_rows,
                employee_map,
                window_start,
                until,
                reports["statuses"],
            )

        self._print_report(
            reports, window_start, until, clamped, slot_divisions_covered
        )

    def _resolve_until(self, until_option, status_rows):
        if until_option:
            try:
                return date.fromisoformat(until_option)
            except ValueError:
                raise CommandError(f"--until is not a date: {until_option!r}")
        # Deterministic from data, never from the wall clock: the donor
        # died in prod, "today" would yield an empty window. Malformed date
        # values are ignored here — transform skips those rows anyway.
        all_dates = []
        for row in status_rows:
            for key in ("start_date", "end_date", "actual_end_date"):
                value = row["fields"].get(key)
                if not value:
                    continue
                try:
                    all_dates.append(date.fromisoformat(value))
                except (TypeError, ValueError):
                    continue
        if not all_dates:
            raise CommandError("export has no status dates; pass --until")
        return max(all_dates)

    def _import_employees(
        self, rows, staff_rows, division_map, rank_map, position_pks, report
    ):
        # Donor Employee has no division FK: the link lives in staff_unit.
        staff_by_employee = {
            r["fields"]["employee"]: r["fields"]
            for r in staff_rows
            if r["fields"]["employee"] is not None
        }
        employee_map = {}
        for row in sorted(rows, key=lambda r: r["pk"]):
            report.read += 1
            donor_pk = row["pk"]
            result = transform_employee(row["fields"])
            if isinstance(result, Skip):
                report.skip(result.reason, donor_pk)
                continue
            staff = staff_by_employee.get(donor_pk)
            division = (
                division_map.get(staff["division"]) if staff is not None else None
            )
            if division is None:
                # Employee.division is PROTECT NOT NULL — no slot, no import.
                report.skip("no_division", donor_pk)
                continue
            rank_code, rank_index = rank_map.get(result.rank_pk, ("", 0))
            position_pk = staff["position"]
            position_code = f"POS_{position_pk}" if position_pk in position_pks else ""
            try:
                with transaction.atomic():
                    employee, created = Employee.objects.update_or_create(
                        # Identity mapping donor_pk -> uuid (AC-1): the
                        # unique external_id field exists for this.
                        external_id=str(donor_pk),
                        defaults={
                            "iin": result.iin,
                            "personnel_number": result.personnel_number,
                            "last_name": result.last_name,
                            "first_name": result.first_name,
                            "middle_name": result.middle_name,
                            "birth_date": result.birth_date,
                            "gender": result.gender,
                            "hire_date": result.hire_date,
                            "dismissal_date": result.dismissal_date,
                            "employment_status": result.employment_status,
                            "rank_code": rank_code,
                            "rank_index": rank_index,
                            "position_code": position_code,
                            "division": division,
                            "data_source": "DONOR",
                            # created_by stays NULL: no actor, honest NULL.
                        },
                    )
            except IntegrityError as exc:
                message = str(exc)
                # NOT NULL violations mention the column name too — check
                # them first or a missing field masquerades as a duplicate.
                if "null value" in message:
                    reason = "missing_required_field"
                elif "iin" in message:
                    reason = "duplicate_iin"
                elif "personnel_number" in message:
                    reason = "duplicate_personnel_number"
                else:
                    reason = "integrity_error"
                report.skip(reason, donor_pk)
                continue
            report.count(created)
            employee_map[donor_pk] = employee.id
        return employee_map

    def _import_statuses(self, rows, employee_map, window_start, until, report):
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
        return clamped

    def _print_report(
        self, reports, window_start, until, clamped, slot_divisions_covered
    ):
        write = self.stdout.write
        for name, report in reports.items():
            line = (
                f"{name}: read {report.read}, created {report.created}, "
                f"updated {report.updated}, skipped {report.skipped}"
            )
            write(self.style.SUCCESS(line))
            for reason, pks in sorted(report.skips.items()):
                examples = ", ".join(str(pk) for pk in pks[:EXAMPLE_LIMIT])
                write(f"  - {reason}: {len(pks)} (examples: {examples})")
            for reason, pks in sorted(report.warnings.items()):
                examples = ", ".join(str(pk) for pk in pks[:EXAMPLE_LIMIT])
                write(f"  ~ {reason}: {len(pks)} (examples: {examples})")
        # Explicit lines for 1.8 (diff reads these).
        statuses = reports["statuses"]
        write(
            self.style.SUCCESS(
                f"staffing divisions covered: {slot_divisions_covered}"
            )
        )
        write(self.style.SUCCESS(f"open_end_clamped: {clamped}"))
        write(
            self.style.SUCCESS(
                f"hard_overlap: {len(statuses.skips.get('hard_overlap', []))}"
            )
        )
        # The window is the closing line of the report (Task 3).
        write(
            self.style.SUCCESS(
                f"window [{window_start.isoformat()}..{until.isoformat()}]"
            )
        )
