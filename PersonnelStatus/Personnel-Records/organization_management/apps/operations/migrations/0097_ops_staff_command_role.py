"""Штабные права-обходы уезжают из профиля в роль-добавку `OPS_STAFF_COMMAND`.

Plane №601, решение заказчика 06.09.2026 (вариант «отдельная роль-добавка
штабу»).

ЧТО БЫЛО НЕ ТАК. Права `placement.command` («расстановка на любом объекте»),
`gvo.manage` («правка сводки визита») и `event.stage_override` («перевод ОМ на
любой этап») область гранта НЕ спрашивают: они снимают проверку «своё ли это
мероприятие» по бесконтекстному набору прав. Профиль `HEAD_OPS_UNIT`, в
котором они лежали, носят ОБЕ персоны второго департамента — и начальник
департамента, и начальник его управления (набор прав у них намеренно один,
различает их только область гранта). Итог: начальник УПРАВЛЕНИЯ командовал
расстановкой по всей организации, хотя `[РАС-08]` отдаёт «всё» штабу.

ПОЧЕМУ МИГРАЦИЕЙ, А НЕ ОДНОЙ ПРАВКОЙ СИДА (та же причина, что у 0067):
`seed_operations` умеет только ДОБАВЛЯТЬ права роли и намеренно не снимает
лишних — иначе затирал бы то, что администратор собрал руками на экране
«Роли». Значит на всякой уже засеянной базе (стенд, боевая) три права остались
бы жить в профиле, а правка сида чинила бы только новые базы.

🔴 ГРАНТЫ ПОЛЬЗОВАТЕЛЯМ МИГРАЦИЯ НЕ РАЗДАЁТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ. Раздать
новую роль всем, кто носит `HEAD_OPS_UNIT`, значило бы воспроизвести ровно тот
дефект, ради которого она заведена: право снова досталось бы начальнику
управления. Кому она положена — решает матрица персон (`seed_access_matrix`,
персона `dept_head_d2`) на стенде и администратор экраном «Роли» в бою. После
наката миграции держателей у трёх прав НЕТ ВОВСЕ, пока роль не выдана явно, —
это и есть видимое следствие решения заказчика.

Обратный ход возвращает права в профиль и снимает роль целиком (вместе с
выданными грантами): откатанная база обязана вести себя как база, миграцию не
видевшая.
"""
from django.db import migrations

PROFILE = "HEAD_OPS_UNIT"
ROLE = "OPS_STAFF_COMMAND"
ROLE_NAME = "Штаб ОМ: команда по всей организации"
PERMISSIONS = ("placement.command", "gvo.manage", "event.stage_override")


def _move_out(apps, schema_editor):
    Role = apps.get_model("operations", "Role")
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")

    RolePermission.objects.filter(
        role_code_id=PROFILE, permission_code_id__in=PERMISSIONS
    ).delete()

    # База, не видевшая сида, прав не знает — заводить роль поверх пустоты
    # незачем: сид заведёт и её, и права разом.
    known = set(
        Permission.objects.filter(code__in=PERMISSIONS).values_list("code", flat=True)
    )
    if not known:
        return
    Role.objects.update_or_create(
        code=ROLE, defaults={"name": ROLE_NAME, "is_active": True}
    )
    for code in sorted(known):
        RolePermission.objects.get_or_create(
            role_code_id=ROLE, permission_code_id=code
        )


def _move_back(apps, schema_editor):
    Role = apps.get_model("operations", "Role")
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    UserRole = apps.get_model("operations", "UserRole")

    for code in PERMISSIONS:
        if not Permission.objects.filter(code=code).exists():
            continue
        if not Role.objects.filter(code=PROFILE).exists():
            continue
        RolePermission.objects.get_or_create(
            role_code_id=PROFILE, permission_code_id=code
        )

    # Роль снимается целиком: сначала выданные гранты (FK стоит на PROTECT),
    # потом её права, потом она сама.
    UserRole.objects.filter(role_code_id=ROLE).delete()
    RolePermission.objects.filter(role_code_id=ROLE).delete()
    Role.objects.filter(code=ROLE).delete()


class Migration(migrations.Migration):
    dependencies = [("operations", "0096_notification_kind_assignment_declined")]

    operations = [migrations.RunPython(_move_out, _move_back)]
