"""Story 4.1 — AuditLog: append-only audit record (db_table ``audit_logs``).

Foundation of the audit context (E4). Fields follow the §4.6 DDL
(``docs/PersonnelStatus/VAPS_7.8.2.md:926-941``) PLUS ``request_id`` (named by
the epic / architecture §Communication Patterns / audit-events.yaml record_shape
but absent from the §4.6 SQL — reconciled as a union; see story 4.1 Dev Agent
Record).

Append-only by design: DB-level enforcement (REVOKE UPDATE/DELETE + trigger,
ARCH-SEC-032) is story 4.2; the SINGLE write point ``audit.services.record()``
is story 4.3; the status-mutation events are 4.4. ``action`` values are the
UPPER_SNAKE codes from ``docs/registries/audit-events.yaml`` (closed world) —
validation/seed is the write service's job, not the model's.

Deliberately does NOT inherit a TimeStampedModel base: append-only has no
``updated_at``; the actor is the ``actor_user_id`` STRING — the authenticated
actor id from the request, never a ``core_employees.id`` (BR-ACCOUNT-002).
``created_at`` carries NO
``auto_now_add`` / DB default — the write service (4.3) injects it via
``Clock.now()`` so audit time flows through the one controllable clock
(ARCH-DATA-022; closes the E3-retro "Clock-enforce audit time" item).
"""

import uuid

from django.db import models


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_user_id = models.CharField(max_length=100)
    action = models.CharField(max_length=100)  # UPPER_SNAKE from audit-events.yaml
    entity_type = models.CharField(max_length=100)
    entity_id = models.UUIDField()
    old_value = models.JSONField(null=True, blank=True)  # "before"
    new_value = models.JSONField(null=True, blank=True)  # "after"
    reason = models.TextField(blank=True, default="")
    # Request-scoped; populated by the request_id middleware (story 4.3).
    request_id = models.CharField(max_length=100, blank=True, default="")
    ip_address = models.GenericIPAddressField()  # §4.6 VARCHAR(45), IPv6-capable
    user_agent = models.TextField(blank=True, default="")
    # No auto_now_add / DB default: the write service (4.3) sets it via Clock.now().
    created_at = models.DateTimeField()

    class Meta:
        db_table = "audit_logs"
        indexes = [
            models.Index(
                fields=["entity_type", "entity_id", "created_at"],
                name="idx_audit_entity",
            ),
        ]

    def __str__(self):
        return f"{self.action} {self.entity_type}:{self.entity_id}"
