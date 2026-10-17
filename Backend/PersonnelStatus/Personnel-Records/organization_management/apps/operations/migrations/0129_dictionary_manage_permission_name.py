"""Правит название `dictionary.manage` в каталоге прав (UC-REF-001).

Сид идемпотентен и сам исправил бы имя при следующем `bootstrap_contour`, но
на обновлении контура выполняется только `migrate` — `bootstrap_contour`
ручной шаг. Поэтому имя каталога правит миграция.
"""
from django.db import migrations

CODE = "dictionary.manage"
NEW_NAME = "Управление справочниками ОМ без значений (охраняемые лица)"
OLD_NAME = "Управление справочниками раздела ОМ"


def _rename_forward(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Permission.objects.filter(code=CODE).update(name=NEW_NAME)


def _rename_backward(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Permission.objects.filter(code=CODE).update(name=OLD_NAME)


class Migration(migrations.Migration):
    dependencies = [("operations", "0128_dictionary_entry_label_kk")]

    operations = [migrations.RunPython(_rename_forward, _rename_backward)]
