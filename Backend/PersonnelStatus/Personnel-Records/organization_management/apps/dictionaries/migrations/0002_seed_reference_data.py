from django.db import migrations


# Canonical seed data, mirroring the `init_dictionaries` management command.
# Kept in sync with that command intentionally (single set of values, two entry
# points: auto-applied here on migrate, and re-runnable manually via the command).
POSITIONS = [
    ("Director", 1),
    ("Manager", 2),
    ("Developer", 3),
]
STATUS_TYPES = ["In Service", "Vacation", "Sick Leave"]
DISMISSAL_REASONS = ["Resignation", "Termination"]
TRANSFER_REASONS = ["Promotion", "Reorganization"]
VACANCY_REASONS = ["New Position", "Replacement"]
EDUCATION_TYPES = ["Higher Education", "Secondary Education"]
DOCUMENT_TYPES = ["Passport", "Diploma"]
SYSTEM_SETTINGS = [("default_language", "en-us")]

# Simple name-keyed lookups that share the same shape.
NAME_ONLY_MODELS = {
    "StatusType": STATUS_TYPES,
    "DismissalReason": DISMISSAL_REASONS,
    "TransferReason": TRANSFER_REASONS,
    "VacancyReason": VACANCY_REASONS,
    "EducationType": EDUCATION_TYPES,
    "DocumentType": DOCUMENT_TYPES,
}


def seed_reference_data(apps, schema_editor):
    """Idempotently insert the default reference data."""
    Position = apps.get_model("dictionaries", "Position")
    for name, level in POSITIONS:
        Position.objects.get_or_create(name=name, defaults={"level": level})

    for model_name, names in NAME_ONLY_MODELS.items():
        model = apps.get_model("dictionaries", model_name)
        for name in names:
            model.objects.get_or_create(name=name)

    SystemSetting = apps.get_model("dictionaries", "SystemSetting")
    for key, value in SYSTEM_SETTINGS:
        SystemSetting.objects.get_or_create(key=key, defaults={"value": value})


def unseed_reference_data(apps, schema_editor):
    """Remove exactly the rows this migration seeds (reverse operation)."""
    Position = apps.get_model("dictionaries", "Position")
    Position.objects.filter(name__in=[name for name, _ in POSITIONS]).delete()

    for model_name, names in NAME_ONLY_MODELS.items():
        model = apps.get_model("dictionaries", model_name)
        model.objects.filter(name__in=names).delete()

    SystemSetting = apps.get_model("dictionaries", "SystemSetting")
    SystemSetting.objects.filter(key__in=[key for key, _ in SYSTEM_SETTINGS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("dictionaries", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_reference_data, unseed_reference_data),
    ]
