from django.core.management.base import BaseCommand

from apps.operations.models import Permission, Role, RolePermission

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
    ("object.manage", "Управление объектами"),
    ("event.manage", "Управление мероприятиями"),
    ("duty.manage", "Управление дежурствами"),
    ("audit.view", "Просмотр аудита"),
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
        "daily_report.generate", "brokerage.manage",
    ],
    "SENIOR_COORDINATOR": ["assignment.create", "assignment.delete", "assignment.submit"],
    "APPROVER": ["assignment.return", "assignment.approve"],
    "DIVISION_OPERATOR": ["daily_report.mark_update", "daily_report.correct", "status.view"],
    "ORGD": ["audit.view", "daily_report.generate"],
    "VIEWER": ["status.view"],
    "INTEGRATION_USER": ["status.manage"],
}


class Command(BaseCommand):
    help = "Seed operations RBAC reference data (idempotent)."

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
