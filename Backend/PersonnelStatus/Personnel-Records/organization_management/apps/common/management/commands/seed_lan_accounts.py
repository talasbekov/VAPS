"""Учётки закрытой сети — на стенде те же логины, роли и области (Plane №1202).

ЗАЧЕМ. Заказчик развернул систему в закрытой сети и завёл там учётки руками
по фамилиям (`a_esmagambetov`, `k_baglanov`, …), подписав каждую ярлыком
персоны матрицы №348 («Начальник департамента (не второй)», «Штаб второго
департамента», …). Поручение 12.09.2026: «такие же учётки создай… роли этих
учёток должны быть согласно документации», плюс отдельная учётка оперативного
дежурного `o_sagynbek` и единый пароль для всех.

ЧЕМ ОТЛИЧАЕТСЯ ОТ `seed_access_matrix`. Персоны — ТЕ ЖЕ (роли, области,
кадровая привязка берутся из `PERSONAS` той команды, второй правды о персонах
здесь нет); отличаются только логины — человеческие, как в закрытой сети, — и
две учётки сверх матрицы: оперативный дежурный (`DUTY_OFFICER`, вся
организация; в матрице №348 его не было, заказчик добавил 12.09.2026) и две
безымянные учётки без роли, которые на снимке есть (`a_rakhymzhanov`,
`d_levchenko`) — заводятся как есть, роль им заказчик не назвал.

ПОДРАЗДЕЛЕНИЯ — решение заказчика 12.09.2026, вариант (а): стендовые
«Первый/Второй/Третий департамент» остаются, учётки привязываются к ним тем же
поиском, что и матрица («второй» — по имени, «другой» — где есть штат).

ПАРОЛЬ НЕ ЗАШИТ: `--password` либо `LAN_ACCOUNTS_PASSWORD`. По слову заказчика
он ставится ВСЕМ учёткам списка, включая рабочие `admin`, `erda`, `observer` и
`acc_admin`; файлы секретов стенда (`~/.config/vaps/*`) при этом приводятся к
тому же значению руками — команда в домашний каталог не пишет.
"""
from __future__ import annotations

import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.common.management.commands.seed_access_matrix import (
    PERSONAS,
    Command as MatrixCommand,
    Persona,
)
from organization_management.apps.operations.models import UserRole as OpsUserRole
from organization_management.apps.operations.services import RoleAdminService

ACTOR = "seed_lan_accounts"

DUTY_OFFICER = Persona(
    "duty_officer",
    "Оперативный дежурный",
    "none",
    (("DUTY_OFFICER", "none"),),
    # По канону (RAW/README §20, `[РАСХ-ПЛН-05]`): сводит департаменты в
    # расход Службы, статусы не правит.
    "Правка статусов, Сбор сил, Реестр ОМ, Система",
)

# Логин закрытой сети → ключ персоны матрицы. Ярлык персоны и есть фамилия
# учётки на снимке заказчика (LAST NAME), имя — «Проверка», как у `acc_*`.
LAN_ACCOUNTS: tuple[tuple[str, str], ...] = (
    ("y_talasbekov", "employee"),
    ("n_meldebekov", "dir_head"),
    ("k_baglanov", "dir_head_d2"),
    ("a_esmagambetov", "dept_head"),
    ("m_turmagambetov", "dept_head_d2"),
    ("a_raiymzhanov", "forces_officer"),
    ("u_musakhan", "employee_d2"),
    ("y_meiram", "ops_staff"),
    ("acc_admin", "admin"),
    ("o_sagynbek", "duty_officer"),
)

# Есть на снимке, роли и имени не имеют — заводятся как есть.
UNASSIGNED: tuple[str, ...] = ("a_rakhymzhanov", "d_levchenko")

# Рабочие учётки стенда: существуют, роли не трогаются, только пароль.
PASSWORD_ONLY: tuple[str, ...] = ("admin", "erda", "observer")


def _personas() -> dict[str, Persona]:
    by_key = {persona.key: persona for persona in PERSONAS}
    by_key[DUTY_OFFICER.key] = DUTY_OFFICER
    return by_key


