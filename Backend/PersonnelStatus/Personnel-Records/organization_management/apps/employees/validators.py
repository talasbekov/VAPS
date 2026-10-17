import re
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

def iin_kz_validator(value):
    """Check the input format; imported identities keep their existing values.

    Checksum and birth-date validation are separate from this format rule.
    Missing values are permitted by the nullable, blank model field.
    """
    if not value or not isinstance(value, str):
        raise ValidationError(_('IIN must be a string.'))
    if re.fullmatch(r'[0-9]{12}', value) is None:
        raise ValidationError(_('ИИН должен содержать ровно 12 цифр.'), code='invalid_iin')
