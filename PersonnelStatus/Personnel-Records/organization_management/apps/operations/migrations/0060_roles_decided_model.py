"""Решённая модель прав: каталоги, утверждение, чистка (Plane №267).

Четыре решения заказчика 28.08.2026, каждое — своим блоком ниже.

1. УТВЕРЖДАЮЩИЙ ТОЛЬКО ВИДИТ РАССТАНОВКУ. Подпись и возврат разведены с
   ведением мероприятия: решение согласующего ушло под `assignment.approve` и
   `assignment.return`, которые до этого были в справочнике и не охраняли
   ничего. Раздавать их тут некому — их держит роль APPROVER, и она их уже
   держала; менять её раскладку не требуется.

2. РЯДОВОЙ СОТРУДНИК видит охраняемых лиц и нормативную базу, но НЕ реестр
   мероприятий. Заводится `catalog.view`. БЭКФИЛЛ ОБЯЗАТЕЛЕН: право получают
   все роли, у которых есть `event.view`, — иначе задача про доступ рядового
   сотрудника отняла бы два экрана у всех, кто их сегодня открывает.

3. ПЕРСОНАЛЬНАЯ ДЕТАЛИЗАЦИЯ И ВЫГРУЗКА СО СКРЫТЫМИ ПОЛЯМИ — только
   администратор. Ни одной роли они и не выданы; миграция снимает их, если
   кто-то выдал их руками на живом стенде.

4. ПРАВА БЕЗ ЕДИНОЙ РУЧКИ — УБРАТЬ. Семь кодов: пять `assignment.*` (порт
   старой системы, здесь расстановку охраняет `placement.manage`),
   `brokerage.manage`, `document.upload`, `orgstructure.manage`,
   `personnel.edit`. Выданное право, которое ничего не открывает, опаснее
   отсутствующего: человек считает, что доступ у него есть, и узнаёт обратное
   в неподходящий момент.

   `assignment.approve` и `assignment.return` в этот список НЕ входят: решением
   №1 они стали рабочими.

ОТКАТ восстанавливает снятые коды, но НЕ их выдачи ролям: кому они были
выданы, знала только снятая строка, и восстанавливать это гаданием нельзя.
"""
from django.db import migrations

CATALOG = ("catalog.view", "Просмотр каталогов раздела ОМ")
CATALOG_SOURCE = "event.view"

ADMIN_ONLY = ["analytics.personal_detail", "report.export_sensitive"]

DEAD = [
    "assignment.create",
    "assignment.delete",
    "assignment.submit",
    "brokerage.manage",
    "document.upload",
    "orgstructure.manage",
    "personnel.edit",
]

RESTORE = {
    "assignment.create": "Создание назначения",
    "assignment.delete": "Удаление назначения",
    "assignment.submit": "Отправка расстановки",
    "brokerage.manage": "Брокеридж",
    "document.upload": "Загрузка вложений",
    "orgstructure.manage": "Управление оргструктурой",
    "personnel.edit": "Редактирование кадровых записей",
}


def forwards(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")

    code, name = CATALOG
    Permission.objects.update_or_create(code=code, defaults={"name": name})
    for role_code in RolePermission.objects.filter(
        permission_code_id=CATALOG_SOURCE
    ).values_list("role_code_id", flat=True):
        RolePermission.objects.get_or_create(
            role_code_id=role_code, permission_code_id=code
        )

    RolePermission.objects.filter(permission_code_id__in=ADMIN_ONLY).delete()

    RolePermission.objects.filter(permission_code_id__in=DEAD).delete()
    Permission.objects.filter(code__in=DEAD).delete()


def backwards(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    RolePermission = apps.get_model("operations", "RolePermission")
    for code, name in RESTORE.items():
        Permission.objects.get_or_create(code=code, defaults={"name": name})
    RolePermission.objects.filter(permission_code_id=CATALOG[0]).delete()
    Permission.objects.filter(code=CATALOG[0]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0059_combat_shift_group_name"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
