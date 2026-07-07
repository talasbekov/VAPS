from django.apps import AppConfig


class OpsSubmissionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.operations.submissions"
    label = "ops_submissions"

    def ready(self):
        # Inverse amendment seam (5.4b): register the submissions-side enforcement
        # handler into the statuses-owned slot. submissions → statuses is the
        # allowed direction (architecture.md#L587); statuses never imports
        # submissions. Imports are inside ready() so the app registry is loaded.
        from apps.operations.statuses.amendment_hook import register_amendment_handler
        from apps.operations.submissions.amendment_enforcement import (
            enforce_amendment_on_retro_edit,
        )

        register_amendment_handler(enforce_amendment_on_retro_edit)