class Command(BaseCommand):
    help = "Заводит учётки закрытой сети на стенде: те же логины, роли и области (Plane №1202)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Единый пароль; иначе LAN_ACCOUNTS_PASSWORD.")

    def handle(self, *args, **options):
        password = options["password"] or os.environ.get("LAN_ACCOUNTS_PASSWORD", "")
        if not password:
            raise CommandError(
                "Пароль не задан. Это учётки с правами на статусы и мероприятия, "
                "зашивать его в код нельзя: передайте --password или переменную "
                "LAN_ACCOUNTS_PASSWORD."
            )
        matrix = MatrixCommand()
        matrix.stdout = self.stdout
        personas = _personas()
        wanted_roles = {code for p in personas.values() for code, _ in p.ops_grants}
        scopes = matrix._scopes()
        with transaction.atomic():
            self._require_roles(wanted_roles)
            rows = [
                self._account(login, personas[key], scopes, password, matrix)
                for login, key in LAN_ACCOUNTS
            ]
            for login in UNASSIGNED:
                user, _ = User.objects.get_or_create(username=login)
                user.set_password(password)
                user.save(update_fields=["password"])
            missing = []
            for login in PASSWORD_ONLY:
                user = User.objects.filter(username=login).first()
                if user is None:
                    missing.append(login)
                    continue
                user.set_password(password)
                user.save(update_fields=["password"])
        self._report(rows, scopes, matrix, missing)

    @staticmethod
    def _require_roles(wanted: set[str]) -> None:
        from organization_management.apps.operations.models import Role as OpsRole

        known = set(
            OpsRole.objects.filter(code__in=wanted, is_active=True).values_list("code", flat=True)
        )
        missing = sorted(wanted - known)
        if missing:
            raise CommandError(
                "В каталоге раздела ОМ нет активных ролей: "
                f"{', '.join(missing)}. Они заводятся `manage.py seed_operations`."
            )

    def _account(self, login: str, persona: Persona, scopes, password: str, matrix) -> dict:
        user, created = User.objects.get_or_create(
            username=login,
            defaults={
                "email": f"{login}@example.kz",
                "first_name": "Проверка",
                "last_name": persona.title[:150],
                "is_staff": False,
            },
        )
        user.set_password(password)
        user.first_name = user.first_name or "Проверка"
        user.last_name = persona.title[:150]
        user.save(update_fields=["password", "first_name", "last_name"])

        scope = scopes[persona.scope_key]
        employee = matrix._bind_employee(user, scope)

        # Гранты приводятся к персоне ЦЕЛИКОМ — как в матрице: старый лишний
        # грант открыл бы модуль, который заказчик назвал недоступным.
        wanted = {
            (code, getattr(scopes[scope_key], "pk", None))
            for code, scope_key in persona.ops_grants
        }
        for grant in OpsUserRole.objects.filter(user_id=str(user.pk), is_active=True):
            if (grant.role_code_id, grant.scope_division_id) not in wanted:
                RoleAdminService.revoke_role(
                    str(user.pk), grant.role_code_id, grant.scope_division_id, actor=ACTOR
                )
        for code, scope_id in wanted:
            RoleAdminService.assign_role(str(user.pk), code, scope_id, actor=ACTOR)
        return {"login": login, "persona": persona, "created": created, "scope": scope, "employee": employee}

    def _report(self, rows, scopes, matrix, missing) -> None:
        self.stdout.write(
            self.style.SUCCESS(
                "Учётки закрытой сети на стенде. "
                f"«Второй департамент» — «{scopes['dept_second'].name}», "
                f"«другой департамент» — «{scopes['dept_other'].name}»."
            )
        )
        self.stdout.write("")
        for row in rows:
            persona: Persona = row["persona"]
            self.stdout.write(f"{persona.title}")
            self.stdout.write(f"    логин:      {row['login']}")
            self.stdout.write("    пароль:     задан (значение не выводится)")
            self.stdout.write(f"    область:    {matrix._where(row['scope'])}")
            self.stdout.write(
                "    роли раздела ОМ: "
                + ", ".join(
                    f"{code} ({matrix._where(scopes[key])})" for code, key in persona.ops_grants
                )
            )
            self.stdout.write(f"    закрыто:    {persona.closed}")
            if row["employee"] is None and row["scope"] is not None:
                self.stdout.write(
                    self.style.WARNING("    ⚠ свободного сотрудника в этом дереве не нашлось")
                )
            self.stdout.write("")
        self.stdout.write(f"Без роли (как на снимке): {', '.join(UNASSIGNED)}")
        self.stdout.write(
            "Только пароль: "
            + ", ".join(login for login in PASSWORD_ONLY if login not in missing)
        )
        if missing:
            self.stdout.write(
                self.style.WARNING(f"    ⚠ на стенде нет учёток: {', '.join(missing)} — пропущены")
            )
