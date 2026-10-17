"""Reference-aware editor for the shared dictionaries (#1286)."""
from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.urls import reverse

from organization_management.admin_auto import NullableDefaultsAdminForm
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import dictionaries


class DictionaryEntryForm(NullableDefaultsAdminForm):
    dictionary_code = forms.ChoiceField(
        label="Справочник",
        choices=[(item["code"], item["label"]) for item in dictionaries.DEFINITIONS],
    )

    class Meta:
        model = OpsDictionaryEntry
        fields = "__all__"

    def clean(self):
        data = super().clean()
        dictionary_code = data.get("dictionary_code", self.instance.dictionary_code)
        code = str(data.get("code", self.instance.code) or "").strip().upper()
        if "code" in data:
            data["code"] = code
        errors = {}
        owner = data.get("owner_division")
        if (
            self.instance.pk
            and not data.get("is_active")
            and (data.get("group_code") or None) == (self.instance.group_code or None)
            and (owner.pk if owner else None) == self.instance.owner_division_id
        ):
            # Deactivation preserves historical references; it must remain
            # possible after a parent/owner was deactivated (portal parity).
            return data
        dictionaries._validated_owner(
            dictionary_code, code, owner.pk if owner else None, errors
        )
        if "ownerDivisionId" in errors:
            self.add_error("owner_division", errors["ownerDivisionId"])
        if dictionary_code != "EVENT_PARTICIPATION_KINDS":
            data["owner_division"] = None
        parent = dictionaries.GROUP_PARENT.get(dictionary_code)
        group_code = data.get("group_code")
        if parent and group_code and not OpsDictionaryEntry.objects.filter(
            dictionary_code=parent, code=group_code, is_active=True
        ).exists():
            self.add_error("group_code", "Группа не найдена или неактивна.")
        if parent is None:
            data["group_code"] = None
        return data


@admin.register(OpsDictionaryEntry)
class DictionaryEntryAdmin(admin.ModelAdmin):
    form = DictionaryEntryForm
    list_display = ("dictionary_code", "code", "label", "label_kk", "group_code", "is_active")
    list_filter = ("dictionary_code", "is_active")
    search_fields = ("code", "label", "label_kk", "description", "group_code")
    raw_id_fields = ("owner_division",)
    list_select_related = ("owner_division",)

    def get_readonly_fields(self, request, obj=None):
        # These are string reference keys in journals and placement documents.
        return ("dictionary_code", "code") if obj else ()

    def get_actions(self, request):
        actions = super().get_actions(request)
        # Django's bulk deletion bypasses delete_model and the domain service.
        actions.pop("delete_selected", None)
        return actions

    def has_delete_permission(self, request, obj=None):
        if not super().has_delete_permission(request, obj):
            return False
        if obj is None:
            return True
        usage = dictionaries.usage_of(obj)
        return usage["status"] == "TRACKED" and usage["totalCount"] == 0

    def delete_model(self, request, obj):
        # Recheck under the service's lock immediately before deletion.
        dictionaries.delete_entry(obj.pk, actor=request.user.get_username())

    def delete_view(self, request, object_id, extra_context=None):
        try:
            return super().delete_view(request, object_id, extra_context)
        except DomainError as error:
            self.message_user(request, error.message, level=messages.ERROR)
            return HttpResponseRedirect(
                reverse("admin:operations_opsdictionaryentry_change", args=[object_id])
            )
