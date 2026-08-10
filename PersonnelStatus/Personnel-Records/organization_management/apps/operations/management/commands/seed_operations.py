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
    # Чтение реестра охраняемых объектов отделено от управления им: требовать
    # право правки на просмотр значило бы закрыть реестр от всех, кто его
    # только смотрит. Раскладка PROVISIONAL — как у core/documents.
    ("object.view", "Просмотр охраняемых объектов"),
    ("event.manage", "Управление мероприятиями"),
    # Чтение реестра ОМ отделено от управления по тому же доводу, что у
    # object.view: командный центр смотрят и те, кто мероприятия не ведёт.
    ("event.view", "Просмотр охранных мероприятий"),
    ("duty.manage", "Управление дежурствами"),
    # Чтение плана и утверждение — свои права (мерка event.view): план смотрят
    # и не планирующие, а утверждает не тот, кто планирует.
    ("duty.view", "Просмотр плана дежурств"),
    ("duty.approve_plan", "Утверждение плана дежурств"),
    ("dictionary.view", "Просмотр справочников раздела ОМ"),
    ("dictionary.manage", "Управление справочниками раздела ОМ"),
    ("settings.view", "Просмотр настроек раздела ОМ"),
    ("settings.manage", "Управление настройками раздела ОМ"),
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

        # Справочник видов дежурств и политика конфликтов (порт мок-реестра):
        # данные «с сервера», не хардкод страницы. update_or_create — сид
        # идемпотентен и чинит дрейф, но не плодит дублей.
        from organization_management.apps.operations.models_duty import (
            OpsDutyConflictPolicy,
            OpsDutyType,
        )

        duty_types = [
            ("DAY_OBJECT", "Суточное дежурство на объекте", "PROTECTED_OBJECT",
             1440, True, 1440, True),
            ("DAY_OWN", "Дежурство по управлению", "OWN_OBJECT",
             1440, False, 720, False),
        ]
        for (code, label, target, duration, senior, rest, passport) in duty_types:
            OpsDutyType.objects.update_or_create(
                duty_type_code=code,
                defaults={
                    "safe_label": label,
                    "target_type": target,
                    "default_duration_minutes": duration,
                    "requires_senior": senior,
                    "rest_after_minutes": rest,
                    "requires_current_passport": passport,
                },
            )
        OpsDutyConflictPolicy.objects.get_or_create(
            singleton_key=1,
            defaults={"version": "cp-v1", "rest_after_duty_mode": "SOFT_OVERRIDE"},
        )
        self.stdout.write(self.style.SUCCESS("Seeded duty types and policy"))

        # Боевые группы: виды (§24.3) и реестр Трасс (§24.9) — порт мок-фикстур.
        from organization_management.apps.operations.models_combat import (
            OpsCombatDutyType,
            OpsCombatRoute,
        )

        for code, label, multi in [
            ("COMBAT_GROUP_SINGLE_ROUTE",
             "Дежурство боевой группы на одной Трассе", False),
            ("COMBAT_GROUP_MULTI_ROUTE",
             "Дежурство боевой группы на нескольких Трассах", True),
        ]:
            OpsCombatDutyType.objects.update_or_create(
                duty_type_code=code,
                defaults={"safe_label": label, "supports_multiple_routes": multi},
            )
        for code, label in [
            ("route-1", "Трасса №1 (Аэропорт — Резиденция)"),
            ("route-2", "Трасса №2 (Резиденция — Дворец Независимости)"),
            ("route-3", "Трасса №3 (Вокзал — Гостиница)"),
        ]:
            OpsCombatRoute.objects.update_or_create(
                route_code=code, defaults={"safe_label": label}
            )
        self.stdout.write(self.style.SUCCESS("Seeded combat registries"))

        # Настройки-политики и их версии (порт мок-реестра; владелец политик
        # теперь настройки — синглтоны политик обновляются сквозной записью).
        from organization_management.apps.operations.models_settings import (
            OpsDictionaryEntry,
            OpsPolicySectionVersion,
            OpsPolicySetting,
        )

        MODE_OPTIONS = [
            {"value": "SOFT_OVERRIDE", "safeLabel": "Обход с обоснованием",
             "description": "Назначение возможно: планирующий подтверждает "
             "конфликт причиной, она сохраняется на смене."},
            {"value": "HARD_BLOCK", "safeLabel": "Жёсткая блокировка",
             "description": "Назначение в период отдыха отвергается без "
             "возможности обхода."},
        ]
        SETTINGS = [
            ("conflict.rest_after_duty.mode", "CONFLICT_RULES", "CHOICE",
             "MODE", "Отдых после дежурства",
             "Как планирование реагирует на назначение в период обязательного отдыха.",
             "SOFT_OVERRIDE", None, None, MODE_OPTIONS, True, None),
            ("conflict.duty_overlap.mode", "CONFLICT_RULES", "CHOICE",
             "MODE", "Пересечение дежурств",
             "Два дежурства одного сотрудника в один день.",
             "HARD_BLOCK", None, None,
             [{"value": "HARD_BLOCK", "safeLabel": "Жёсткая блокировка",
               "description": "Пересечение отвергается всегда."}],
             False,
             "Жёсткий запрет пересечения нельзя ослабить никому — правило "
             "показано для полноты списка."),
            ("passport.verification_interval_days", "PASSPORT_FRESHNESS",
             "NUMBER", "DAYS", "Интервал проверки паспорта",
             "Через сколько дней после публикации версии паспорт требует проверки.",
             120, 30, 365, None, True, None),
            ("passport.due_soon_percent", "PASSPORT_FRESHNESS", "NUMBER",
             "PERCENT", "Порог «скоро проверка»",
             "Доля интервала до срока, с которой паспорт помечается «скоро проверка».",
             25, 5, 50, None, True, None),
            ("RATING.PERIOD.PARAMETER", "RATING_POLICY", "NUMBER", "DAYS",
             "Период расчёта рейтинга",
             "Сколько суток назад от бизнес-даты входит в расчёт агрегата.",
             90, 7, 365, None, True, None),
            ("RATING.MIN_EVALUATIONS.PARAMETER", "RATING_POLICY", "NUMBER",
             "COUNT", "Минимум оценок для агрегата",
             "Меньше этого числа учтённых оценок — «Недостаточно данных».",
             4, 1, 20, None, True, None),
            ("RATING.SUPPRESSION_MIN_GROUP.PARAMETER", "RATING_POLICY",
             "NUMBER", "COUNT", "Порог безопасной агрегации",
             "Минимальный размер группы для публикации агрегата.",
             3, 2, 10, None, True, None),
            ("LIMITS.ANALYTICS_CUSTOM_PERIOD.PARAMETER", "ANALYTICS_LIMITS",
             "NUMBER", "DAYS", "Предел произвольного периода аналитики",
             "Максимальная длина произвольного периода выборки.",
             92, 7, 366, None, True, None),
            ("LOAD.PERIOD.PARAMETER", "LOAD_POLICY", "NUMBER", "DAYS",
             "Окно расчёта нагрузки", "Окно расчёта нагрузки.",
             30, 7, 92, None, True, None),
            ("LOAD.WARNING_MINUTES.PARAMETER", "LOAD_POLICY", "NUMBER",
             "MINUTES", "Порог предупреждения нагрузки",
             "Суммарные минуты за окно, с которых нагрузка — предупреждение.",
             2880, 480, 20160, None, True, None),
            ("LOAD.OVERLOAD_MINUTES.PARAMETER", "LOAD_POLICY", "NUMBER",
             "MINUTES", "Порог перегрузки",
             "Суммарные минуты за окно, с которых нагрузка — перегрузка.",
             5760, 960, 40320, None, True, None),
            ("ATTENTION.CONFLICT_SHARE.WARNING_FROM", "ATTENTION_POLICY",
             "NUMBER", "PERCENT", "Доля конфликтных смен: предупреждение",
             "Порог доли конфликтных смен для предупреждения.",
             18, 1, 100, None, True, None),
            ("ATTENTION.CONFLICT_SHARE.CRITICAL_FROM", "ATTENTION_POLICY",
             "NUMBER", "PERCENT", "Доля конфликтных смен: критично",
             "Порог доли конфликтных смен для критичного состояния.",
             34, 1, 100, None, True, None),
            ("ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER",
             "ATTENTION_POLICY", "NUMBER", "DAYS",
             "Срок упреждения ознакомления",
             "За сколько дней до смены отсутствие ознакомления — наблюдение.",
             3, 1, 14, None, True, None),
            ("LIMITS.REPORT_PERIOD.PERSONNEL_EXPENSE", "REPORT_LIMITS",
             "NUMBER", "DAYS", "Предел периода «Расход личного состава»",
             "Максимальный период одной выгрузки.",
             92, 7, 366, None, True, None),
            ("LIMITS.REPORT_RETENTION.PARAMETER", "REPORT_LIMITS", "NUMBER",
             "DAYS", "Срок хранения артефактов отчётов",
             "Сколько дней хранится готовый артефакт.",
             14, 1, 366, None, True, None),
        ]
        # имя choice_options, не options: options — словарь аргументов handle,
        # затенение оставило бы в нём None последней строки (инцидент D1).
        for (code, section, kind, vtype, label, desc, value, mn, mx,
             choice_options, editable, locked) in SETTINGS:
            OpsPolicySetting.objects.update_or_create(
                setting_code=code,
                defaults={
                    "section_code": section, "kind": kind,
                    "value_type": vtype, "safe_label": label,
                    "description": desc, "value": value,
                    "min_value": mn, "max_value": mx,
                    "options": choice_options,
                    "editable": editable, "locked_reason": locked,
                },
            )
        # Версии секций выровнены с уже посеянными синглтонами политик
        # (fp-v1/cp-v1) — версия посчитанного результата и версия раздела
        # обязаны совпадать с первого дня.
        for section, version in [
            ("CONFLICT_RULES", "cp-v1"),
            ("PASSPORT_FRESHNESS", "fp-v1"),
            ("RATING_POLICY", "OPERATIONAL-RATING-2026.07.1"),
            ("ANALYTICS_LIMITS", "analytics-limits-v1"),
            ("LOAD_POLICY", "load-policy-v1"),
            ("ATTENTION_POLICY", "attention-policy-v1"),
            ("REPORT_LIMITS", "report-limits-v1"),
        ]:
            OpsPolicySectionVersion.objects.get_or_create(
                section_code=section, defaults={"version": version}
            )
        DICTIONARY_ENTRIES = [
            ("JOURNAL_ENTRY_TYPES", "INSTRUCTION", "Инструктаж", None),
            ("JOURNAL_ENTRY_TYPES", "ORDER", "Распоряжение", None),
            ("JOURNAL_ENTRY_TYPES", "INCIDENT", "Инцидент", None),
            ("JOURNAL_ENTRY_TYPES", "REPLACEMENT", "Замена", None),
            ("RETURN_REASONS", "UNDERSTAFFED", "Посты недоукомплектованы", None),
            ("RETURN_REASONS", "WRONG_REQUIREMENTS", "Не выдержаны требования", None),
            ("POST_REQUIREMENT_GROUPS", "ACCESS", "Допуски", None),
            ("POST_REQUIREMENT_GROUPS", "PHYSICAL", "Физические требования", None),
            ("POST_REQUIREMENTS", "ACCESS_A", "Допуск «Объект A»", "ACCESS"),
            ("POST_REQUIREMENTS", "HEIGHT_175", "Рост от 175 см", "PHYSICAL"),
            ("SEASONAL_CORRECTIONS", "WINTER", "Зимняя поправка", None),
        ]
        for dictionary, code, label, group in DICTIONARY_ENTRIES:
            OpsDictionaryEntry.objects.update_or_create(
                dictionary_code=dictionary, code=code,
                defaults={
                    "label": label, "description": "", "is_active": True,
                    "group_code": group,
                },
            )
        self.stdout.write(
            self.style.SUCCESS("Seeded ops settings and dictionaries")
        )

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
