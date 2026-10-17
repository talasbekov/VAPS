"""Add duty choices without changing existing or customized catalog entries."""
from django.db import migrations


def add_duty_variants(apps, schema_editor):
    status_type = apps.get_model("operations", "StatusType")
    for code, name, priority in [
        ("DUTY_COMBAT", "Боевое дежурство", 71),
        ("DUTY_DAILY", "Суточное дежурство", 72),
        ("DUTY_OPERATIONAL", "Оперативное дежурство", 73),
    ]:
        status_type.objects.using(schema_editor.connection.alias).get_or_create(
            code=code,
            defaults={
                "name": name, "priority": priority, "report_column_code": "ON_DUTY",
                "is_hard_block": False, "counts_in_list": True,
                "counts_in_staff": True, "is_ku_owned": False,
                "restricts_editing": False, "is_placeholder": False,
                "color": "", "max_duration_days": None,
                "is_active": True, "legacy_code": None,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("operations", "0133_recon_materials")]
    # Entries may already have employee statuses by the time a release is
    # rolled back; removing the dictionary rows would orphan those facts.
    operations = [migrations.RunPython(add_duty_variants, migrations.RunPython.noop)]
