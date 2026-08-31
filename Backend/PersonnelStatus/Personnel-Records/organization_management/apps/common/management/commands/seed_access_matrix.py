"""Семь учёток под матрицу доступа заказчика (Plane №348).

ЗАЧЕМ. Заказчик проверяет права руками и назвал семь персон, для каждой —
список НЕДОСТУПНЫХ модулей и уровень, на котором персона работает. Заводить
такие учётки экранами портала по одной невоспроизводимо: у каждой две роли из
РАЗНЫХ систем прав, у одной из систем — два гранта с разными областями, плюс
привязка к сотруднику ради кадровой области.

ЧЕМ ОТЛИЧАЕТСЯ ОТ СОСЕДНИХ КОМАНД. `setup_demo_roles` заводит по учётке на
каждую ПОРТАЛЬНУЮ роль, `seed_role_accounts` — на каждую роль РАЗДЕЛА ОМ. Обе
отвечают на вопрос «как выглядит система под этой ролью». Здесь вопрос другой —
«как выглядит система под этим ЧЕЛОВЕКОМ», и роль подбирается под человека, а
не наоборот.

ДВЕ СИСТЕМЫ ПРАВ, И ОБЕ ОБЯЗАТЕЛЬНЫ:
- портал (`common.UserRole`) — роль ОДНА и область ОДНА; она решает, какие
  пункты «Ежедневного расхода» вообще видны (`lib/auth.tsx`);
- раздел ОМ (`operations.UserRole`) — грантов НЕСКОЛЬКО, у каждого своя
  область. Именно это позволяет выдать «категория ОМ на уровне организации, а
  остальное — на уровне своего управления» одной учётке.

ПАРОЛЬ НЕ ЗАШИТ: `--password` либо `ACCESS_MATRIX_PASSWORD`. Без него команда
отказывается работать: это учётки с правами на статусы и мероприятия.

ПОДРАЗДЕЛЕНИЯ ИЩУТСЯ, А НЕ ЗАШИТЫ ЧИСЛАМИ. Заказчик говорит «второй
департамент» и «любой другой департамент кроме второго» — команда так и ищет:
по имени и по «не он». Числа id разошлись бы с базой при первой же пересборке
стенда.
"""
from __future__ import annotations

import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.common.models import Role as PortalRole
from organization_management.apps.common.models import UserRole as PortalUserRole
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import Role as OpsRole
from organization_management.apps.operations.models import UserRole as OpsUserRole
from organization_management.apps.operations.services import RoleAdminService

USERNAME_PREFIX = "acc_"

# Портальные роли матрицы доступа. Заводятся ЗДЕСЬ, а не миграцией: портальные
# роли в этом проекте — данные (`ROLE_1…ROLE_6` тоже заводит стенд, и проба
# `test_the_empty_role_book_is_a_loud_refusal` держит справочник пустым на
# чистой базе). Миграция, сеющая роли, ломала бы этот договор молча.
#
# Названы ПО НАБОРУ МОДУЛЕЙ, а не по должности: один и тот же набор («Обзор +
# Статусы») просят и начальник управления, и начальник второго департамента — у
# них разная область, но одинаковое меню. Роль с именем должности пришлось бы
# дублировать под каждую область.
#
# 🔴 НАБОР МОДУЛЕЙ ЖИВЁТ НА КЛИЕНТЕ (`lib/auth.tsx`, `ROLES`), а не здесь: там
# он и решает, какие пункты меню видны. Код роли обязан стоять в тамошней
# таблице `roleMap` — иначе роль не опознана, и клиент отдаёт самый узкий
# набор (до Plane №349 отдавал полный доступ).
#
# (код, имя, уровень иерархии, требует область, правит статусы, Обзор по департаменту)
PORTAL_ROLES = [
    ("EMPLOYEE_RO", "Сотрудник: просмотр статусов", 2, True, False, False),
    ("HEAD_BASIC", "Руководитель: обзор и статусы", 2, True, True, True),
    ("HEAD_REPORTS", "Руководитель: обзор, статусы, ежедневный отчёт", 1, True, True, False),
    ("FORCES_OFFICER", "Ответственный за сбор сил", 1, True, True, False),
]

