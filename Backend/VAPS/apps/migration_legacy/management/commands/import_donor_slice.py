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

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.core.models import DivisionHistoricalSlot, Position, Rank
from apps.core.selectors import local_midnight
from apps.migration_legacy.transform import (
    Skip,
    count_staff_slots,
    transform_employee,
    transform_status,
)
from apps.operations.statuses.models import EmployeeStatus

EXAMPLE_LIMIT = 5


class EntityReport:
    def __init__(self):
        self.read = 0
        self.created = 0
        self.updated = 0
        self.skips = defaultdict(list)
        self.warnings = defaultdict(list)

    def count(self, created):
        if created:
            self.created += 1
        else:
            self.updated += 1

    def skip(self, reason, donor_pk):
        self.skips[reason].append(donor_pk)

    def warn(self, reason, donor_pk):
        # The row WAS imported, but with a caveat 1.8 must see (a warning
        # is not a skip — it must not inflate the skipped counter).
        self.warnings[reason].append(donor_pk)

    @property
    def skipped(self):
        return sum(len(pks) for pks in self.skips.values())


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
            division_map = self._import_divisions(
                by_model["divisions.division"], reports
            )
            slot_divisions_covered = self._import_staffing_slots(
                by_model["staff_unit.staffunit"],
                division_map,
                window_start,
                reports["staffing_slots"],
            )
            rank_map = self._import_ranks(by_model["dictionaries.rank"], reports)
            position_pks = self._import_positions(
                by_model["dictionaries.position"], reports
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

    def _import_divisions(self, rows, reports):
        div_rows = {row["pk"]: row for row in rows}
        org_report = reports["organizations"]
        div_report = reports["divisions"]

        def is_org_root(row):
            f = row["fields"]
            return f["division_type"] == "organization" and f["parent"] is None

        org_map = {}
        for pk, row in sorted(div_rows.items()):
            if not is_org_root(row):
                continue
            org_report.read += 1
            org, created = Organization.objects.update_or_create(
                code=row["fields"]["code"],
                defaults={"name": row["fields"]["name"]},
            )
            org_report.count(created)
            org_map[pk] = org

        fallback_org = None

        def org_for(row):
            nonlocal fallback_org
            cur = row
            seen = {cur["pk"]}
            while (
                cur["fields"]["parent"] is not None
                and cur["fields"]["parent"] in div_rows
            ):
                parent_pk = cur["fields"]["parent"]
                if parent_pk in seen:
                    # Broken donor tree (A→B→A): bail out to the fallback
                    # org instead of looping forever inside the transaction.
                    break
                seen.add(parent_pk)
                cur = div_rows[parent_pk]
            root_org = org_map.get(cur["pk"])
            if root_org is not None:
                return root_org
            if fallback_org is None:
                fallback_org, created = Organization.objects.update_or_create(
                    code="DONOR", defaults={"name": "Импорт донора"}
                )
                org_report.count(created)
            return fallback_org

        division_map = {}
        for pk, row in sorted(div_rows.items()):
            if is_org_root(row):
                continue
            div_report.read += 1
            fields = row["fields"]
            # Literal donor type codes, no translation (Glossary STOP);
            # department/division match seed_core, directorate gets added.
            type_code, _ = DivisionType.objects.get_or_create(
                code=fields["division_type"],
                defaults={"name": fields["division_type"]},
            )
            division, created = Division.objects.update_or_create(
                organization=org_for(row),
                code=fields["code"],
                defaults={"name": fields["name"], "type_code": type_code},
            )
            div_report.count(created)
            division_map[pk] = division

        # Second pass: parents (donor MPTT order is not creation-safe).
        for pk, row in sorted(div_rows.items()):
            division = division_map.get(pk)
            if division is None:
                continue
            parent_pk = row["fields"]["parent"]
            desired = division_map.get(parent_pk)  # org root -> None
            if desired is None and parent_pk is not None and parent_pk not in div_rows:
                # Dangling parent ref (partial export): the division is
                # imported at the root, but silently flattening would be
                # indistinguishable from a legal org-root parent.
                div_report.warn("dangling_parent", pk)
            desired_pk = desired.pk if desired is not None else None
            if division.parent_id != desired_pk:
                division.parent = desired
                division.save(update_fields=["parent"])

        return division_map

    def _import_staffing_slots(self, rows, division_map, window_start, report):
        """Materialize Штат: one DivisionHistoricalSlot per division.

        Sanctioned by the 1.6 handoff («Если 1.7 упрётся в "Вакансии" —
        расширение делается в 1.7»). One timeline row per import window:
        update_or_create on (division, valid_from=local midnight of
        window_start) is idempotent for the same window; a different
        window adds a second row and the selector takes the one with max
        valid_from (Решение №5; the full timeline policy is E7).
        """
        report.read = len(rows)
        counts, skips = count_staff_slots(rows)
        for reason, pks in skips.items():
            for pk in pks:
                report.skip(reason, pk)
        valid_from = local_midnight(window_start)
        # Donor divisions sharing (organization, code) collapse into ONE
        # Division (unique_org_division_code): SUM their per-donor-pk counts
        # onto the resolved Division so Штат (BR-002 STAFF_TOTAL) is the
        # total of all donor slots, not just the last pk's — and count
        # "covered" once per distinct Division (review C2/KO-2 2026-06-15).
        slots_by_division: dict = {}
        resolved: dict = {}
        for division_pk in sorted(counts):
            division = division_map.get(division_pk)
            if division is None:
                # Examples carry the donor DIVISION pk (the slot pks are
                # lost in the counting), unlike the per-row skips above.
                report.skip("slot_division_skipped", division_pk)
                continue
            resolved[division.pk] = division
            slots_by_division[division.pk] = (
                slots_by_division.get(division.pk, 0) + counts[division_pk]
            )
        covered = 0
        for div_id, allocated in slots_by_division.items():
            _, created = DivisionHistoricalSlot.objects.update_or_create(
                division=resolved[div_id],
                valid_from=valid_from,
                # allocated_slots stays in defaults: a re-run with a changed
                # slot count must UPDATE the same-window row.
                defaults={"allocated_slots": allocated},
            )
            report.count(created)
            covered += 1
        return covered

    def _import_ranks(self, rows, reports):
        rank_map = {}
        for row in sorted(rows, key=lambda r: r["pk"]):
            reports["ranks"].read += 1
            fields = row["fields"]
            # Donor has no codes (name+level only): a synthetic stable code
            # from donor_pk keeps the import idempotent (decision #9).
            # NB: donor level is "smaller = higher", seed_core rank_index is
            # "bigger = higher" — carried AS IS, no inversion; the consumer
            # arrives in 2.6 (sort canon) and decides there.
            _, created = Rank.objects.update_or_create(
                code=f"RANK_{row['pk']}",
                defaults={"name": fields["name"], "rank_index": fields["level"]},
            )
            reports["ranks"].count(created)
            rank_map[row["pk"]] = (f"RANK_{row['pk']}", fields["level"])
        return rank_map

    def _import_positions(self, rows, reports):
        position_pks = set()
        for row in sorted(rows, key=lambda r: r["pk"]):
            reports["positions"].read += 1
            fields = row["fields"]
            _, created = Position.objects.update_or_create(
                code=f"POS_{row['pk']}",
                defaults={"name": fields["name"], "level": fields["level"]},
            )
            reports["positions"].count(created)
            position_pks.add(row["pk"])
        return position_pks

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
