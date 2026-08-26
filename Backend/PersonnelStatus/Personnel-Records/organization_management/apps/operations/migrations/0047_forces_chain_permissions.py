"""Права цепочки «Сбор сил на ОМ» и бэкфилл их на ведущие роли (Plane №74).

Заказчик просил разделить звенья цепочки по ролям: деление потребности и
приёмка списков — штаб; оповещение управлений и отправка списка —
ответственный за выделение В СВОЁМ департаменте; выделение людей (оно же
проставление статуса «Участие на мероприятии») — начальник управления по
СВОЕМУ управлению; расстановка по постам — старший объекта.

Права заводятся ЗДЕСЬ, а не только в `seed_operations`: сид гоняют на чистом
стенде, а справочник прав живёт и на заполненных базах, где команду никто
больше не запустит.

БЭКФИЛЛ ОБЯЗАТЕЛЕН. Сегодня всю цепочку открывает одно право
`event.manage`. Завести новые права и НЕ раздать их значило бы запереть
цепочку у каждого, кто ведёт её прямо сейчас: задача из разграничения
ответственности превратилась бы в аварию. Поэтому каждая роль, у которой есть
`event.manage`, получает все четыре — ровно тот доступ, что у неё был. Сузить
раскладку до «штаб — одно, департамент — другое» заказчик может на экране
ролей, и именно это и есть смысл задачи.

Роль ADMIN не трогается: у неё «*», и перечислять под ним отдельные коды
незачем.

Откат снимает выданные права и сами коды — состояние до миграции
восстанавливается полностью, потому что ничего, кроме этих строк, она не
создаёт.
"""
from django.db import migrations

NEW_PERMISSIONS = [
    ("forces.command", "Сбор сил: деление потребности и приёмка списков"),
    ("forces.allocate", "Сбор сил: оповещение управлений и отправка списка"),
    ("forces.select", "Сбор сил: выделение людей на мероприятие"),
    ("placement.manage", "Расстановка людей по постам мероприятия"),
]

SOURCE_PERMISSION = "event.manage"


def forwards(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    for code, name in NEW_PERMISSIONS:
        Permission.objects.update_or_create(code=code, defaults={"name": name})
    holders = list(
        RolePermission.objects.filter(
            permission_code_id=SOURCE_PERMISSION
        ).values_list("role_code_id", flat=True)
    )
    for role_code in holders:
        for code, _ in NEW_PERMISSIONS:
            RolePermission.objects.get_or_create(
                role_code_id=role_code, permission_code_id=code
            )


def backwards(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    codes = [code for code, _ in NEW_PERMISSIONS]
    RolePermission.objects.filter(permission_code_id__in=codes).delete()
    Permission.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0046_autopass_demand_and_forces"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
