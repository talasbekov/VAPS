"""Учётка на КАЖДУЮ роль раздела ОМ — под ручную и автоматическую проверку прав.

ЗАЧЕМ. Права раздела раздаются 28 ролями, а учёток, под которыми их можно
увидеть, на стенде было ПЯТЬ назначений на трёх человек. Проверить «видит ли
старший ГВО реестр ГВО» и «не видит ли наблюдатель чужой департамент» было не
на ком: обход портала ходит тремя персонами, остальные роли не проверялись
никогда (Plane №308).

ЧЕМ ОТЛИЧАЕТСЯ ОТ `setup_demo_roles`. Та заводит учётки под ПОРТАЛЬНЫЕ роли
(`common.Role`, шесть строк ROLE_1…ROLE_6) — это другая система ролей, и она
отвечает за портал, а не за раздел ОМ. Здесь — роли раздела
(`operations.Role`), их 28, и пересечения между наборами нет.

РОЛИ БЕРУТСЯ ИЗ БАЗЫ. Захардкоженный список разошёлся бы со справочником —
ровно так уже разошлось перечисление в `setup_demo_roles` (Plane №226) и
падало `AttributeError`.

ПАРОЛЬ НЕ ЗАШИТ: `--password` либо `ROLE_ACCOUNTS_PASSWORD`. Без него команда
отказывается работать и говорит почему — это учётки с правами раздела.

ПОРТАЛЬНАЯ РОЛЬ ВЫДАЁТСЯ ТОЖЕ, и это не щедрость. Без роли `common.Role`
учётка не проходит дальше входа в портал, и проверка прав РАЗДЕЛА выродилась бы
в проверку входа. Выдаётся самая узкая — «Наблюдатель организации» (ROLE_1);
если у роли раздела прав больше, это видно по её собственным правам, а не по
портальной.
"""
from __future__ import annotations

import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Role as OpsRole
from organization_management.apps.operations.services import RoleAdminService

USERNAME_PREFIX = "role_"

# Роли, которым область видимости осмысленна: без неё проверка «видит только
# своё» ничего не показывает — учётка видит либо всё, либо ничего.
SCOPED_ROLES = {
    "DIVISION_OPERATOR": Division.DivisionType.DIVISION,
    "DIRECTORATE_HEAD": Division.DivisionType.DIRECTORATE,
    "DEPARTMENT_EXPENSE_OFFICER": Division.DivisionType.DEPARTMENT,
}


class Command(BaseCommand):
    help = "Заводит по учётке на каждую роль раздела ОМ (Plane: проверка прав)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Пароль учёток; иначе ROLE_ACCOUNTS_PASSWORD.")
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Снести учётки этой команды и завести заново.",
        )

    def handle(self, *args, **options):
        password = options["password"] or os.environ.get("ROLE_ACCOUNTS_PASSWORD", "")
        if options["reset"]:
            removed, _ = User.objects.filter(username__startswith=USERNAME_PREFIX).delete()
            self.stdout.write(self.style.WARNING(f"Снесено учёток (со связями): {removed}."))
        if not password:
            raise CommandError(
                "Пароль не задан. Это учётки с правами раздела, зашивать его в код нельзя: "
                "передайте --password или переменную ROLE_ACCOUNTS_PASSWORD."
            )

        # 🔴 ПОРТАЛЬНОЙ РОЛИ УЧЁТКАМ БОЛЬШЕ НЕ ВЫДАЁТСЯ (Plane №352, Ш-6).
        # Здесь стояла проверка «роли ROLE_1 нет в справочнике — отказ»: без
        # неё учётки не вошли бы в портал. С Ш-1…Ш-4 вход и видимость держат
        # права РАЗДЕЛА, портальную роль не читает никто, а её каталог этот
        # шаг сносит совсем.

        created = updated = 0
        with transaction.atomic():
            for role in OpsRole.objects.filter(is_active=True).order_by("code"):
                username = f"{USERNAME_PREFIX}{role.code.lower()}"
                user, is_new = User.objects.get_or_create(
                    username=username,
                    defaults={"first_name": role.name[:30], "is_staff": False},
                )
                user.set_password(password)
                user.save(update_fields=["password", "first_name", "is_staff"])
                created += int(is_new)
                updated += int(not is_new)

                scope_id = None
                wanted_type = SCOPED_ROLES.get(role.code)
                if wanted_type is not None:
                    division = Division.objects.filter(
                        division_type=wanted_type, is_active=True
                    ).order_by("id").first()
                    scope_id = division.id if division else None

                RoleAdminService.assign_role(
                    str(user.pk), role.code, scope_id, actor="seed_role_accounts"
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Учётки ролей раздела: заведено {created}, обновлено {updated}. "
                f"Имя — {USERNAME_PREFIX}<код роли строчными>."
            )
        )