# Роли РАЗДЕЛА ОМ здесь не определяются — они живут в каталоге раздела
# (`operations/management/commands/seed_operations.py`, профили Plane №348).
# Команда только НАЗНАЧАЕТ их и падает, если роли в базе нет: заводить те же
# роли вторым списком значило бы завести вторую правду о правах, и разошлись
# бы они на первой же правке.
class Persona:
    """Одна строка задания заказчика — целиком, вместе с обоснованием."""

    def __init__(
        self,
        key: str,
        title: str,
        portal_role: str,
        portal_scope: str,
        ops_grants: tuple[tuple[str, str], ...],
        closed: str,
    ):
        self.key = key
        self.title = title
        self.portal_role = portal_role
        # Ключ подразделения: 'dept_other' | 'dept_second' | 'dir_other' |
        # 'dir_second' | 'none' (вся организация).
        self.portal_scope = portal_scope
        # Пары (код роли раздела, ключ области). Их может быть ДВЕ.
        self.ops_grants = ops_grants
        self.closed = closed

    @property
    def username(self) -> str:
        return f"{USERNAME_PREFIX}{self.key}"


PERSONAS = [
    Persona(
        "employee",
        "Сотрудник",
        "EMPLOYEE_RO",
        "dir_other",
        (("EMPLOYEE", "dir_other"),),
        "Командный центр, Обзор, Сбор сил, Аналитика службы, Ежедневный отчёт, "
        "Реестр ОМ, Транспорт ГОН, Аналитика ОМ, Отчёты по ОМ, Система",
    ),
    Persona(
        "dir_head",
        "Начальник управления (не второй департамент)",
        "HEAD_BASIC",
        "dir_other",
        (("HEAD_DIRECTORATE_LINE", "dir_other"),),
        "Реестр ОМ, Сбор сил, Командный центр, Аналитика службы, Ежедневный отчёт, "
        "Транспорт ГОН, Отчёты по ОМ, Система",
    ),
    Persona(
        "dir_head_d2",
        "Начальник управления второго департамента",
        "HEAD_BASIC",
        "dir_second",
        (("HEAD_OPS_UNIT", "dir_second"), ("OM_CATEGORY_ORG", "none")),
        "Сбор сил, Аналитика службы, Ежедневный отчёт, Система",
    ),
    Persona(
        "dept_head",
        "Начальник департамента (не второй)",
        "HEAD_REPORTS",
        "dept_other",
        (("HEAD_DEPARTMENT_LINE", "dept_other"),),
        "Реестр ОМ, Сбор сил, Командный центр, Транспорт ГОН, Отчёты по ОМ, Система",
    ),
    Persona(
        "dept_head_d2",
        "Начальник второго департамента",
        "HEAD_BASIC",
        "dept_second",
        (("HEAD_OPS_UNIT", "dept_second"), ("OM_CATEGORY_ORG", "none")),
        "Сбор сил, Аналитика службы, Ежедневный отчёт, Система",
    ),
    Persona(
        "forces_officer",
        "Ответственный за сбор сил",
        "FORCES_OFFICER",
        "dept_other",
        (("FORCES_GATHERING_OFFICER", "dept_other"),),
        "Реестр ОМ, Командный центр, Транспорт ГОН, Отчёты по ОМ, Система",
    ),
    Persona(
        "admin",
        "Администратор",
        "ROLE_4",
        "none",
        (("ADMIN", "none"),),
        "— (полный доступ)",
    ),
]


