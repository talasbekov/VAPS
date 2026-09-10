"""Admin раздела ОМ — ТОЛЬКО справочники (порт submissions/admin.py из
Backend/VAPS).

Что здесь появляется, решает не удобство, а природа записи. Справочник —
данные, которые администратор заводит и правит руками: контрольный час,
список «необходимых управлений». Бизнес-запись — то, что раздел ПИШЕТ САМ по
своим правилам: сдача дня, строка статуса, пара прикомандирования, обход
блокировки, строка журнала. Открыв их в Admin, раздел получил бы второй,
безусловный вход в мутации: правку сдачи без новой версии, статус без
проверки пересечений, обход без причины и без записи в журнал — то есть
ровно те инварианты, ради которых у каждого из них есть сервис.

Обход блокировки (ops_tomorrow_block_overrides) поэтому здесь и не появится,
хотя выглядит «настройкой»: это принятое решение с ответственным, а не
конфигурация, и заводить его мимо сервиса значило бы подписывать чужим
именем без причины.

Справочник контроля сдачи — СИНГЛТОН: добавление закрыто при существующей
строке, удаление закрыто всегда. База и так держит единственность
(unique + CHECK singleton_key=1), но она отвечает 500-й, а гейты Admin — тем
же «нельзя», только заранее и по-человечески.

Закрепление получателей уведомлений, наоборот, открыто целиком: это чистая
настройка «кто отвечает за сдачу этого управления» — её заводят, переносят и
снимают по мере смены дежурства, и сервиса у неё нет. Правит её админ, а не
выкатка, ровно по той же причине, по которой сюда попал контрольный час.
"""
from django.contrib import admin
from organization_management.admin_auto import NullableDefaultsAdminForm

from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
)
from organization_management.apps.operations.models_geo import OpsCity, OpsCountry
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventPerson,
)
from organization_management.apps.operations.models_feedback import OpsFeedbackRequest
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.models_vehicle import OpsEventVehicle
from organization_management.apps.ops.security_events import new_recon_checklist


@admin.register(OpsSubmissionControlSettings)
class OpsSubmissionControlSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "control_hour",
        "required_division_ids",
        "default_notify_recipient",
    )

    def has_add_permission(self, request):
        # Строку сеет миграция; вторая невозможна на уровне БД.
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        # Удалять нечего и незачем: без строки читатели остались бы без
        # контрольного часа, а самолечение селектора вернуло бы дефолт —
        # то есть удаление означало бы «сбросить настройки», притворяясь
        # удалением.
        return False


@admin.register(OpsDivisionNotifyRecipient)
class OpsDivisionNotifyRecipientAdmin(admin.ModelAdmin):
    list_display = ("division_id", "recipient")
    # Поиск ТОЛЬКО по получателю — по смыслу, а НЕ потому, что иначе будет
    # ошибка. Прежняя редакция этого комментария утверждала, что icontains по
    # целочисленной колонке отвечает ProgrammingError («LIKE по числу Postgres
    # не умеет»); проверено запросом 27.08.2026 (Plane №185) — на текущем
    # стеке это неправда, Django 5.1.15 кастует сам:
    #     UPPER("ops_division_notify_recipients"."division_id"::text)
    #         LIKE UPPER(%1%)
    # запрос выполняется и ошибки не даёт. Настоящая причина в другом: поиск
    # OR-ит LIKE по каждой колонке списка, и «1» по division_id совпало бы с
    # 1, 10, 21, 101 разом — то есть отвечал бы не на тот вопрос, который
    # задали. Нужно выбрать подразделение — это фильтр в адресе списка.
    search_fields = ("recipient",)

# ── Справочники Ш-1 (Plane №417): страна → город, охраняемое лицо ──────────


@admin.register(OpsCountry)
class OpsCountryAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)


@admin.register(OpsCity)
class OpsCityAdmin(admin.ModelAdmin):
    list_display = ("name", "country", "is_active")
    search_fields = ("name", "country__name")
    list_filter = ("country", "is_active")
    autocomplete_fields = ("country",)


@admin.register(OpsProtectedPerson)
class OpsProtectedPersonAdmin(admin.ModelAdmin):
    # Код только читается: его выдаёт модель, и ручная правка сломала бы
    # ссылки в бюллетенях и сводках, где он напечатан.
    list_display = ("code", "name", "callsign", "category", "is_active")
    search_fields = ("code", "name", "callsign")
    list_filter = ("category", "is_active")
    readonly_fields = ("code",)


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = (
        "user_id", "role_code", "scope_division_id", "is_active", "created_at",
    )
    search_fields = ("user_id", "role_code__code", "role_code__name")
    list_filter = ("is_active", "role_code")
    autocomplete_fields = ("role_code",)


class OpsFeedbackRequestAdminForm(NullableDefaultsAdminForm):
    """Admin следует семантике API: nullable/default поля черновика необязательны."""

    class Meta:
        model = OpsFeedbackRequest
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in (
            "expected_result", "reproduction_steps", "attachments", "contact",
            "related_route", "technical_info", "working_priority_code",
            "assignee_user_id", "assignee_label", "duplicate_of", "submitted_at",
        ):
            self.fields[name].required = False

    def clean_attachments(self):
        # Пустой ввод в ModelForm превращается в None; колонка NOT NULL и API
        # трактуют отсутствие вложений как пустой список.
        return self.cleaned_data.get("attachments") or []


