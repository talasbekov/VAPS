"""Story 13.2 — export BugReport (13.1a) + AuditLog rows for a period into a
zip archive for legal removal from the closed circuit by media, and record
the export itself in AuditLog.

READ-ONLY over BugReport/AuditLog, one WRITE: the export's own audit row.
FIRST management command in this codebase to call apps.audit.services.record()
— every other command runs outside an HTTP request, where
get_request_context() (apps/core/middleware.py) returns an empty context;
record()'s existing _SYSTEM_IP sentinel already covers that, no change to
record() itself was needed.
"""

import hashlib
import uuid
from datetime import date, datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.audit.diagnostics_export import build_export
from apps.audit.services import record

# settings.BASE_DIR is Backend/VAPS (config/settings.py) — repo root (where
# deploy/ lives) is two levels up: Backend/VAPS -> Backend -> repo root.
_DEFAULT_OUT_DIR = (
    Path(settings.BASE_DIR).parent.parent / "deploy" / "diagnostics-exports"
)


class Command(BaseCommand):
    help = (
        "Export BugReport + AuditLog rows for a date range into a zip "
        "archive (PII-scrubbed) and record the export in AuditLog."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--from", dest="from_date", required=True, help="YYYY-MM-DD"
        )
        parser.add_argument("--to", dest="to_date", required=True, help="YYYY-MM-DD")
        parser.add_argument(
            "--actor",
            required=True,
            help=(
                "CLI operator identity for the AuditLog row — no HTTP "
                "request here, so there is no request.actor_id to read; "
                "must be supplied explicitly (AC-4)."
            ),
        )
        parser.add_argument(
            "--out-dir",
            default=str(_DEFAULT_OUT_DIR),
            help="output directory (default: deploy/diagnostics-exports/)",
        )

    def handle(self, *args, **options):
        date_from = self._parse_date(options["from_date"], "--from")
        date_to = self._parse_date(options["to_date"], "--to")
        if date_from > date_to:
            raise CommandError("--from must not be after --to")
        actor = options["actor"].strip()
        if not actor:
            raise CommandError("--actor must not be blank")

        archive_path = build_export(
            date_from=date_from,
            date_to=date_to,
            actor=actor,
            out_dir=Path(options["out_dir"]),
        )

        archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()

        entry = record(
            actor=actor,
            action="DIAGNOSTICS_EXPORTED",
            entity_type="diagnostics_export",
            entity_id=_deterministic_entity_id(archive_sha256),
            new_value={
                "from": date_from.isoformat(),
                "to": date_to.isoformat(),
                "archive": archive_path.name,
                "archive_sha256": archive_sha256,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Экспорт готов: {archive_path} (sha256={archive_sha256[:12]}...), "
                f"AuditLog id={entry.id}"
            )
        )

    @staticmethod
    def _parse_date(value: str, flag: str) -> date:
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise CommandError(
                f"{flag} должен быть YYYY-MM-DD, получено: {value!r}"
            ) from exc


def _deterministic_entity_id(archive_sha256: str) -> uuid.UUID:
    # entity_id is a UUIDField (apps/audit/models.py) — the archive's own
    # sha256 is a hex digest, not a UUID; derive a deterministic uuid5 from
    # it (same technique already established for TomorrowBlockOverride,
    # apps/operations/statuses — a UUID entity_id from a non-UUID natural
    # key, without inventing a new pattern).
    return uuid.uuid5(uuid.NAMESPACE_OID, archive_sha256)
