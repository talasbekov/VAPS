"""`gvo.manage` возвращается в профиль штаба `HEAD_OPS_UNIT` (Plane №947,
задача заказчика 07.09.2026).

Заказчик назвал третьим, кто правит сводные данные, «начальника управления
второго департамента» (`acc_dir_head_d2`). Эта персона носит `HEAD_OPS_UNIT`
с областью на управление, и с №601 (06.09.2026) права-обходы, включая
`gvo.manage`, уехали из профиля в добавку `OPS_STAFF_COMMAND`, которую
получает только начальник ДЕПАРТАМЕНТА. Для расстановки и переходов это
решение остаётся; для сводки ГВО заказчик его уточнил — и раздел 5
документации (`[ГВО-09]`: «штаб — правит, утверждает, меняет старшего ГВО»)
называет штабом обе персоны.

Миграцией, а не правкой сида: сид права только добавляет, и на уже засеянной
базе он бы это сделал сам — но ровно поэтому обратный ход обязан снять право,
а сид этого не умеет. `OPS_STAFF_COMMAND` право сохраняет: у начальника
департамента оно и так есть двумя грантами.
"""
from django.db import migrations

PERMISSION = "gvo.manage"
STAFF = "HEAD_OPS_UNIT"


def _grant(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        # База, не видевшая сида, прав не знает — раскладку заведёт сид.
        return
    if Role.objects.filter(code=STAFF).exists():
        RolePermission.objects.get_or_create(
            role_code_id=STAFF, permission_code_id=PERMISSION
        )


def _revoke(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    RolePermission.objects.filter(
        role_code_id=STAFF, permission_code_id=PERMISSION
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0104_security_event_owner_actor_id")]

    operations = [migrations.RunPython(_grant, _revoke)]
