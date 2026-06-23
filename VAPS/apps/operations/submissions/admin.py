"""Admin-регистрация настроек контроля сдачи (Story 2.11).

SubmissionControlSettings — singleton-настройки (Story 2.3 «правка через
Admin»), НЕ DailySubmission (бизнес, E5; ARCH#L467/L485). Singleton:
запрет add (если строка есть) и delete — DB защищает CheckConstraint
singleton_key=1, гейты делают UX чистым.
"""
from django.contrib import admin

from apps.operations.submissions.models import SubmissionControlSettings


@admin.register(SubmissionControlSettings)
class SubmissionControlSettingsAdmin(admin.ModelAdmin):
    list_display = ("control_hour",)

    def has_add_permission(self, request):
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False