class Command(BaseCommand):
    help = "Заводит семь учёток под матрицу доступа заказчика (Plane №348)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Пароль учёток; иначе ACCESS_MATRIX_PASSWORD.")
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Снести учётки этой команды и завести заново.",
        )

    def handle(self, *args, **options):
        password = options["password"] or os.environ.get("ACCESS_MATRIX_PASSWORD", "")
        if options["reset"]:
            removed, _ = User.objects.filter(username__startswith=USERNAME_PREFIX).delete()
            self.stdout.write(self.style.WARNING(f"Снесено учёток (со связями): {removed}."))
        if not password:
            raise CommandError(
                "Пароль не задан. Это учётки с правами на статусы и мероприятия, "
                "зашивать его в код нельзя: передайте --password или переменную "
                "ACCESS_MATRIX_PASSWORD."
            )

        scopes = self._scopes()
        with transaction.atomic():
            self._ensure_portal_roles()
            self._require_ops_roles()
            rows = [self._persona(p, scopes, password) for p in PERSONAS]

        self._report(rows, scopes, password)

    # ── Подразделения ───────────────────────────────────────────────────────

    def _scopes(self) -> dict[str, Division | None]:
        departments = list(
            Division.objects.filter(
                division_type=Division.DivisionType.DEPARTMENT, is_active=True
            ).order_by("id")
        )
        if len(departments) < 2:
            raise CommandError(
                "Департаментов в базе меньше двух, а задание заказчика делит персон на "
                "«второй департамент» и «любой другой»: сперва `manage.py seed_org_structure`."
            )
        second = next((d for d in departments if "втор" in d.name.lower()), None)
        if second is None:
            # Названия «Второй департамент» может не быть — тогда вторым по
            # порядку и считаем: важно, что персоны разъехались по РАЗНЫМ
            # департаментам, а не то, как департамент назван.
            second = departments[1]
        # «Любой другой департамент» — тот, где ЕСТЬ ЧТО СМОТРЕТЬ. Заказчику
        # безразлично, какой именно, а первый по id на стенде — старый
        # демо-департамент с одним управлением и парой отделов: учётка
        # завелась бы, а проверять её было бы не на чем.
        others = [d for d in departments if d.pk != second.pk]
        other = max(others, key=self._staffed_units)

        scopes: dict[str, Division | None] = {
            "none": None,
            "dept_second": second,
            "dept_other": other,
            "dir_second": self._directorate(second),
            "dir_other": self._directorate(other),
        }
        return scopes

    @staticmethod
    def _staffed_units(department: Division) -> int:
        from organization_management.apps.staff_unit.models import StaffUnit

        ids = department.get_descendants(include_self=True).values_list("id", flat=True)
        return StaffUnit.objects.filter(division_id__in=list(ids)).count()

    @staticmethod
    def _directorate(department: Division) -> Division:
        directorate = (
            Division.objects.filter(
                parent=department,
                division_type=Division.DivisionType.DIRECTORATE,
                is_active=True,
            )
            .order_by("id")
            .first()
        )
        if directorate is None:
            raise CommandError(
                f"В департаменте «{department.name}» нет ни одного управления, а две персоны "
                "заказчика работают именно на уровне управления."
            )
        return directorate

    # ── Роли раздела ОМ ─────────────────────────────────────────────────────

    def _ensure_portal_roles(self) -> None:
        for order, (code, name, level, scoped, edits, overview) in enumerate(
            PORTAL_ROLES, start=7
        ):
            PortalRole.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "hierarchy_level": level,
                    "requires_scope": scoped,
                    "can_edit_statuses": edits,
                    "overview_at_department": overview,
                    "is_active": True,
                    "sort_order": order,
                },
            )

    def _require_ops_roles(self) -> None:
        wanted = {code for persona in PERSONAS for code, _ in persona.ops_grants}
        known = set(
            OpsRole.objects.filter(code__in=wanted, is_active=True).values_list(
                "code", flat=True
            )
        )
        missing = sorted(wanted - known)
        if missing:
            raise CommandError(
                "В каталоге раздела ОМ нет активных ролей: "
                f"{', '.join(missing)}. Они заводятся `manage.py seed_operations`; "
                "завести их здесь вторым списком значило бы развести две правды о правах."
            )

    # ── Учётка ──────────────────────────────────────────────────────────────

    def _persona(self, persona: Persona, scopes, password: str) -> dict:
        portal_role = PortalRole.objects.filter(code=persona.portal_role).first()
        if portal_role is None:
            raise CommandError(
                f"Портальной роли {persona.portal_role} нет в справочнике — учётка "
                f"«{persona.title}» вошла бы в портал с чужим набором модулей. "
                "Прогоните миграции приложения common."
            )

        user, created = User.objects.get_or_create(
            username=persona.username,
            defaults={
                "email": f"{persona.username}@example.kz",
                "first_name": "Проверка",
                "last_name": persona.title[:150],
                "is_staff": False,
            },
        )
        user.set_password(password)
        user.last_name = persona.title[:150]
        user.save(update_fields=["password", "last_name"])

        scope = scopes[persona.portal_scope]
        employee = self._bind_employee(user, scope)

        PortalUserRole.objects.update_or_create(
            user=user, defaults={"role": portal_role, "scope_division": scope}
        )

        # Гранты раздела приводятся к заданным ЦЕЛИКОМ: команду зовут в том
        # числе после правки набора персоны, и оставленный старый грант открыл
        # бы модуль, который заказчик перечислил среди недоступных. Снятие идёт
        # через сервис, а не `delete()`, чтобы журнал раздела видел обе стороны
        # правки.
        wanted = {
            (code, getattr(scopes[scope_key], "pk", None))
            for code, scope_key in persona.ops_grants
        }
        for grant in OpsUserRole.objects.filter(user_id=str(user.pk), is_active=True):
            if (grant.role_code_id, grant.scope_division_id) not in wanted:
                RoleAdminService.revoke_role(
                    str(user.pk),
                    grant.role_code_id,
                    grant.scope_division_id,
                    actor="seed_access_matrix",
                )
        for code, scope_id in wanted:
            RoleAdminService.assign_role(
                str(user.pk), code, scope_id, actor="seed_access_matrix"
            )

        return {
            "persona": persona,
            "created": created,
            "scope": scope,
            "employee": employee,
        }

    @staticmethod
    def _bind_employee(user: User, scope: Division | None) -> Employee | None:
        """Сотрудник под учётку — ради кадровой области и шапки портала.

        Берётся только СВОБОДНЫЙ сотрудник нужного дерева: перевязать чужого
        значило бы отнять учётку у него (`Employee.user` — OneToOne). Не нашёлся
        — учётка живёт без сотрудника: область роли задана явно и от сотрудника
        не зависит, а экран «Обзор» на непривязанной учётке отвечает причиной,
        а не сбоем (Plane №340).
        """
        if scope is None:
            return None
        division_ids = list(scope.get_descendants(include_self=True).values_list("id", flat=True))
        existing = Employee.objects.filter(user=user).first()
        if existing is not None:
            unit = getattr(existing, "staff_unit", None)
            if unit is not None and unit.division_id in division_ids:
                return existing
            # Область персоны сменилась (например, команда стала выбирать другой
            # департамент) — привязка обязана поехать за ней. Оставленный
            # снаружи сотрудник подписывал бы экраны чужим подразделением, а
            # таблицы под подписью считались бы по правильной области: расхождение
            # читается как дефект счёта, хотя это дефект привязки.
            existing.user = None
            existing.save(update_fields=["user"])
        employee = (
            Employee.objects.filter(
                user__isnull=True, staff_unit__division_id__in=division_ids
            )
            .order_by("id")
            .first()
        )
        if employee is None:
            return None
        employee.user = user
        employee.save(update_fields=["user"])
        return employee

    # ── Вывод ───────────────────────────────────────────────────────────────

    @staticmethod
    def _where(scope: Division | None) -> str:
        """Подразделение вместе с родителем.

        Одного имени не хватает: на стенде «Первое управление» есть в КАЖДОМ
        департаменте, и две строки вывода читались бы как одна и та же область.
        """
        if scope is None:
            return "вся организация"
        parent = scope.parent
        return f"{scope.name} ({parent.name})" if parent else scope.name

    def _report(self, rows, scopes, password: str) -> None:
        second = scopes["dept_second"]
        other = scopes["dept_other"]
        self.stdout.write(
            self.style.SUCCESS(
                f"Учётки матрицы доступа. «Второй департамент» — «{second.name}», "
                f"«другой департамент» — «{other.name}»."
            )
        )
        self.stdout.write("")
        for row in rows:
            persona: Persona = row["persona"]
            scope = row["scope"]
            employee = row["employee"]
            self.stdout.write(f"{persona.title}")
            self.stdout.write(f"    логин:      {persona.username}")
            self.stdout.write(f"    пароль:     {password}")
            self.stdout.write(f"    область:    {self._where(scope)}")
            self.stdout.write(f"    портальная роль: {persona.portal_role}")
            self.stdout.write(
                "    роли раздела ОМ: "
                + ", ".join(
                    f"{code} ({self._where(scopes[key])})"
                    for code, key in persona.ops_grants
                )
            )
            self.stdout.write(f"    закрыто:    {persona.closed}")
            if employee is None and scope is not None:
                self.stdout.write(
                    self.style.WARNING(
                        "    ⚠ свободного сотрудника в этом дереве не нашлось — "
                        "учётка без кадровой карточки"
                    )
                )
            self.stdout.write("")
