"""Оставить ``report.generate`` только начальнику линейного департамента.

Plane №1125: ранее право также было у профилей второго департамента и у
глобальной категории ОМ. Последняя давала ``acc_dept_head_d2`` область всей
организации и обходила снимок области работы ``dept_other``. Право выпуска
служебного CSV принадлежит только ``HEAD_DEPARTMENT_LINE``.

Откат не восстанавливает удалённые строки: происхождение RolePermission не
хранится, а повторная выдача могла бы создать право, которое администратор
снял вручную после миграции.
"""

from django.db import migrations


def _revoke_unapproved(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        permission_code="report.generate"
    ).exclude(
        role_code="HEAD_DEPARTMENT_LINE"
    ).delete()


def _reverse_noop(apps, schema_editor):
    # См. docstring: безопаснее не создавать потенциально ручные grants.
    return None


class Migration(migrations.Migration):
    dependencies = [("operations", "0118_service_report_scope_snapshot")]

    operations = [migrations.RunPython(_revoke_unapproved, _reverse_noop)]
