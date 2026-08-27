"""Демо-учётки под ручную проверку прав (Plane №226).

ЗАЧЕМ ОНА ВООБЩЕ. Заказчик проверяет права руками (решение №182: «я должен
руками это всё тестировать»), и для этого нужны учётки с РАЗНЫМИ ролями и
разной областью видимости. Заводить их через экраны портала по одной — долго и
невоспроизводимо.

ЧТО БЫЛО НЕ ТАК. Команда обращалась к `UserRole.RoleType.OBSERVER_ORG` —
перечислению, которого у модели нет вовсе: роль давно живёт внешним ключом на
`common.Role` (шесть строк, `ROLE_1`…`ROLE_6`). Команда падала `AttributeError`
на первом же вызове, а знала об этом только строка в `Status.md`.

РОЛИ БЕРУТСЯ ИЗ БАЗЫ, А НЕ ИЗ СПИСКА В КОДЕ. Их набор задаётся справочником и
меняется без правки команды; захардкоженный список разошёлся бы с базой ровно
так же, как разошлось прежнее перечисление.

ПАРОЛЬ НЕ ЗАШИТ. Прежняя версия несла `demo123` прямо в коде — это учётки с
доступом в Admin. Пароль приходит из `--password` или переменной
`DEMO_USERS_PASSWORD`; без него команда отказывается работать и говорит почему.

ОБЛАСТЬ ВИДИМОСТИ СПРАШИВАЕТСЯ У РОЛИ, а не задаётся списком в команде: у
`common.Role` есть флаг `requires_scope`, и модель `UserRole` проверяет его сама
— роли без требования область назначать ЗАПРЕЩЕНО (`clean()` отвечает
`ValidationError`). Тип подразделения под роль берётся из таблицы соответствия,
а если её для роли нет — любое подразделение: важно, что область не пуста, иначе
проверять на такой учётке нечего.
"""
from __future__ import annotations

import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.common.models import Role, UserRole
from organization_management.apps.divisions.models import Division

USERNAME_PREFIX = "demo_"

# Какого УРОВНЯ подразделение осмысленно для роли. Список не решает, НУЖНА ли
# область — это говорит сама роль (`requires_scope`); здесь только тип.
SCOPE_TYPE_BY_ROLE = {
    "ROLE_3": Division.DivisionType.DEPARTMENT,   # руководитель департамента
    "ROLE_6": Division.DivisionType.DIRECTORATE,  # руководитель управления
}


class Command(BaseCommand):
    help = "Заводит демо-учётки под ручную проверку прав (Plane №226)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Пароль демо-учёток; иначе DEMO_USERS_PASSWORD.")
        parser.add_argument("--reset", action="store_true", help="Снести демо-учётки и завести заново.")

    def handle(self, *args, **options):
        password = options["password"] or os.environ.get("DEMO_USERS_PASSWORD", "")
        if options["reset"]:
            removed, _ = User.objects.filter(username__startswith=USERNAME_PREFIX).delete()
            self.stdout.write(self.style.WARNING(f"Снесено демо-учёток (со связями): {removed}."))

        if not password:
            raise CommandError(
                "Пароль не задан. Это учётки с доступом в Admin, и зашивать пароль в код "
                "нельзя: передайте --password или переменную DEMO_USERS_PASSWORD."
            )

        roles = list(Role.objects.order_by("code"))
        if not roles:
            raise CommandError(
                "Справочник ролей пуст: сперва заведите роли (экран «Роли» или миграция), "
                "иначе назначать нечего."
            )

        created = updated = 0
        with transaction.atomic():
            for role in roles:
                user, was_created = self._user(role, password)
                created += int(was_created)
                updated += int(not was_created)
                self._assign(user, role)

        self.stdout.write(
            self.style.SUCCESS(
                f"Демо-учётки: заведено {created}, обновлено {updated}; "
                f"по одной на каждую из {len(roles)} ролей."
            )
        )

    def _user(self, role: Role, password: str) -> tuple[User, bool]:
        username = f"{USERNAME_PREFIX}{role.code.lower()}"
        user, was_created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": f"{username}@example.kz",
                "first_name": "Демо",
                "last_name": role.name,
                # Доступ в Admin: эти учётки и заводятся ради ручной проверки.
                "is_staff": True,
            },
        )
        # Пароль ставится ВСЕГДА, а не только при создании: команду зовут в том
        # числе затем, чтобы вернуть доступ к учётке, пароль которой забыт.
        user.set_password(password)
        user.save(update_fields=["password"])
        return user, was_created

    def _assign(self, user: User, role: Role) -> None:
        UserRole.objects.update_or_create(
            user=user, defaults={"role": role, "scope_division": self._scope(role)}
        )

    def _scope(self, role: Role):
        """Подразделение под роль — только если роль этого требует.

        Роли без `requires_scope` область назначать нельзя вовсе: `UserRole.clean()`
        отвечает на это `ValidationError`, и «на всякий случай» тут обернулось бы
        падением команды.
        """
        if not role.requires_scope:
            return None
        wanted = SCOPE_TYPE_BY_ROLE.get(role.code)
        divisions = Division.objects.order_by("id")
        scope = divisions.filter(division_type=wanted).first() if wanted else None
        scope = scope or divisions.exclude(
            division_type=Division.DivisionType.ORGANIZATION
        ).first()
        if scope is None:
            raise CommandError(
                f"Роль «{role.name}» требует области видимости, а подразделений в системе "
                f"нет вовсе: сперва `manage.py seed_org_structure`."
            )
        return scope
