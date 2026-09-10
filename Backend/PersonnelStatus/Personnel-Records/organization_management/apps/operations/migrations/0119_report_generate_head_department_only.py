"""Убрать ``report.generate`` из глобальной роли ``OM_CATEGORY_ORG``.

№1125 добавляет grant начальнику линейного департамента в migration 0117.
У ``OM_CATEGORY_ORG`` область всегда ``NULL`` («вся организация»): её
``report.generate`` обходил scope связанной scoped-роли. Остальные профили,
включая scoped ``HEAD_OPS_UNIT``, migration не затрагивает. Обратный ход
безопасно ничего не создаёт: provenance ручной выдачи не хранится.
"""

from django.db import migrations


def _revoke_global_om_category(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id="OM_CATEGORY_ORG", permission_code_id="report.generate"
    ).delete()


def _reverse_noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):
    dependencies = [("operations", "0118_service_report_scope_snapshot")]

    operations = [migrations.RunPython(_revoke_global_om_category, _reverse_noop)]
