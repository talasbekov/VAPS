"""Admin-регистрация справочников сдачи (Story 2.11 / 5.7b1).

SubmissionControlSettings — singleton-настройки (Story 2.3 «правка через
Admin»), НЕ DailySubmission (бизнес, E5; ARCH#L467/L485). Singleton:
запрет add (если строка есть) и delete — DB защищает CheckConstraint
singleton_key=1, гейты делают UX чистым.

DivisionNotifyRecipient — справочник получателей уведомлений (config,
admin-managed, Story 5.7b1) → регистрируется, в отличие от бизнес-записей
Notification/DailySubmission. Edit-safety (recipient non-blank+strip) — на
model.clean(); ModelForm вызывает full_clean, поэтому пустой/пробельный recipient
даёт понятную ошибку, а не raw 500.
"""

from django.contrib import admin

from apps.operations.submissions.models import (
    DivisionNotifyRecipient,
    SubmissionControlSettings,
)


@admin.register(SubmissionControlSettings)
class SubmissionControlSettingsAdmin(admin.ModelAdmin):
    list_display = ("control_hour", "default_notify_recipient")

    def has_add_permission(self, request):
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DivisionNotifyRecipient)
class DivisionNotifyRecipientAdmin(admin.ModelAdmin):
    list_display = ("division_id", "recipient")
    # NB: division_id is a UUIDField — Postgres has no LIKE/ILIKE operator for
    # uuid, so admin search over it raises ProgrammingError. Search recipient
    # only; filter by division via the list URL if needed (5.7b1 review).
    search_fields = ("recipient",)
