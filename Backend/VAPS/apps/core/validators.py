from django.core.validators import RegexValidator

iin_validator = RegexValidator(
    regex=r"^[0-9]{12}$", message="ИИН должен состоять из 12 цифр."
)
