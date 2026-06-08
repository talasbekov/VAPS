from apps.operations.models import UserRole


class OpsUserRoleSelector:
    """Read-only access to user-role assignments."""

    @staticmethod
    def active_for_user(user_id):
        return list(
            UserRole.objects.filter(user_id=user_id, is_active=True).select_related("role_code")
        )
