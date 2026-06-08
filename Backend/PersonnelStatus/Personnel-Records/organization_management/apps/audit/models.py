# Register the target AuditLog model (defined in domain/models.py) with the
# audit app so Django associates it with this app's migrations. AuditLog is the
# single audit implementation; the legacy AuditEntry model has been removed.
from organization_management.apps.audit.domain.models import AuditLog  # noqa: F401
