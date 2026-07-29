from django.db import models

from apps.operations.models import TimeStampedModel


class BugReport(TimeStampedModel):
    """Story 13.1a: «сообщить о проблеме», cost ~0.

    Visibility is gated at the API layer (bugreports.view permission code,
    apps/operations/bugreports/api/views.py) — nothing here restricts reads;
    that's a business-authz concern, not a schema concern.
    """

    # ARCH-007 / BR-ACCOUNT-002: external auth user_id, never core_employees FK
    # — same convention as UserRole.user_id (apps/operations/rbac/models.py).
    user_id = models.CharField(max_length=100)
    screen_path = models.CharField(max_length=255)
    app_version = models.CharField(max_length=100, blank=True)
    build_sha = models.CharField(max_length=100, blank=True)
    # Client-collected — this app does not build its own request-id history
    # (apps/core/middleware.py's RequestContextMiddleware only tracks the
    # CURRENT request, no rolling per-user log; the frontend accumulates the
    # last few from response X-Request-Id headers and sends them as-is).
    last_request_ids = models.JSONField(default=list, blank=True)
    description = models.TextField()

    class Meta:
        db_table = "ops_bug_reports"
        indexes = [
            models.Index(fields=["created_at"], name="idx_ops_bugreports_created"),
        ]

    def __str__(self):
        return f"BugReport({self.pk}, {self.user_id})"
