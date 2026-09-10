"""Открыть «Отчёты по Службе» начальнику линейного департамента (Plane №1125).

Учётка ``acc_dept_head`` уже получает ``HEAD_DEPARTMENT_LINE`` с областью
своего департамента через ``seed_access_matrix``. Пункт меню и экран отчётов
проверяют ``report.generate``; его не было в профиле, поэтому браузерный путь
заканчивался скрытым пунктом и 403. Добавляется только право профиля: область
гранта не меняется и остаётся ``dept_other``.

Это migration, а не только изменение сида: существующая база не применит
обновлённый список ``ROLE_PERMISSIONS`` самостоятельно. Если в базе ещё нет
справочника роли или права, безопасно ничего не делаем — их создаст сид.
"""
from django.db import migrations


PERMISSION = "report.generate"
ROLE = "HEAD_DEPARTMENT_LINE"


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        return
    if Role.objects.filter(code=ROLE).exists():
        RolePermission.objects.get_or_create(
            role_code_id=ROLE, permission_code_id=PERMISSION
        )


def _revoke(apps, schema_editor):
    # У строки RolePermission нет provenance: grant мог существовать до
    # migration и ``get_or_create`` в forward не помечает, кто его создал.
    # Удаление здесь разрушило бы ручное назначение при rollback, поэтому
    # безопасное обратное действие — no-op. Повторный seed всё равно задаёт
    # состав профиля из канона.
    return


class Migration(migrations.Migration):
    dependencies = [("operations", "0116_force_campaign_reserve")]

    operations = [migrations.RunPython(_grant, _revoke)]
