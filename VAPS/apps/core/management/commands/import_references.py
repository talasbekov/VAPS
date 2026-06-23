"""Idempotent CSV import of core reference catalogs — positions and ranks (2.7, FR-39).

Generalises seed_core's hardcoded ``update_or_create`` into a CSV-driven bulk
load. Every rejected row is reported with its CSV line number and a reason; a
bad row never aborts the import of the others (per-row savepoint, mirroring
import_donor_slice). No model changes, no migration — Position and Rank already
exist (core/0003, core/0004).
"""

import csv
import os
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import DataError, IntegrityError, transaction

from apps.core.models import Position, Rank

EXAMPLE_LIMIT = 5

POSITION_COLUMNS = ["code", "name", "level", "sort_order"]
RANK_COLUMNS = ["code", "name", "category", "rank_index"]


class EntityReport:
    def __init__(self):
        self.read = 0
        self.created = 0
        self.updated = 0
        self.skips = defaultdict(list)

    def count(self, created):
        if created:
            self.created += 1
        else:
            self.updated += 1

    def skip(self, reason, example):
        self.skips[reason].append(example)

    @property
    def skipped(self):
        return sum(len(examples) for examples in self.skips.values())


def _parse_int(raw):
    """Blank -> 0; integer string -> int; anything else -> None (invalid)."""
    text = (raw or "").strip()
    if text == "":
        return 0
    try:
        return int(text)
    except ValueError:
        return None


def _is_ragged(row, columns):
    """A CSV row whose field count differs from the header. Surplus values land
    under csv.DictReader's None restkey; a short row leaves a header column at
    None (restval). Distinct from a present-but-empty cell, which is ""."""
    if None in row:
        return True
    return any(row.get(c) is None for c in columns)


class Command(BaseCommand):
    help = (
        "Import core reference catalogs from CSV: --positions and/or --ranks. "
        "Idempotent (update_or_create on code); every bad row is reported with "
        "its CSV line number and reason."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--positions",
            default=None,
            help="path to positions CSV (code,name,level,sort_order)",
        )
        parser.add_argument(
            "--ranks",
            default=None,
            help="path to ranks CSV (code,name,category,rank_index)",
        )

    def handle(self, *args, **options):
        positions_path = options["positions"]
        ranks_path = options["ranks"]
        if not positions_path and not ranks_path:
            raise CommandError("nothing to import: pass --positions and/or --ranks")

        reports = {}
        if positions_path:
            reports["positions"] = self._import_positions(positions_path)
        if ranks_path:
            reports["ranks"] = self._import_ranks(ranks_path)
        self._print_report(reports)

    # -- reading -------------------------------------------------------------

    def _read_rows(self, path, required_columns):
        """Yield (csv_line_number, row_dict). Raises CommandError on a structurally
        unusable file (missing path, missing required header column, undecodable
        bytes, or malformed CSV) — file-level failures, not per-row skips."""
        if not os.path.exists(path):
            raise CommandError(f"file not found: {path}")
        # ``utf-8-sig`` transparently strips a leading BOM (Excel "CSV UTF-8"
        # export) so the first header is not read as "﻿code".
        try:
            with open(path, newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                fields = reader.fieldnames or []
                missing = [c for c in required_columns if c not in fields]
                if missing:
                    raise CommandError(
                        f"{path}: missing required column(s): {', '.join(missing)}"
                    )
                for row in reader:
                    yield reader.line_num, row
        except UnicodeDecodeError as exc:
            raise CommandError(f"{path}: not valid UTF-8 ({exc})") from exc
        except csv.Error as exc:
            raise CommandError(f"{path}: malformed CSV ({exc})") from exc

    # -- per-entity import ---------------------------------------------------

    def _import_positions(self, path):
        report = EntityReport()
        seen = set()
        for line, row in self._read_rows(path, POSITION_COLUMNS):
            report.read += 1
            code = (row.get("code") or "").strip()
            example = f"{line}:{code or '?'}"
            if _is_ragged(row, POSITION_COLUMNS):
                report.skip("malformed_row", example)
                continue
            name = (row.get("name") or "").strip()
            if not code:
                report.skip("empty_code", example)
                continue
            if not name:
                report.skip("empty_name", example)
                continue
            if code in seen:
                report.skip("duplicate_in_file", example)
                continue
            level = _parse_int(row.get("level"))
            # Ordinals are non-negative (a negative level sorts senior to 0 in
            # the roster canon — story 2.12 / deferred #L193). The model
            # validator only fires on full_clean (Admin/API), not this bulk
            # upsert, so the floor is enforced here too.
            if level is None or level < 0:
                report.skip("invalid_level", example)
                continue
            sort_order = _parse_int(row.get("sort_order"))
            if sort_order is None or sort_order < 0:
                report.skip("invalid_sort_order", example)
                continue
            seen.add(code)
            self._upsert(
                Position,
                code,
                {"name": name, "level": level, "sort_order": sort_order},
                report,
                example,
            )
        return report

    def _import_ranks(self, path):
        report = EntityReport()
        seen = set()
        for line, row in self._read_rows(path, RANK_COLUMNS):
            report.read += 1
            code = (row.get("code") or "").strip()
            example = f"{line}:{code or '?'}"
            if _is_ragged(row, RANK_COLUMNS):
                report.skip("malformed_row", example)
                continue
            name = (row.get("name") or "").strip()
            if not code:
                report.skip("empty_code", example)
                continue
            if not name:
                report.skip("empty_name", example)
                continue
            if code in seen:
                report.skip("duplicate_in_file", example)
                continue
            category = (row.get("category") or "").strip() or None
            rank_index = _parse_int(row.get("rank_index"))
            if rank_index is None or rank_index < 0:
                report.skip("invalid_rank_index", example)
                continue
            seen.add(code)
            self._upsert(
                Rank,
                code,
                {"name": name, "category": category, "rank_index": rank_index},
                report,
                example,
            )
        return report

    def _upsert(self, model, code, defaults, report, example):
        # Per-row savepoint: a DB-level rejection of one row must not roll back
        # the rows already imported (mirrors import_donor_slice).
        try:
            with transaction.atomic():
                _, created = model.objects.update_or_create(
                    code=code, defaults=defaults
                )
        except IntegrityError:
            report.skip("integrity_error", example)
            return
        except DataError:
            report.skip("invalid_value", example)
            return
        report.count(created)

    # -- reporting -----------------------------------------------------------

    def _print_report(self, reports):
        write = self.stdout.write
        for name, report in reports.items():
            write(
                self.style.SUCCESS(
                    f"{name}: read {report.read}, created {report.created}, "
                    f"updated {report.updated}, skipped {report.skipped}"
                )
            )
            for reason, examples in sorted(report.skips.items()):
                shown = ", ".join(examples[:EXAMPLE_LIMIT])
                write(f"  - {reason}: {len(examples)} (examples: {shown})")
