"""Сохранить существующие выдачи ``report.generate`` (Plane №1125).

№1125 добавляет grant начальнику линейного департамента в migration 0117.
Ранее выданные профили не относятся к этой правке: у RolePermission нет
provenance, поэтому migration не вправе удалять или восстанавливать их.
"""

from django.db import migrations


def _preserve_existing(apps, schema_editor):
    """Явный no-op для уже выпущенной migration без потери ручных grants."""
    return None


def _reverse_noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):
    dependencies = [("operations", "0118_service_report_scope_snapshot")]

    operations = [migrations.RunPython(_preserve_existing, _reverse_noop)]
