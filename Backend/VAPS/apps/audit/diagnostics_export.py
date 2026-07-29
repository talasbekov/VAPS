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
_PHONE_RE = re.compile(r"\+?\d[\d\-\s()]{8,14}\d")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def scrub_description(text: str) -> str:
    """Best-effort redaction of IIN/phone/email-shaped substrings."""
    text = _EMAIL_RE.sub("[email скрыт]", text)
    text = _IIN_RE.sub("[ИИН скрыт]", text)
    text = _PHONE_RE.sub("[телефон скрыт]", text)
    return text


def _bugreports_payload(date_from, date_to) -> list[dict]:
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

    exported_at = Clock.now().isoformat()
    archive_name = f"diagnostics-{date_from.isoformat()}_{date_to.isoformat()}.zip"
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
