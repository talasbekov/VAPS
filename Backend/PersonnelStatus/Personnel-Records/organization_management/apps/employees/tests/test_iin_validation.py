"""IIN format checks apply to field validation and keep missing imports valid."""
import pytest
from django.core.exceptions import ValidationError

from organization_management.apps.employees.models import Employee


@pytest.mark.parametrize("value", ["abc", "1", "12345678901", "1234567890123",
                                  "12345678901a", "123456789012\n",
                                  "١٢٣٤٥٦٧٨٩٠١٢", "１２３４５６７８９０１２"])
def test_iin_rejects_invalid_format(value):
    with pytest.raises(ValidationError):
        Employee._meta.get_field("iin").clean(value, Employee())


@pytest.mark.parametrize("value", [None, "", "000000000001", "123456789012"])
def test_iin_keeps_missing_values_and_twelve_ascii_digits(value):
    assert Employee._meta.get_field("iin").clean(value, Employee()) == value
