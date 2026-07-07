"""Story 4.2 — append-only `audit_logs` enforced by the database (ARCH-SEC-032).

A ``BEFORE UPDATE / DELETE / TRUNCATE`` trigger raises on any attempt to mutate
or wipe the audit table, plus a ``REVOKE UPDATE, DELETE`` for defense-in-depth.

The TRIGGER is the actual barrier: the app connects as the table owner (``vaps``)
and a PostgreSQL owner BYPASSES ``REVOKE``, so REVOKE alone would not block it —
a trigger fires for every role. It raises with ``ERRCODE = restrict_violation``
(SQLSTATE 23001, class 23) so Django surfaces it as ``IntegrityError``.

``RunSQL`` is given a LIST of statements (not one string): Django then runs each
verbatim with ``params=None`` (no ``sqlparse`` splitting that would choke on the
``;`` inside the ``$$ … $$`` function body, and no ``%``-interpolation so the
``RAISE`` format ``%`` stays literal).
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                (
                    "CREATE OR REPLACE FUNCTION audit_logs_reject_modification()\n"
                    "RETURNS trigger LANGUAGE plpgsql AS $$\n"
                    "BEGIN\n"
                    "    RAISE EXCEPTION "
                    "'audit_logs is append-only (ARCH-SEC-032): % rejected', TG_OP\n"
                    "        USING ERRCODE = 'restrict_violation';\n"
                    "END;\n"
                    "$$;"
                ),
                (
                    "CREATE OR REPLACE TRIGGER trg_audit_logs_no_update\n"
                    "    BEFORE UPDATE ON audit_logs\n"
                    "    FOR EACH ROW EXECUTE FUNCTION "
                    "audit_logs_reject_modification();"
                ),
                (
                    "CREATE OR REPLACE TRIGGER trg_audit_logs_no_delete\n"
                    "    BEFORE DELETE ON audit_logs\n"
                    "    FOR EACH ROW EXECUTE FUNCTION "
                    "audit_logs_reject_modification();"
                ),
                (
                    "CREATE OR REPLACE TRIGGER trg_audit_logs_no_truncate\n"
                    "    BEFORE TRUNCATE ON audit_logs\n"
                    "    FOR EACH STATEMENT EXECUTE FUNCTION "
                    "audit_logs_reject_modification();"
                ),
                "REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;",
            ],
            reverse_sql=[
                "DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;",
                "DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;",
                "DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;",
                "DROP FUNCTION IF EXISTS audit_logs_reject_modification();",
            ],
        ),
    ]
