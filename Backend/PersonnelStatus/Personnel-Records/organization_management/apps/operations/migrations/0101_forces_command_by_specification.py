"""Право «Сбор сил» (`forces.command`) — по спецификации (Plane №944, задача
заказчика 07.09.2026 «Сборы сил на ОМ … несоответствует документации»).

Раздел 7.1 `RAW/README.md` называет штабом сбора сил ОБЕ персоны второго
департамента (`acc_dir_head_d2`, `acc_dept_head_d2`, роль `HEAD_OPS_UNIT`):
список заявок, деление потребности, довыделение, распределение по объектам.
`[СБС-20]` отдаёт ответственному за сбор сил (`FORCES_GATHERING_OFFICER`)
только входящие запросы СВОЕГО департамента — «чужие не видны».

На стенде было наоборот: у штаба права не было (открытый вопрос №421 —
матрица №348 против `[СБС-10]`), а у ответственного было — и он видел
штабной список по всем мероприятиям. Ответом на вопрос стала карточка №944:
заказчик проверил цепочку под своими учётками и назвал документацию
источником правды.

ПОЧЕМУ МИГРАЦИЕЙ, А НЕ ОДНОЙ ПРАВКОЙ СИДА (как 0067 и 0097): сид умеет только
ДОБАВЛЯТЬ права роли и намеренно не снимает лишних. Значит на всякой уже
засеянной базе право у ответственного осталось бы жить, а сид починил бы
только новые базы. Обратный ход возвращает прежнюю раскладку.
"""
from django.db import migrations

PERMISSION = "forces.command"
STAFF = "HEAD_OPS_UNIT"
OFFICER = "FORCES_GATHERING_OFFICER"


def _by_specification(apps, schema_editor):
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
    RolePermission.objects.filter(
        role_code_id=OFFICER, permission_code_id=PERMISSION
    ).delete()


def _back(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    if not Permission.objects.filter(code=PERMISSION).exists():
        return
    RolePermission.objects.filter(
        role_code_id=STAFF, permission_code_id=PERMISSION
    ).delete()
    if Role.objects.filter(code=OFFICER).exists():
        RolePermission.objects.get_or_create(
            role_code_id=OFFICER, permission_code_id=PERMISSION
        )


class Migration(migrations.Migration):
    dependencies = [("operations", "0100_notification_kind_forces_request_department")]

    operations = [migrations.RunPython(_by_specification, _back)]
