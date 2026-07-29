"""Story 13.2 — diagnostics export orchestration: BugReport rows (13.1a) +
AuditLog rows for a period, zipped with a manifest, for legal removal from
the closed circuit by media.

Lives INSIDE apps/audit (like selectors.py) — the AST write/read-boundary
ban restricts importing apps.audit.models from outside this app; reading
AuditLog directly here (not through AuditLogSelector, which requires an
RBAC-scoped HTTP actor) is legitimate for a trusted CLI/system context, the
same reasoning every other management command already relies on when it
queries models directly instead of going through the API layer.
"""

import hashlib
import json
import re
import zipfile
from pathlib import Path

from apps.audit.models import AuditLog
from apps.core.clock import Clock
from apps.operations.bugreports.models import BugReport

# Best-effort, NOT exhaustive PII scrubbing for BugReport.description free
# text — the one field with real PII risk (user_id/screen_path are not PII,
# per apps/operations/bugreports/models.py's own ARCH-007/BR-ACCOUNT-002
# comment). Catches the obvious dangerous patterns an operator might paste
# in without thinking (IIN, phone, email) — NOT a substitute for a human
# reviewing before the archive leaves the circuit.
_IIN_RE = re.compile(r"\b\d{12}\b")
# Review (Blind Hunter): {8,14} was one character too short to cover the
# common KZ local-dial format with a leading 8 and spaced area code, e.g.
# "8 (701) 234-56-78" (16 separator/digit chars between the first and last
# digit) — the trailing digit leaked past the redaction. Widened with margin
# for "+7 (701) 234-56-78" too.
_PHONE_RE = re.compile(r"\+?\d[\d\-\s()]{8,18}\d")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def scrub_description(text: str) -> str:
    """Best-effort redaction of IIN/phone/email-shaped substrings."""
    text = _EMAIL_RE.sub("[email скрыт]", text)
    text = _IIN_RE.sub("[ИИН скрыт]", text)
    text = _PHONE_RE.sub("[телефон скрыт]", text)
    return text


def _bugreports_payload(date_from, date_to) -> list[dict]:
    # Review (Edge Case Hunter): created_at__date under USE_TZ=True resolves
    # in the ACTIVE connection timezone, which Django sets to
    # settings.TIME_ZONE ("Asia/Qyzylorda") by default outside a per-request
    # override — an operator typing --from/--to in local dates gets the
    # local-day boundary they expect, not a UTC-shifted one. No management
    # command in this codebase does date-range filtering on a DateTimeField
    # (strength_report.py/parallel_run_diff.py both take an explicit `date`
    # argument instead), so this is new territory, not an established
    # pattern — documented here so a future reader doesn't "fix" it into a
    # UTC bug.
    rows = BugReport.objects.filter(
        created_at__date__gte=date_from, created_at__date__lte=date_to
    ).order_by("created_at")
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "screen_path": r.screen_path,
            "app_version": r.app_version,
            "build_sha": r.build_sha,
            "last_request_ids": r.last_request_ids,
            "description": scrub_description(r.description),
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


def _audit_log_payload(date_from, date_to) -> list[dict]:
    # Deliberately EXCLUDES old_value/new_value (AC-2/Out of Scope): that's
    # where real business-data PII risk lives (e.g. employee fields flowing
    # through an audited mutation) — simpler and safer to omit the whole
    # column than to content-scan arbitrary nested JSON.
    rows = AuditLog.objects.filter(
        created_at__date__gte=date_from, created_at__date__lte=date_to
    ).order_by("created_at")
    return [
        {
            "id": str(r.id),
            "actor_user_id": r.actor_user_id,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": str(r.entity_id),
            "request_id": r.request_id,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


def build_export(*, date_from, date_to, actor: str, out_dir: Path) -> Path:
    """Write the .zip and return its path. Does NOT write the AuditLog row
    for the export itself — the caller (management command) does that,
    since it needs the archive's sha256 (computed here, returned via the
    manifest) as entity_id.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    bugreports = _bugreports_payload(date_from, date_to)
    audit_rows = _audit_log_payload(date_from, date_to)

    exported_at_dt = Clock.now()
    exported_at = exported_at_dt.isoformat()
    # Review (Blind Hunter): a filename keyed ONLY on --from/--to collides on
    # re-run of the same range (a realistic scenario — e.g. re-exporting
    # after a new BugReport came in) — zipfile's "w" mode silently
    # TRUNCATES the earlier archive, while the AuditLog row already written
    # for that earlier run still references a sha256 that no longer exists
    # on disk. A run-timestamp in the filename makes every run's archive a
    # distinct file — the audit trail stays verifiable.
    # Microsecond resolution, not just seconds: two runs in the same test/
    # script can land in the same second (verified — two back-to-back CLI
    # calls in a loop collided on a seconds-only stamp).
    run_stamp = exported_at_dt.strftime("%Y%m%dT%H%M%S%f")
    archive_name = (
        f"diagnostics-{date_from.isoformat()}_{date_to.isoformat()}-{run_stamp}.zip"
    )
    archive_path = out_dir / archive_name

    bugreports_json = json.dumps(bugreports, ensure_ascii=False, indent=2)
    audit_log_json = json.dumps(audit_rows, ensure_ascii=False, indent=2)

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bugreports.json", bugreports_json)
        zf.writestr("audit_log.json", audit_log_json)
        manifest = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "actor": actor,
            "exported_at": exported_at,
            "bugreports_count": len(bugreports),
            "audit_rows_count": len(audit_rows),
            "bugreports_sha256": hashlib.sha256(
                bugreports_json.encode("utf-8")
            ).hexdigest(),
            "audit_log_sha256": hashlib.sha256(
                audit_log_json.encode("utf-8")
            ).hexdigest(),
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    return archive_path
