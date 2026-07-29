"""Story 13.6 — "view last errors" command over the JSON errors journal.

Read-only over the file written by LOGGING's ``errors_journal`` handler
(config/settings.py) and, when ``--request-id`` is given, over
``BugReport.last_request_ids`` — the ALREADY-EXISTING hook (13.1a) the
frontend fills from response ``X-Request-Id`` headers. No new FK/migration:
the "link" between a log entry and a bug report is the shared request_id
value, made queryable here.

Lives under apps/operations/bugreports/, NOT apps/core/: this command
queries the BugReport model, and apps.core must not import other
contexts' models (test_isolation.py::
test_core_does_not_import_other_context_models) — the reverse direction
(other apps depending on apps.core) is the allowed one.
"""

import json

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.operations.bugreports.models import BugReport

DEFAULT_N = 20


class Command(BaseCommand):
    help = (
        "Show the last N entries of the errors journal, optionally filtered "
        "by --request-id (and any matching BugReport)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--n",
            type=int,
            default=DEFAULT_N,
            help=f"entries to show (default {DEFAULT_N})",
        )
        parser.add_argument(
            "--request-id",
            default=None,
            help="only entries with this request_id, plus any matching BugReport",
        )

    def handle(self, *args, **options):
        entries = self._read_entries()

        request_id = options["request_id"]
        if request_id:
            entries = [e for e in entries if e.get("request_id") == request_id]

        # Review (Blind Hunter): entries[-0:] is entries[0:] (the WHOLE list,
        # not empty) — Python's -0 == 0 gotcha. --n 0 must show nothing, not
        # everything; guard explicitly rather than rely on negative slicing.
        n = max(options["n"], 0)
        for entry in (entries[-n:] if n else []):
            self._print_entry(entry)

        if request_id:
            self._print_matching_bug_reports(request_id)

    def _read_entries(self):
        path = settings.VAPS_ERROR_LOG_PATH
        entries = []
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        # A truncated/corrupt line must not crash the whole
                        # command — skip it, keep reading the rest.
                        continue
        except FileNotFoundError:
            self.stdout.write(self.style.WARNING(f"Лог-файл не найден: {path}"))
        return entries

    def _print_entry(self, entry):
        self.stdout.write(
            f"[{entry.get('timestamp')}] {entry.get('level')} "
            f"{entry.get('logger')} request_id={entry.get('request_id')} — "
            f"{entry.get('message')}"
        )
        if entry.get("exception"):
            self.stdout.write(entry["exception"])

    def _print_matching_bug_reports(self, request_id):
        reports = BugReport.objects.filter(last_request_ids__contains=[request_id])
        if not reports.exists():
            self.stdout.write(
                self.style.WARNING(f"Багрепортов с request_id={request_id} не найдено")
            )
            return
        for report in reports:
            self.stdout.write(
                self.style.SUCCESS(
                    f"BugReport id={report.id} screen_path={report.screen_path} "
                    f"description={report.description[:100]!r}"
                )
            )
