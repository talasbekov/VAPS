import pytest
from django.core.management import call_command

from apps.core.models import SensitiveFieldPolicy
from apps.core.services import mask_employee_data

pytestmark = pytest.mark.django_db


def test_seed_creates_iin_policy():
    call_command("seed_core")
    assert SensitiveFieldPolicy.objects.filter(field_code="iin").exists()


def test_iin_masked_without_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin",
        permission_code="employee.sensitive.view",
        mask_strategy="PARTIAL_MASK",
    )
    data = {"full_name": "Иванов", "iin": "900101300123"}
    masked = mask_employee_data(data, user_permissions=set())
    assert masked["full_name"] == "Иванов"
    assert masked["iin"] != "900101300123"
    assert masked["iin"].endswith("0123")  # partial mask keeps last 4


def test_iin_visible_with_permission():
    SensitiveFieldPolicy.objects.create(
        field_code="iin",
        permission_code="employee.sensitive.view",
        mask_strategy="PARTIAL_MASK",
    )
    data = {"iin": "900101300123"}
    masked = mask_employee_data(data, user_permissions={"employee.sensitive.view"})
    assert masked["iin"] == "900101300123"


def test_wildcard_reveals_all():
    # ADMIN's "*" bypasses masking without holding the granular code (review C1).
    SensitiveFieldPolicy.objects.create(
        field_code="iin",
        permission_code="employee.sensitive.view",
        mask_strategy="PARTIAL_MASK",
    )
    masked = mask_employee_data({"iin": "900101300123"}, user_permissions={"*"})
    assert masked["iin"] == "900101300123"


def test_full_hide_strategy():
    SensitiveFieldPolicy.objects.create(
        field_code="notes",
        permission_code="employee.sensitive.view",
        mask_strategy="FULL_HIDE",
    )
    masked = mask_employee_data({"notes": "secret"}, user_permissions=set())
    assert masked["notes"] is None
