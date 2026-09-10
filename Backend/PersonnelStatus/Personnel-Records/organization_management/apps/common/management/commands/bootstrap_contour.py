"""One idempotent entry point for a newly migrated closed-contour database."""
from __future__ import annotations

import os

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


REFERENCE_STEPS = (
    ("init_dictionaries", "общие справочники", {}),
    ("seed_positions_ranks", "должности и звания", {}),
    ("seed_status_types", "типы статусов", {}),
    ("seed_org_structure", "структура организации", {}),
    (
        "seed_operations",
        "роли, права и оперативные справочники",
        {"reference_only": True},
    ),
)

DEMO_PERSONNEL_STEPS = (
    ("seed_staffing", "демо-штатные единицы", {}),
    ("seed_employees", "демо-сотрудники", {}),
    ("seed_operations", "демо-данные раздела ОМ", {}),
)


class Command(BaseCommand):
    help = (
        "Идемпотентно наполняет чистую БД закрытого контура справочниками, "
        "структурой и RBAC; демо-персоны и учётки добавляются только с --demo."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--demo",
            action="store_true",
            help="Явно добавить стендовую штатку, сотрудников и проверочные учётки.",
        )
        parser.add_argument(
            "--access-matrix-password",
            help="Пароль acc_*; иначе ACCESS_MATRIX_PASSWORD.",
        )
        parser.add_argument(
            "--role-accounts-password",
            help="Пароль role_*; иначе ROLE_ACCOUNTS_PASSWORD.",
        )

    def handle(self, *args, **options):
        demo_passwords = self._demo_passwords(options) if options["demo"] else None
        self._run_reference_steps()
        if not options["demo"]:
            self.stdout.write(
                self.style.SUCCESS(
                    "Чистый bootstrap завершён: демо-сотрудники и учётки не создавались."
                )
            )
            return

        self._run_steps(DEMO_PERSONNEL_STEPS)
        self._run_demo_accounts(demo_passwords)
        self.stdout.write(
            self.style.SUCCESS("Bootstrap с явно запрошенным демо-набором завершён.")
        )

    def _run_reference_steps(self) -> None:
        # Все шаги пишут только в БД. Общая транзакция не оставляет частично
        # подготовленный чистый контур, если поздняя зависимость не сошлась.
        with transaction.atomic():
            self._run_steps(REFERENCE_STEPS)

    def _run_steps(self, steps) -> None:
        for number, (command, title, command_options) in enumerate(steps, start=1):
            self.stdout.write(
                self.style.MIGRATE_HEADING(
                    f"[{number}/{len(steps)}] {title} — {command}"
                )
            )
            call_command(command, **command_options)

    @staticmethod
    def _demo_passwords(options) -> tuple[str, str]:
        access_password = options["access_matrix_password"] or os.environ.get(
            "ACCESS_MATRIX_PASSWORD", ""
        )
        role_password = options["role_accounts_password"] or os.environ.get(
            "ROLE_ACCOUNTS_PASSWORD", ""
        )
        missing = []
        if not access_password:
            missing.append("ACCESS_MATRIX_PASSWORD")
        if not role_password:
            missing.append("ROLE_ACCOUNTS_PASSWORD")
        if missing:
            raise CommandError(
                "Для --demo до любых изменений задайте секреты: " + ", ".join(missing)
            )
        return access_password, role_password

    def _run_demo_accounts(self, passwords: tuple[str, str]) -> None:
        access_password, role_password = passwords

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                "[1/2] проверочные персоны — seed_access_matrix"
            )
        )
        call_command("seed_access_matrix", password=access_password)
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                "[2/2] учётки ролей — seed_role_accounts"
            )
        )
        call_command("seed_role_accounts", password=role_password)
