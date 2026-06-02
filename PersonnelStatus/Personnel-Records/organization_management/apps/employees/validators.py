import re
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

def iin_kz_validator(value):
    """
    Validates Kazakhstan IIN (Individual Identification Number).
    It must be a 12-digit number.
    """
    if not value or not isinstance(value, str):
        raise ValidationError(_('IIN must be a string.'))
    if not re.match(r'^\d{12}$', value):
        raise ValidationError(_('IIN must contain exactly 12 digits.'))
