from django.core.management.base import BaseCommand

from apps.operations.rbac.models import Permission, Role, RolePermission

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
    # Story 17.3: оперативное изменение расстановки после утверждения
    # (FR-28) — раскладка ниже PROVISIONAL, отдельная гранулярность прав
    # от assignment.create (выше по риску — живое мероприятие).
    ("assignment.amend", "Оперативное изменение расстановки"),
    ("brokerage.manage", "Брокеридж"),
    ("daily_report.generate", "Генерация суточного отчёта"),
    ("daily_report.mark_update", "Отметки в суточном отчёте"),
    ("daily_report.correct", "Корректировка суточного отчёта"),
    ("daily_report.override_block", "Обход блокировки расхода на завтра"),
    ("object.manage", "Управление объектами"),
    ("event.manage", "Управление мероприятиями"),
    ("duty.manage", "Управление дежурствами"),
    # Story 17.1: журнал штаба (режим проведения, FR-29) — раскладка ниже
    # PROVISIONAL (тот же приём, что personnel.*/document.*): тест
    # проверяет механизм, не политику; открытый вопрос Bratan.
    ("event.journal.create", "Запись в журнал штаба"),
    ("event.journal.view", "Просмотр журнала штаба"),
    ("audit.view", "Просмотр аудита"),
    # core API gating (story 2.13). Provisional role-mapping below — пометка
    # PROVISIONAL (открытый вопрос Bratan); тест проверяет механизм, не политику.
    ("personnel.view", "Просмотр кадровых записей"),
    ("personnel.edit", "Редактирование кадровых записей"),
    ("orgstructure.view", "Просмотр оргструктуры"),
    ("orgstructure.manage", "Управление оргструктурой"),
    # documents API gating (story 6.1). Раскладка ниже PROVISIONAL (Д6,
    # открытый вопрос Bratan) — тест проверяет механизм, не политику.
    ("document.upload", "Загрузка вложений"),
    ("document.view", "Скачивание вложений/документов"),
    # Story 13.1a: видимость багрепортов — НЕ новый механизм, обычный RBAC-код,
    # выдаваемый только роли DEVELOPER ниже (create-эндпоинт открыт любому
    # аутентифицированному без этого кода — гейтуется только чтение).
    ("bugreports.view", "Просмотр багрепортов"),
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
    # Story 13.1a: единственная роль, у которой есть bugreports.view —
    # анонимность отправителя от начальства (буква стори) — обычные роли
    # НЕ получают этот код по умолчанию.
    ("DEVELOPER", "Разработчик"),
]

# core perms (personnel.*/orgstructure.*) — PROVISIONAL раскладка (story 2.13,
# открытый вопрос Bratan). INTEGRATION_USER намеренно БЕЗ core-прав → служит
# DENY-дискриминатором в пилот-тесте vacancy-list.
ROLE_PERMISSIONS = {
    "ADMIN": ["*"],
    "OMD": [
        "assignment.create",
        "assignment.delete",
        "assignment.submit",
        "daily_report.generate",
        "daily_report.override_block",
        "brokerage.manage",
        "personnel.view",
        "orgstructure.view",
        "event.journal.create",
        "event.journal.view",  # PROVISIONAL (17.1)
        "assignment.amend",  # PROVISIONAL (17.3)
    ],
    "SENIOR_COORDINATOR": [
        "assignment.create",
        "assignment.delete",
        "assignment.submit",
        "personnel.view",
        "orgstructure.view",
        "event.journal.create",
        "event.journal.view",  # PROVISIONAL (17.1)
        "assignment.amend",  # PROVISIONAL (17.3)
    ],
    "APPROVER": [
        "assignment.return",
        "assignment.approve",
        "personnel.view",
        "orgstructure.view",
        "event.journal.view",  # PROVISIONAL (17.1)
        "assignment.amend",  # PROVISIONAL (17.3)
    ],
    "DIVISION_OPERATOR": [
        "daily_report.mark_update",
        "daily_report.correct",
        "status.view",
        "personnel.view",
        "orgstructure.view",
        "document.upload",
        "document.view",  # PROVISIONAL (6.1, Д6)
    ],
    "ORGD": [
        "audit.view",
        "daily_report.generate",
        "daily_report.override_block",
        "personnel.view",
        "personnel.edit",
        "orgstructure.view",
        "orgstructure.manage",
        "document.upload",
        "document.view",  # PROVISIONAL (6.1, Д6)
        "event.journal.view",  # PROVISIONAL (17.1)
    ],
    "VIEWER": [
        "status.view",
        "personnel.view",
        "orgstructure.view",
        "document.view",  # PROVISIONAL (6.1, Д6)
        "event.journal.view",  # PROVISIONAL (17.1)
    ],
    "INTEGRATION_USER": ["status.manage"],
    "DEVELOPER": ["bugreports.view"],
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