@admin.register(OpsFeedbackRequest)
class OpsFeedbackRequestAdmin(admin.ModelAdmin):
    form = OpsFeedbackRequestAdminForm
    list_display = (
        "subject", "type_code", "module_code", "priority_code", "status_code",
        "author_label", "created_at",
    )
    search_fields = ("subject", "description", "author_label", "author_user_id")
    list_filter = ("type_code", "module_code", "priority_code", "status_code")
    raw_id_fields = ("duplicate_of",)


class OpsSecurityEventPersonInline(admin.TabularInline):
    model = OpsSecurityEventPerson
    extra = 0
    autocomplete_fields = ("person",)


class OpsEventVehicleInline(admin.TabularInline):
    model = OpsEventVehicle
    extra = 0
    autocomplete_fields = ("vehicle",)


class OpsStatusParticipationInline(admin.TabularInline):
    model = OpsStatusParticipation
    extra = 0
    fields = ("event_id", "kind_code", "role_code")


@admin.register(OpsEmployeeStatus)
class OpsEmployeeStatusAdmin(admin.ModelAdmin):
    list_display = (
        "employee_id", "status_type_code", "date_start", "date_end", "source",
    )
    search_fields = ("status_type_code", "comment", "document_basis", "source_ref")
    list_filter = ("source", "date_start", "date_end", "cancelled_at")
    inlines = (OpsStatusParticipationInline,)


class OpsSecurityEventAdminForm(NullableDefaultsAdminForm):
    """Начальные коллекции ОМ совпадают с `create_event` сервиса."""

    class Meta:
        model = OpsSecurityEvent
        fields = "__all__"

    COLLECTION_DEFAULTS = {
        "recon_checklist": new_recon_checklist,
        "recon_sector_posts": list,
        "demand_rows": list,
        "force_requests": list,
        "placement_assignments": list,
        "journal_entries": list,
        "closure_direction_summaries": list,
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, factory in self.COLLECTION_DEFAULTS.items():
            self.fields[name].required = False
            if not self.is_bound and not self.instance.pk:
                self.fields[name].initial = factory()

    def clean(self):
        cleaned = super().clean()
        for name, factory in self.COLLECTION_DEFAULTS.items():
            if cleaned.get(name) is None:
                cleaned[name] = factory()
        return cleaned


@admin.register(OpsSecurityEvent)
class OpsSecurityEventAdmin(admin.ModelAdmin):
    form = OpsSecurityEventAdminForm
    list_display = (
        "code", "title", "business_date", "kind", "stage",
        "readiness_percent", "object_name", "owner_name",
    )
    search_fields = ("code", "title", "object_name", "owner_name")
    list_filter = ("kind", "stage", "approval_status", "business_date")
    raw_id_fields = ("security_object", "protected_person", "country", "city")
    inlines = (OpsSecurityEventPersonInline, OpsEventVehicleInline)


from organization_management.admin_auto import register_allowed  # noqa: E402

register_allowed(
    "operations",
    (
        # Доступ.
        "Role", "Permission", "UserRole", "RolePermission", "TemporaryDutyPermission",
        # Сотрудники и статусы.
        "OpsEmployeeStatus", "Secondment", "StatusOverride", "OpsProtectedPerson",
        # Справочники и настройки, которые администратор действительно ведёт.
        "OpsDictionaryEntry", "StatusType", "OpsDutyType", "OpsCombatDutyType",
        "OpsCombatRoute", "OpsServiceReportType", "OpsFeedbackRegistry",
        "OpsAnalyticsMetricDefinition", "OpsAnalyticsPeriodPreset",
        "OpsAttentionDetector", "OpsLegalDocument", "OpsVehicle", "OpsCountry",
        "OpsCity", "OpsRatingGroup", "OpsPolicySetting",
        "OpsSubmissionControlSettings", "OpsPassportFreshnessPolicy",
        "OpsDutyConflictPolicy", "OpsRatingFeatureFlags", "OpsDocumentSequence",
        "OpsDivisionNotifyRecipient", "OpsApprovalRouteStep", "OpsSettingChangeEvent",
        # Охранные мероприятия, объекты, посты, расстановка и оценки.
        "OpsSecurityEvent", "OpsSecurityEventTransition", "OpsSecurityObject",
        "OpsObjectSector", "OpsSecurityPost", "OpsSecurityEventVisitObject",
        "OpsVisitObjectDeputy", "OpsRatedParticipant", "OpsEvaluationEvent",
        "OpsEventEvaluation", "OpsEvaluationWorkItem", "OpsEvaluationCorrection",
        "OpsDutyShift", "OpsDutyMonthlyPlan", "OpsCombatDutyShift", "OpsForeignVisit",
        "OpsGvoSummaryPatch",
        "OpsTomorrowBlockOverride",
        # Сбор сил и расход.
        "OpsDailySubmission", "OpsForceRequest", "OpsDepartmentRequest",
        "OpsUnitRequest", "OpsForceRequestMember", "OpsForceCampaign",
        "OpsForceCampaignEvent", "OpsForceCampaignAssignment",
        "OpsForceCampaignPoolMember", "OpsForceCampaignHandover",
        # Обратная связь.
        "OpsFeedbackRequest", "OpsFeedbackComment", "OpsFeedbackEvent",
        # Документы, отчёты и служебные журналы.
        "OpsIssuedDocument", "OpsAttachment", "OpsBulletinIssue",
        "OpsServiceReportJob", "OpsServiceReportArtifact", "OpsRatingExportJob",
        "OpsRatingExportArtifact", "OpsAuditLog", "OpsRatingAuditEntry",
        "OpsNotification", "OpsRatingNotification",
    ),
)
