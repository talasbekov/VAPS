"""Права ролей под сценарий суточного расхода (Plane №243).

СЦЕНАРИЙ ЗАКАЗЧИКА, дословно: «начальники управления ежедневно составляют за
день вперёд расход по личному составу своего управления (здесь начальники
управления каждому сотруднику проставляют статусы)».

ЧТО БЫЛО. У роли «Оператор подразделения» (DIVISION_OPERATOR) есть
`daily_report.mark_update` — сдача дня — и `status.view` — чтение статусов, но
права `status.manage` нет. То есть роль могла СДАТЬ день, но не могла его
СОСТАВИТЬ: `POST /api/ops/daily/statuses-bulk/` отвечал ей 403
PERMISSION_DENIED. Проверено на живом стенде учёткой с этой ролью.

Единственным держателем `status.manage` была `INTEGRATION_USER` —
интеграционная учётка. То есть расход мог заполнить кто угодно, кроме того,
кто заполняет его в жизни.

ПОЧЕМУ МИГРАЦИЯ, А НЕ ТОЛЬКО СИД. `seed_operations` гоняют на чистом стенде, а
раскладка прав живёт и на заполненных базах, где команду больше никто не
запустит (та же причина, что у миграции 0047).

ЕЩЁ ДВЕ РОЛИ НЕ ВИДЕЛИ РАСХОД ВОВСЕ. По сценарию ответственный сотрудник
департамента сводит расход за департамент, а оперативный дежурный — за всю
организацию. Обе ручки (`daily-submissions` и `strength-report`) требуют
`status.view`, а у ролей ОМД и ОРГД никакого `status.*` не было: обе получали
403. То есть свод расхода — центр первого сценария — не мог собрать никто,
кроме администратора.

Выдаётся именно ЧТЕНИЕ: ни ОМД, ни ОРГД статусы не проставляют — это делает
начальник управления, и раздавать им `status.manage` значило бы дать право,
которого сценарий не просит.

ОБЛАСТЬ ВИДИМОСТИ НЕ ТРОГАЕТСЯ: право выдаётся ролью, а «своё управление» и
«свой департамент» по-прежнему решает область назначения роли. Проверено
пробами: начальник управления не проставит статус чужому сотруднику и не
сдаст чужой день, а сводный отчёт он видит только по своему поддереву.
"""
from django.db import migrations

#: (роль, право). Раскладка держится ОДНИМ списком: раздача прав по одному
#: правилу на роль расползается при первой же правке.
GRANTS = [
    ("DIVISION_OPERATOR", "status.manage"),
    ("OMD", "status.view"),
    ("ORGD", "status.view"),
]

PERMISSION_NAMES = {
    "status.manage": "Проставление статусов сотрудникам",
    "status.view": "Просмотр статусов сотрудников",
}


def forwards(apps, schema_editor):
    Permission = apps.get_model("operations", "Permission")
    Role = apps.get_model("operations", "Role")
    RolePermission = apps.get_model("operations", "RolePermission")
    for role_code, permission_code in GRANTS:
        # Право может отсутствовать в справочнике заполненной базы — заводим.
        Permission.objects.get_or_create(
            code=permission_code,
            defaults={"name": PERMISSION_NAMES[permission_code]},
        )
        # Роли может не быть на чужом стенде — тогда и раздавать нечего.
        if Role.objects.filter(code=role_code).exists():
            RolePermission.objects.get_or_create(
                role_code_id=role_code, permission_code_id=permission_code
            )


def backwards(apps, schema_editor):
    RolePermission = apps.get_model("operations", "RolePermission")
    for role_code, permission_code in GRANTS:
        RolePermission.objects.filter(
            role_code_id=role_code, permission_code_id=permission_code
        ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0055_remove_opsdictionaryentry_chk_ops_dictionary_code_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
