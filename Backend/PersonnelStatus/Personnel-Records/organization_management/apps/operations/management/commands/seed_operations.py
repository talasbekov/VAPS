"""Сид справочника RBAC раздела ОМ (порт seed_operations из Backend/VAPS,
PERMISSIONS/ROLES/ROLE_PERMISSIONS — дословно) + назначение ролей учёткам
стенда через --assign (в источнике назначения делает внешний КУ; здесь на
переходный период — команда).
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import (
    LegacyRoleSync,
    RoleAdminService,
)

PERMISSIONS = [
    ("*", "Все права"),
    ("admin.roles", "Управление ролями"),
    ("status.manage", "Управление статусами"),
    ("status.view", "Просмотр статусов"),
    ("assignment.create", "Создание назначения"),
    ("assignment.delete", "Удаление назначения"),
    ("assignment.submit", "Отправка расстановки"),
    ("assignment.return", "Возврат расстановки"),
    ("assignment.approve", "Утверждение расстановки"),
    ("brokerage.manage", "Брокеридж"),
    ("daily_report.generate", "Генерация суточного отчёта"),
    ("daily_report.mark_update", "Отметки в суточном отчёте"),
    ("daily_report.correct", "Корректировка суточного отчёта"),
    ("daily_report.override_block", "Обход блокировки расхода на завтра"),
    ("object.manage", "Управление объектами"),
    ("event.manage", "Управление мероприятиями"),
    ("duty.manage", "Управление дежурствами"),
    ("audit.view", "Просмотр аудита"),
    # core API gating — раскладка PROVISIONAL (открытый вопрос Bratan);
    # тесты проверяют механизм, не политику.
    ("personnel.view", "Просмотр кадровых записей"),
    ("personnel.edit", "Редактирование кадровых записей"),
    ("orgstructure.view", "Просмотр оргструктуры"),
    ("orgstructure.manage", "Управление оргструктурой"),
    # documents API gating — раскладка PROVISIONAL.
    ("document.upload", "Загрузка вложений"),
    ("document.view", "Скачивание вложений/документов"),
]

ROLES = [
    ("ADMIN", "Администратор"),
    ("ORGD", "ОРГД"),
    ("OMD", "ОМД"),
    ("SENIOR_COORDINATOR", "Старший координатор"),
    ("APPROVER", "Утверждающий"),
    ("DIVISION_OPERATOR", "Оператор подразделения"),
    ("VIEWER", "Наблюдатель"),
    ("INTEGRATION_USER", "Интеграционная учётная запись"),
]

ROLE_PERMISSIONS = {
    "ADMIN": ["*"],
    "OMD": [
        "assignment.create", "assignment.delete", "assignment.submit",
        "daily_report.generate", "daily_report.override_block", "brokerage.manage",
        "personnel.view", "orgstructure.view",
    ],
    "SENIOR_COORDINATOR": [
        "assignment.create", "assignment.delete", "assignment.submit",
        "personnel.view", "orgstructure.view",
    ],
    "APPROVER": [
        "assignment.return", "assignment.approve",
        "personnel.view", "orgstructure.view",
    ],
    "DIVISION_OPERATOR": [
        "daily_report.mark_update", "daily_report.correct", "status.view",
        "personnel.view", "orgstructure.view",
        "document.upload", "document.view",
    ],
    "ORGD": [
        "audit.view", "daily_report.generate", "daily_report.override_block",
        "personnel.view", "personnel.edit",
        "orgstructure.view", "orgstructure.manage",
        "document.upload", "document.view",
    ],
    "VIEWER": [
        "status.view", "personnel.view", "orgstructure.view",
        "document.view",
    ],
    "INTEGRATION_USER": ["status.manage"],
}


class Command(BaseCommand):
    help = (
        "Seed operations RBAC reference data (idempotent). "
        "--assign username:ROLE[:scope_division_id] назначает роль учётке."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--assign",
            action="append",
            default=[],
            metavar="user:ROLE[:division_id]",
            help="Назначить роль пользователю (можно несколько раз).",
        )

    def handle(self, *args, **options):
        for code, name in PERMISSIONS:
            Permission.objects.update_or_create(code=code, defaults={"name": name})
        for code, name in ROLES:
            Role.objects.update_or_create(code=code, defaults={"name": name})
        for role_code, perm_codes in ROLE_PERMISSIONS.items():
            for perm_code in perm_codes:
                RolePermission.objects.update_or_create(
                    role_code_id=role_code, permission_code_id=perm_code
                )
        self.stdout.write(self.style.SUCCESS("Seeded operations RBAC"))

        for spec in options["assign"]:
            parts = spec.split(":")
            if len(parts) not in (2, 3):
                raise CommandError(f"--assign ожидает user:ROLE[:division_id]: {spec}")
            username, role_code = parts[0], parts[1]
            scope = int(parts[2]) if len(parts) == 3 else None
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                raise CommandError(f"Пользователь не найден: {username}")
            RoleAdminService.assign_role(
                LegacyRoleSync.actor_id_for_user(user),
                role_code,
                scope,
                actor="seed_operations",
            )
            self.stdout.write(
                self.style.SUCCESS(f"Assigned {role_code} -> {username} (scope={scope})")
            )
