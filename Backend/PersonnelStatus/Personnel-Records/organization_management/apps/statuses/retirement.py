"""API retirement policy; historical models, labels and services stay intact."""
from datetime import date

from django import forms
from django.apps import apps
from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework.exceptions import APIException
from rest_framework.permissions import SAFE_METHODS


RETIRED_SECONDMENT_CODES = frozenset({
    "ATTACHED", "DETACHED", "seconded_from", "seconded_to",
})
_NORMALIZED_CODES = frozenset(code.upper() for code in RETIRED_SECONDMENT_CODES)


class FeatureRetired(APIException):
    status_code = 410
    default_detail = "FEATURE_RETIRED"
    default_code = "feature_retired"

    def __init__(self, *, field=None):
        self.field = field
        super().__init__()


def is_retired_secondment_code(code):
    return str(code or "").strip().upper() in _NORMALIZED_CODES


def is_retired_secondment_type(code):
    if is_retired_secondment_code(code):
        return True
    if code:
        status_types = apps.get_model("operations", "StatusType")
        rows = status_types.objects.filter(
            Q(code=code) | Q(legacy_code=code)
        ).values_list("code", "legacy_code")
        return any(is_retired_secondment_code(value) for row in rows for value in row)
    return False


def refuse_retired_secondment_type(code, *, current=None):
    """Reject new retired facts, allowing the unchanged type of history."""
    if current is not None and code == current:
        return code
    if is_retired_secondment_type(code):
        raise FeatureRetired()
    return code


def refuse_retired_secondment_amendment(
    instance, changes, *, type_field="status_type", end_field="end_date",
):
    """History may be annotated or shortened, never reassigned or reopened."""
    if (not is_retired_secondment_type(getattr(instance, type_field))
            or not hasattr(changes, "items")):
        return
    cancelling = (changes.get("cancelled_at") is not None
                  and getattr(instance, "cancelled_at", None) is None)
    for field, value in changes.items():
        if field in {"comment", "document_basis", "amendment_reason"}:
            continue
        before = getattr(instance, field, None)
        if field == end_field:
            if value == before or str(value) == str(before):
                continue
            try:
                end = parse_date(value) if isinstance(value, str) else value
            except ValueError:
                end = None
            limit = getattr(instance, "actual_end_date", None) or before
            if not isinstance(end, date) or (limit is not None and end > limit):
                raise FeatureRetired(field=field)
        elif cancelling and field in {"cancelled_at", "cancelled_by", "cancelled_reason"}:
            continue
        elif str(getattr(value, "pk", value)) != str(getattr(before, "pk", before)):
            raise FeatureRetired(field=field)


class RetiredSecondmentWritesMixin:
    """Run authentication/permissions first, then retire every supported write."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if (request.method not in SAFE_METHODS
                and request.method.lower() in self.http_method_names):
            raise FeatureRetired()


class RetiredSecondmentTypeAdminFormMixin:
    """Apply the same policy to the administration's model forms."""

    retired_status_field = "status_type"

    def clean(self):
        cleaned = super().clean()
        field = self.retired_status_field
        current = getattr(self.instance, field, None) if self.instance.pk else None
        try:
            refuse_retired_secondment_type(cleaned.get(field), current=current)
            if self.instance.pk:
                refuse_retired_secondment_amendment(
                    self.instance, cleaned, type_field=field,
                    end_field="date_end" if field == "status_type_code" else "end_date",
                )
        except FeatureRetired as error:
            self.add_error(error.field or field, forms.ValidationError(
                "Прикомандирование и откомандирование больше недоступны.",
                code="feature_retired",
            ))
        return cleaned
