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
    # Оперативный рейтинг: §19.22 перечисляет права ПОРОЗНЬ — просмотр
    # агрегата, выставление, исправление, цепочка исправлений, журнал и
    # выгрузка охраняют разные операции с разными владельцами.
    ("rating.view_aggregate", "Просмотр агрегированного рейтинга"),
    ("rating.evaluate", "Выставление оценки"),
    ("rating.correct", "Исправление собственной оценки"),
    ("rating.view_correction_chain", "Просмотр цепочки исправлений"),
    ("rating.view_audit", "Просмотр журнала оценивания"),
    ("rating.export", "Выгрузка агрегированной сводки рейтинга"),
    # Отчёт §22.16 охраняет право РАЗДЕЛА АНАЛИТИКИ, не право сводки.
    ("analytics.view", "Просмотр аналитики раздела ОМ"),
    # §22.26 перечисляет их отдельными пунктами: дашборд показывает
    # агрегаты, выборка — людей и смены, аналитика ОМ — другой раздел.
    ("analytics.drilldown", "Раскрытие показателя аналитики до строк"),
    ("analytics.personal_detail", "Персональная детализация аналитики"),
    ("analytics.operations", "Просмотр аналитики мероприятий"),
    # §22.26/§20.32: запуск отчёта, sensitive export и параметры чужого
    # запуска — три разных действия с разными владельцами.
    ("report.generate", "Запуск служебных отчётов"),
    ("report.export_sensitive", "Выгрузка отчёта со скрытыми полями"),
    ("report.view_foreign_parameters", "Просмотр параметров чужого отчёта"),
    # Обратная связь (§28): права ПОРОЗНЬ — право пожаловаться, право читать
    # чужие обращения, содержание чужого конфиденциального, разбор и
    # внутренние заметки охраняют разные операции с разными владельцами.
    ("feedback.view", "Просмотр обращений обратной связи"),
    ("feedback.create", "Создание обращения обратной связи"),
    ("feedback.view_all", "Просмотр чужих обращений обратной связи"),
    ("feedback.view_confidential",
     "Просмотр содержания конфиденциальных обращений"),
    ("feedback.triage", "Разбор обращений обратной связи"),
    ("feedback.internal_note", "Внутренние заметки по обращениям"),
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
        parser.add_argument(
            "--feedback-author",
            default=None,
            metavar="actor_id",
            help=(
                "Завести на живом стенде черновик обращения от указанного "
                "actor_id (str(User.pk)): сеяные обращения несут "
                "идентификаторы demo-персон мок-контракта, и без своего "
                "черновика путь «отправить черновик» вживую недостижим."
            ),
        )
        parser.add_argument(
            "--rating-evaluator",
            default=None,
            metavar="actor_id",
            help=(
                "Привязать задания оценивания основного демо-оценщика к "
                "реальному actor_id (str(User.pk)): без этого очередь "
                "рабочего пространства на живом стенде пуста — сид несёт "
                "литеральные идентификаторы мок-контракта."
            ),
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

        self._seed_ratings(options.get("rating_evaluator"))
        self._seed_analytics()
        self._seed_reports()
        self._seed_feedback(options.get("feedback_author"))

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

    def _seed_ratings(self, rating_evaluator):
        """Демо-данные оперативного рейтинга — порт мок-фикстур клиента
        (features/ratings/mocks/fixtures.ts) ДОСЛОВНО: числа намеренно не
        круглые (среднее 8,0 совпало бы со «стандартной восьмёркой» и скрыло
        бы подмену расчёта константой), у employee-1 есть вытесненная
        исправлением оценка, у employee-4 оценок нет вовсе."""
        import datetime as dt

        from organization_management.apps.operations.models_rating import (
            OpsEvaluationCorrection,
            OpsEvaluationEvent,
            OpsEvaluationWorkItem,
            OpsEventEvaluation,
            OpsRatedParticipant,
            OpsRatingAuditEntry,
            OpsRatingDynamicsPoint,
            OpsRatingFeatureFlags,
            OpsRatingGroup,
            OpsRatingNotification,
        )

        iso = dt.datetime.fromisoformat
        planner = rating_evaluator or "demo-event-planner"

        for code, label in [
            ("division-1", "Первое управление"),
            ("division-2", "Второе управление"),
            ("division-3", "Третье управление"),
        ]:
            OpsRatingGroup.objects.update_or_create(
                group_code=code, defaults={"safe_label": label},
            )

        participants = [
            ("employee-1", "Ерланов Д.", "division-1"),
            ("employee-2", "Абишев Н.", "division-1"),
            ("employee-3", "Сейтказы М.", "division-2"),
            ("employee-4", "Нурланов Е.", "division-2"),
            ("employee-5", "Тлеуов А.", "division-1"),
            ("employee-6", "Жумабек С.", "division-1"),
            # Третье управление — ровно два участника с агрегатом: меньше
            # порога безопасной агрегации, на нём держится SUPPRESSED.
            ("employee-7", "Оспанов Р.", "division-3"),
            ("employee-8", "Кайрат Б.", "division-3"),
        ]
        for code, label, group in participants:
            OpsRatedParticipant.objects.update_or_create(
                participant_code=code,
                defaults={"safe_label": label, "group_code": group},
            )

        for (code, run, number, title, obj, starts, ends) in [
            ("event-1", "run-1", "ОМ-2026-014", "Международный форум",
             "Конгресс-холл", "2026-07-18T07:40:00+05:00",
             "2026-07-18T19:20:00+05:00"),
            ("event-2", "run-2", "ОМ-2026-015", "Рабочая поездка",
             "Аэропорт", "2026-07-20T05:10:00+05:00",
             "2026-07-20T12:05:00+05:00"),
        ]:
            OpsEvaluationEvent.objects.update_or_create(
                event_code=code,
                defaults={
                    "event_run_code": run, "number": number, "title": title,
                    "object_label": obj, "actual_starts_at": iso(starts),
                    "actual_ends_at": iso(ends), "state_label": "Завершено",
                    "security_event_id": None,
                },
            )

        def evaluation(code, participant, score, evaluated_at, **extra):
            defaults = {
                "event_code": "event-1",
                "participant_code": participant,
                "evaluator_user_id": planner,
                "score": score,
                "comment": (
                    "Задержка на инструктаже, разобрано со старшим"
                    if score < 8 else None
                ),
                "evaluation_direction": "SENIOR_TO_EMPLOYEE",
                "method": "MANUAL",
                "basis_code": (
                    "TIMELY_ARRIVAL" if score < 8 else "EXECUTION_OF_DUTIES"
                ),
                "basis_note": None,
                "evaluated_at": dt.date.fromisoformat(evaluated_at),
                "superseded_by_code": None,
            }
            defaults.update(extra)
            OpsEventEvaluation.objects.update_or_create(
                evaluation_code=code, defaults=defaults,
            )

        evaluation("evaluation-1", "employee-1", 9, "2026-07-02")
        evaluation("evaluation-2", "employee-1", 8, "2026-07-08")
        evaluation("evaluation-3", "employee-1", 7, "2026-07-11")
        # Исправленная оценка и её замена (§19.18): исходная не
        # переписывается, а помечается ссылкой.
        evaluation(
            "evaluation-4", "employee-1", 3, "2026-07-14",
            superseded_by_code="evaluation-5",
            comment="Оценка выставлена по ошибке не тому участнику",
        )
        evaluation("evaluation-5", "employee-1", 9, "2026-07-15")
        evaluation("evaluation-6", "employee-1", 10, "2026-07-17")
        evaluation("evaluation-7", "employee-2", 6, "2026-07-05")
        evaluation("evaluation-8", "employee-2", 8, "2026-07-09")
        evaluation("evaluation-9", "employee-2", 7, "2026-07-13")
        evaluation("evaluation-10", "employee-2", 9, "2026-07-18")
        # Оценка ДРУГОГО оценщика: без неё «в отправленных только свои»
        # проверялось бы на пустом множестве.
        evaluation(
            "evaluation-11", "employee-3", 8, "2026-07-06",
            evaluator_user_id="demo-recon-officer",
        )
        evaluation("evaluation-12", "employee-3", 9, "2026-07-16")
        # За пределами периода расчёта; она же — СИСТЕМНАЯ восьмёрка (§19.8):
        # оценщика нет, задания она не порождает.
        evaluation(
            "evaluation-13", "employee-4", 8, "2025-11-04",
            evaluator_user_id=None, method="SYSTEM_DEFAULT", basis_code=None,
        )
        evaluation("evaluation-14", "employee-5", 9, "2026-07-03")
        evaluation("evaluation-15", "employee-5", 10, "2026-07-07")
        evaluation("evaluation-16", "employee-5", 9, "2026-07-12")
        evaluation("evaluation-17", "employee-5", 9, "2026-07-16")
        evaluation("evaluation-18", "employee-6", 7, "2026-07-04")
        evaluation("evaluation-19", "employee-6", 6, "2026-07-08")
        evaluation("evaluation-20", "employee-6", 7, "2026-07-12")
        evaluation("evaluation-21", "employee-6", 7, "2026-07-17")
        evaluation("evaluation-22", "employee-7", 8, "2026-07-02")
        evaluation("evaluation-23", "employee-7", 8, "2026-07-09")
        evaluation("evaluation-24", "employee-7", 8, "2026-07-14")
        evaluation("evaluation-25", "employee-7", 8, "2026-07-18")
        evaluation("evaluation-26", "employee-8", 9, "2026-07-05")
        evaluation("evaluation-27", "employee-8", 10, "2026-07-10")
        evaluation("evaluation-28", "employee-8", 9, "2026-07-15")
        evaluation("evaluation-29", "employee-8", 8, "2026-07-19")

        events = {
            row.event_code: row for row in OpsEvaluationEvent.objects.all()
        }
        people = {
            row.participant_code: row
            for row in OpsRatedParticipant.objects.all()
        }
        groups = {
            row.group_code: row for row in OpsRatingGroup.objects.all()
        }

        def work_item(code, event_code, evaluator, target, post, **extra):
            event = events[event_code]
            person = people[target]
            defaults = {
                "event_code": event_code,
                "event_run_code": event.event_run_code,
                "assignment_code": f"assignment-{code}",
                "evaluator_user_id": evaluator,
                "target_participant_code": target,
                "target_group_code": None,
                "target_safe_label": person.safe_label,
                "target_safe_unit_label": groups[person.group_code].safe_label,
                "post_label": post,
                "actual_starts_at": event.actual_starts_at,
                "actual_ends_at": event.actual_ends_at,
                "participated": True,
                "evaluation_direction": "SENIOR_TO_EMPLOYEE",
                # Начальное значение даёт СЕРВЕР (§19.8).
                "initial_score": 8,
                "status": "PENDING",
                "revision": 1,
                "submitted_evaluation_code": None,
                "submitted_at": None,
            }
            defaults.update(extra)
            OpsEvaluationWorkItem.objects.update_or_create(
                work_item_code=code, defaults=defaults,
            )

        work_item("work-item-1", "event-1", planner, "employee-1",
                  "Пост 1 — главный вход")
        # Участник заявлен, но не присутствовал: факт участия показывается
        # отдельно, оценку задание не принимает.
        work_item("work-item-2", "event-1", planner, "employee-2",
                  "Пост 2 — зона делегаций", participated=False)
        work_item("work-item-3", "event-1", planner, "employee-5",
                  "Старший смены",
                  evaluation_direction="EMPLOYEE_TO_SENIOR")
        work_item("work-item-4", "event-1", planner, "employee-6",
                  "Пост 3 — периметр", status="SUBMITTED", revision=2,
                  submitted_evaluation_code="evaluation-21",
                  submitted_at=iso("2026-07-18T20:05:00+05:00"))
        # Задание с УЖЕ исправленной оценкой: его запись — evaluation-5,
        # замещающая evaluation-4 (см. correction-1).
        work_item("work-item-9", "event-1", planner, "employee-1",
                  "Пост 1 — главный вход (повторная смена)",
                  status="SUBMITTED", revision=3,
                  submitted_evaluation_code="evaluation-5",
                  submitted_at=iso("2026-07-15T09:20:00+05:00"))
        work_item("work-item-5", "event-2", planner, "employee-7",
                  "Пост 1 — накопитель")
        # Чужие задания: не попадают в очередь другого человека, но обязаны
        # попадать в сводку мероприятия — она считает работу ВСЕХ.
        work_item("work-item-6", "event-1", "demo-recon-officer",
                  "employee-8", "Пост 4 — стоянка")
        work_item("work-item-8", "event-1", "demo-admin", "employee-4",
                  "Пост 6 — пресс-центр")
        work_item("work-item-7", "event-1", "demo-recon-officer",
                  "employee-3", "Пост 5 — служебный вход",
                  status="SUBMITTED", revision=2,
                  submitted_evaluation_code="evaluation-11",
                  submitted_at=iso("2026-07-18T20:40:00+05:00"))

        OpsEvaluationCorrection.objects.update_or_create(
            correction_code="correction-1",
            defaults={
                "original_evaluation_code": "evaluation-4",
                "replacement_evaluation_code": "evaluation-5",
                "reason": "Оценка выставлена по ошибке не тому участнику",
                "corrected_by": planner,
                "corrected_at": iso("2026-07-15T09:20:00+05:00"),
                "revision": 1,
            },
        )

        # Точки динамики: ЗАПИСАННЫЕ агрегаты закрытых периодов под ПРОШЛЫМИ
        # редакциями методики — текущая редакция раздела настроек ни одного
        # периода ещё не закрывала (§19.20). NULL — агрегата нет, не ноль.
        POLICY_V1 = "OPERATIONAL-RATING-2026.01.1"
        POLICY_V2 = "OPERATIONAL-RATING-2026.05.1"
        closed_periods = [
            ("2026-03", "2026-03-01", "2026-03-31", POLICY_V1),
            ("2026-04", "2026-04-01", "2026-04-30", POLICY_V1),
            ("2026-05", "2026-05-01", "2026-05-31", POLICY_V2),
            ("2026-06", "2026-06-01", "2026-06-30", POLICY_V2),
        ]
        dynamics = {
            "employee-1": [(8.1, 6), (7.9, 5), (None, 2), (8.6, 7)],
            "employee-2": [(7.2, 4), (7.6, 5), (7.4, 4), (7.9, 6)],
            "employee-3": [(None, 1), (8.3, 4), (8.0, 5), (None, 3)],
            "employee-4": [(None, 0), (None, 0), (None, 0), (None, 0)],
        }
        for participant_code, values in dynamics.items():
            for (period, starts, ends, policy), (rating, count) in zip(
                closed_periods, values
            ):
                OpsRatingDynamicsPoint.objects.update_or_create(
                    participant_code=participant_code, period=period,
                    defaults={
                        "period_starts_at": dt.date.fromisoformat(starts),
                        "period_ends_at": dt.date.fromisoformat(ends),
                        "aggregate_rating": rating,
                        "evaluations_count": count,
                        "policy_version": policy,
                        "data_state": (
                            "INSUFFICIENT_DATA" if rating is None else "READY"
                        ),
                        # Точка фиксируется на следующие сутки после закрытия
                        # периода: закрытый период считается один раз.
                        "recorded_at": iso(f"{ends}T23:59:00+05:00"),
                    },
                )

        # Сеяные события журнала (§19.27): ровно то, что в сиде УЖЕ
        # произошло, — иначе «в записи нет значений» проверялось бы на
        # отсутствующих данных.
        for (code, occurred, actor, event, evaluation_code, correction,
             assignment, revision, request_id) in [
            ("rating-audit-seed-1", "2026-07-18T20:05:00+05:00", planner,
             "EVALUATION_SUBMITTED", "evaluation-21", None,
             "assignment-work-item-4", 2, "seed-request-1"),
            ("rating-audit-seed-2", "2026-07-15T09:20:00+05:00", planner,
             "EVALUATION_CORRECTED", "evaluation-5", "correction-1",
             "assignment-work-item-9", 3, "seed-request-2"),
        ]:
            OpsRatingAuditEntry.objects.update_or_create(
                entry_code=code,
                defaults={
                    "occurred_at": iso(occurred),
                    "actor_user_id": actor,
                    "event_code": event,
                    "outcome": "SUCCESS",
                    "reason_code": None,
                    "security_event_code": "event-1",
                    "event_run_code": "run-1",
                    "assignment_code": assignment,
                    "evaluation_code": evaluation_code,
                    "correction_code": correction,
                    "request_id": request_id,
                    "revision": revision,
                },
            )

        # Сеяные уведомления (§19.28) — адресованы тем, у кого есть
        # незакрытые задания.
        for code, recipient in [
            ("rating-notification-seed-1", planner),
            ("rating-notification-seed-2", "demo-recon-officer"),
        ]:
            OpsRatingNotification.objects.update_or_create(
                notification_code=code,
                defaults={
                    "notified_at": iso("2026-07-18T19:30:00+05:00"),
                    "recipient_user_id": recipient,
                    "code": "EVALUATION_AVAILABLE",
                    "deep_link": "/ratings/workspace?event=event-1",
                    "security_event_code": "event-1",
                },
            )

        OpsRatingFeatureFlags.objects.update_or_create(
            singleton_key=1,
            defaults={"operational_ratings": True, "rating_conflicts": True},
        )
        self.stdout.write(self.style.SUCCESS("Seeded operational ratings"))

    def _seed_analytics(self):
        """Реестры аналитики службы (§22) — порт мок-фикстур клиента.

        Пороги НАМЕРЕННО не круглые (18/34 процента, 53 часа): совпадение с
        «привычным» числом скрыло бы захардкоженный порог, если бы он где-то
        остался. Администрируемые числа детекторов живут в «Настройках»
        (ATTENTION_POLICY) и накладываются поверх этих значений по умолчанию.
        """
        from organization_management.apps.operations.models_analytics import (
            OpsAnalyticsMetricDefinition,
            OpsAnalyticsPeriodPreset,
            OpsAttentionDetector,
        )

        metrics = [
            # (code, label, warning, critical, position); справочные
            # показатели — без порогов: выдуманный порог сделал бы обычную
            # работу службы «предупреждением».
            ("DUTY_ACTIVE", "На дежурстве", None, None, 1),
            ("DUTY_PLANNED", "Запланировано смен", None, None, 2),
            ("REST_AFTER_DUTY", "Отдых после дежурства", None, None, 3),
            ("UNFINISHED_PAST_DUTIES", "Незакрытые прошедшие дежурства",
             1, 4, 4),
            ("CONFLICT_HARD", "Жёсткие конфликты", 1, 3, 5),
            ("CONFLICT_SOFT", "Мягкие конфликты", 2, 6, 6),
            ("UNCONFIRMED_PARTICIPATION", "Неподтверждённое участие",
             1, 5, 7),
        ]
        for code, label, warning, critical, position in metrics:
            OpsAnalyticsMetricDefinition.objects.update_or_create(
                metric_code=code,
                defaults={
                    "safe_label": label, "unit": "COUNT",
                    "warning_from": warning, "critical_from": critical,
                    "drilldown_available": True, "position": position,
                },
            )

        presets = [
            ("TODAY", "Сегодня", 0, 1, 1),
            ("PREV_BUSINESS_DAY", "Предыдущий рабочий день", -1, 1, 2),
            ("CURRENT_WEEK", "Текущая неделя", 0, 7, 3),
            ("CURRENT_MONTH", "Текущий месяц", 0, 30, 4),
        ]
        for code, label, offset, length, position in presets:
            OpsAnalyticsPeriodPreset.objects.update_or_create(
                preset_code=code,
                defaults={
                    "safe_label": label, "offset_days": offset,
                    "length_days": length, "position": position,
                },
            )

        detectors = [
            ("ACKNOWLEDGEMENT_MISSING", "ACKNOWLEDGEMENT_MISSING",
             "VERIFICATION_REQUIRED",
             "Записей с ближайшим заступлением без отметки об ознакомлении: "
             "{count}. Срок упреждения — {parameter} дн.",
             3, 1, 4, "/security-ops/duties", "duty.view", 1),
            ("CONFLICT_SHARE", "CONFLICT_SHARE", "THRESHOLD_EXCEEDED",
             "Доля записей периода с конфликтом планирования — {value}% при "
             "серверном пороге. Записей с конфликтом: {count}.",
             0, 18, 34, "/security-ops/duties", "duty.view", 2),
            ("UNFINISHED_OVERDUE", "UNFINISHED_OVERDUE",
             "UNFINISHED_PROCESSES",
             "Записей, не переведённых в завершённое состояние дольше "
             "допуска ({parameter} дн.): {count}.",
             2, 1, 5, "/security-ops/duties", "duty.view", 3),
            ("UNCONFIRMED_OVERDUE", "UNCONFIRMED_OVERDUE",
             "DATA_UNCONFIRMED",
             "Записей без подтверждённых отметок фактического времени "
             "дольше допуска ({parameter} дн.): {count}.",
             2, 1, 4, "/security-ops/duties", "duty.view", 4),
            # Утверждение об ИСТОЧНИКЕ: перехода нет намеренно — вести
            # человека в раздел данных, которые не обновлялись, значит
            # предложить искать там причину, которой в разделе не видно.
            ("SOURCE_AGE", "SOURCE_AGE", "SOURCE_NOT_UPDATED",
             "Последнее изменение источника — {value} ч назад при допуске "
             "{parameter} ч.",
             53, 53, None, None, None, 5),
        ]
        for (code, measure, title, template, parameter, warning, critical,
             route, permission, position) in detectors:
            OpsAttentionDetector.objects.update_or_create(
                category_code=code,
                defaults={
                    "measure": measure, "title_code": title,
                    "safe_description_template": template,
                    "parameter": parameter, "warning_from": warning,
                    "critical_from": critical, "base_severity": "INFO",
                    "target_route": route, "target_permission": permission,
                    "position": position,
                },
            )
        self.stdout.write(self.style.SUCCESS("Seeded service analytics"))

    def _seed_reports(self):
        """Каталог служебных отчётов (§22.19) — порт мок-фикстуры: один тип,
        под которым есть РЕАЛЬНЫЕ данные (смены дежурств). Предел периода к
        типу приезжает из политики REPORT_LIMITS, а не хранится здесь."""
        from organization_management.apps.operations.models_report import (
            OpsServiceReportType,
        )

        OpsServiceReportType.objects.update_or_create(
            report_type_code="PERSONNEL_EXPENSE",
            defaults={
                "safe_title": "Расход личного состава",
                "description": (
                    "Смены дежурств за период: дата, сотрудник, объект, "
                    "пост из снимка паспорта, состояние."
                ),
                "formats": ["CSV"],
                "position": 1,
            },
        )
        self.stdout.write(self.style.SUCCESS("Seeded service report types"))

    def _seed_feedback(self, feedback_author):
        """Обратная связь (§28) — порт мок-фикстуры хоста: справочник целиком
        (подписи, порядок, КАРТА ПЕРЕХОДОВ — в данных) и девять обращений —
        три страницы по четыре, последняя неполная. Среди них чужой ЧЕРНОВИК
        (не виден никому, кроме автора), чужое КОНФИДЕНЦИАЛЬНОЕ, обращение с
        согласием на техническую информацию и признанный дубликат со ссылкой
        на оригинал. Авторы — demo-персоны мок-контракта: живой учётки у них
        нет, «своё» обращение на стенде заводится через --feedback-author."""
        import datetime as _dt

        from organization_management.apps.operations.clock import Clock
        from organization_management.apps.operations.models_feedback import (
            OpsFeedbackComment,
            OpsFeedbackEvent,
            OpsFeedbackRegistry,
            OpsFeedbackRequest,
        )

        OpsFeedbackRegistry.objects.update_or_create(
            singleton_key=1,
            defaults={
                "version": "feedback-registry-2026.07.2",
                "types": [
                    {"code": "BUG", "label": "Ошибка"},
                    {"code": "WRONG_DATA", "label": "Неверные данные"},
                    {"code": "UX", "label": "UX"},
                    {"code": "IDEA", "label": "Идея"},
                    {"code": "ACCESS", "label": "Доступ"},
                    {"code": "HELP", "label": "Помощь"},
                ],
                "priorities": [
                    {"code": "LOW", "label": "Низкий"},
                    {"code": "NORMAL", "label": "Обычный"},
                    {"code": "HIGH", "label": "Высокий"},
                    {"code": "CRITICAL", "label": "Критический"},
                ],
                "statuses": [
                    {"code": "DRAFT", "label": "Черновик"},
                    {"code": "NEW", "label": "Новое"},
                    {"code": "IN_REVIEW", "label": "На рассмотрении"},
                    {"code": "NEED_INFO", "label": "Нужна информация"},
                    {"code": "ACCEPTED", "label": "Принято в работу"},
                    {"code": "PLANNED", "label": "Запланировано"},
                    {"code": "FIXED", "label": "Исправлено"},
                    {"code": "RELEASED", "label": "Реализовано"},
                    {"code": "REJECTED", "label": "Отклонено"},
                    {"code": "CLOSED", "label": "Закрыто"},
                    {"code": "DUPLICATE", "label": "Дубликат"},
                ],
                # Модули — разделы, которые в нативном порте РЕАЛЬНО есть.
                "modules": [
                    {"moduleCode": "SECURITY_EVENTS", "label": "Реестр ОМ"},
                    {"moduleCode": "DUTIES", "label": "План дежурств"},
                    {"moduleCode": "OBJECTS", "label": "Объекты и паспорта"},
                    {"moduleCode": "RATINGS", "label": "Оперативный рейтинг"},
                    {"moduleCode": "ANALYTICS", "label": "Аналитика службы"},
                    {"moduleCode": "REPORTS", "label": "Отчёты службы"},
                    {"moduleCode": "OTHER", "label": "Другое"},
                ],
                # Из терминальных статусов переходов нет — это и есть замок.
                "status_transitions": [
                    {"from": "DRAFT", "to": ["NEW"]},
                    {"from": "NEW",
                     "to": ["IN_REVIEW", "NEED_INFO", "REJECTED", "DUPLICATE"]},
                    {"from": "IN_REVIEW",
                     "to": ["NEED_INFO", "ACCEPTED", "REJECTED", "DUPLICATE"]},
                    {"from": "NEED_INFO", "to": ["IN_REVIEW", "REJECTED"]},
                    {"from": "ACCEPTED", "to": ["PLANNED", "REJECTED"]},
                    {"from": "PLANNED", "to": ["FIXED", "REJECTED"]},
                    {"from": "FIXED", "to": ["RELEASED"]},
                    {"from": "RELEASED", "to": ["CLOSED"]},
                    {"from": "REJECTED", "to": []},
                    {"from": "CLOSED", "to": []},
                    {"from": "DUPLICATE", "to": []},
                ],
                "terminal_statuses": ["CLOSED", "REJECTED", "DUPLICATE"],
            },
        )

        planner = ("demo-event-planner", "Организатор ОМ")
        analyst = ("demo-analyst", "Аналитик")
        objects_admin = ("demo-objects-admin", "Ведение объектов")
        now = Clock.now()

        def ago(minutes):
            return now - _dt.timedelta(minutes=minutes)

        if not OpsFeedbackRequest.objects.exists():
            def request(minutes, author, **fields):
                row = OpsFeedbackRequest.objects.create(
                    author_user_id=author[0],
                    author_label=author[1],
                    **fields,
                )
                # created_at — auto_now_add: отсчёт назад ставится update-ом,
                # иначе весь сид лёг бы «одной минутой».
                OpsFeedbackRequest.objects.filter(pk=row.pk).update(
                    created_at=ago(minutes), updated_at=ago(minutes)
                )
                row.refresh_from_db()
                return row

            common = {
                "expected_result": None,
                "reproduction_steps": None,
                "attachments": [],
                "contact": None,
                "confidential": False,
                "related_route": None,
                "technical_info": None,
                "working_priority_code": None,
                "assignee_user_id": None,
                "assignee_label": None,
                "duplicate_of": None,
                "submitted_at": None,
            }
            fb_1001 = request(
                600, planner, **{
                    **common,
                    "subject": (
                        "Не открывается карточка мероприятия по прямой ссылке"
                    ),
                    "description": (
                        "При переходе по ссылке из уведомления карточка "
                        "мероприятия показывает пустой экран, приходится "
                        "открывать реестр и искать мероприятие заново."
                    ),
                    "type_code": "BUG",
                    "priority_code": "HIGH",
                    "status_code": "IN_REVIEW",
                    "module_code": "SECURITY_EVENTS",
                    "expected_result": "Карточка открывается сразу по ссылке.",
                    "reproduction_steps": (
                        "1. Открыть уведомление. 2. Нажать ссылку. "
                        "3. Увидеть пустой экран."
                    ),
                    "attachments": [{
                        "fileName": "ekran.png",
                        "sizeBytes": 184320,
                        "mimeType": "image/png",
                    }],
                    "contact": "вн. 12-45",
                    "related_route": "/security-ops/events",
                    "technical_info": {
                        "appRevision": "port-2.5.0",
                        "viewport": "1440×900",
                        "platform": "desktop",
                        "capturedAt": ago(600).isoformat(),
                    },
                    # Разобранное: рабочий приоритет НИЖЕ заявленного —
                    # совпадение скрыло бы, что это разные поля.
                    "working_priority_code": "NORMAL",
                    "assignee_user_id": objects_admin[0],
                    "assignee_label": objects_admin[1],
                    "submitted_at": ago(600),
                },
            )
            request(
                540, objects_admin, **{
                    **common,
                    "subject": "В плане дежурств путается подпись состояния",
                    "description": (
                        "Две соседние колонки подписаны похоже, из-за этого "
                        "приходится сверяться с легендой на каждой строке."
                    ),
                    "type_code": "UX",
                    "priority_code": "NORMAL",
                    "status_code": "ACCEPTED",
                    "module_code": "DUTIES",
                    "expected_result": (
                        "Подписи колонок различаются с первого взгляда."
                    ),
                    "related_route": "/security-ops/duties",
                    "submitted_at": ago(540),
                },
            )
            request(
                480, objects_admin, **{
                    **common,
                    "subject": "Обращение по доступу",
                    "description": (
                        "Прошу разобраться с доступом: список подразделений "
                        "отображается не тому сотруднику, что нарушает "
                        "разграничение."
                    ),
                    "type_code": "ACCESS",
                    "priority_code": "CRITICAL",
                    "status_code": "NEW",
                    "module_code": "OTHER",
                    "expected_result": (
                        "Доступ ограничен своим подразделением."
                    ),
                    "reproduction_steps": (
                        "Открыть список подразделений под учётной записью "
                        "без права."
                    ),
                    "attachments": [{
                        "fileName": "vypiska.pdf",
                        "sizeBytes": 51200,
                        "mimeType": "application/pdf",
                    }],
                    "contact": "личный приём",
                    "confidential": True,
                    "related_route": "/organization",
                    "submitted_at": ago(480),
                },
            )
            # Чужой ЧЕРНОВИК: не виден никому, кроме автора, — даже
            # обладателю права видеть все обращения (отправки не было).
            request(
                420, analyst, **{
                    **common,
                    "subject": "Черновик обращения аналитика",
                    "description": (
                        "Не дописано: нужно приложить пример выгрузки."
                    ),
                    "type_code": "IDEA",
                    "priority_code": "LOW",
                    "status_code": "DRAFT",
                    "module_code": "ANALYTICS",
                    "related_route": "/security-ops/analytics",
                },
            )
            request(
                360, analyst, **{
                    **common,
                    "subject": "Добавить фильтр по объекту в аналитику",
                    "description": (
                        "Сейчас приходится выгружать отчёт целиком, чтобы "
                        "посмотреть один объект."
                    ),
                    "type_code": "IDEA",
                    "priority_code": "NORMAL",
                    "status_code": "PLANNED",
                    "module_code": "ANALYTICS",
                    "expected_result": (
                        "Фильтр по объекту на экране аналитики."
                    ),
                    "related_route": "/security-ops/analytics",
                    "submitted_at": ago(360),
                },
            )
            request(
                300, planner, **{
                    **common,
                    "subject": "Неверный пост в снимке паспорта",
                    "description": (
                        "В снимке паспорта объекта пост назван старым "
                        "именем, хотя версия уже новая."
                    ),
                    "type_code": "WRONG_DATA",
                    "priority_code": "HIGH",
                    "status_code": "FIXED",
                    "module_code": "OBJECTS",
                    "expected_result": (
                        "Снимок содержит имя поста действующей версии."
                    ),
                    "reproduction_steps": (
                        "Открыть дежурство, привязанное к версии 1."
                    ),
                    "contact": "вн. 12-45",
                    "related_route": "/security-ops/objects",
                    "submitted_at": ago(300),
                },
            )
            request(
                240, objects_admin, **{
                    **common,
                    "subject": "Как отменить смену без удаления",
                    "description": (
                        "Не нашёл, где отменить смену так, чтобы она "
                        "осталась в плане."
                    ),
                    "type_code": "HELP",
                    "priority_code": "LOW",
                    "status_code": "CLOSED",
                    "module_code": "DUTIES",
                    "related_route": "/security-ops/duties",
                    "submitted_at": ago(240),
                },
            )
            request(
                180, objects_admin, **{
                    **common,
                    "subject": "Повтор обращения про карточку мероприятия",
                    "description": (
                        "То же, что уже сообщали: карточка не открывается "
                        "по прямой ссылке."
                    ),
                    "type_code": "BUG",
                    "priority_code": "NORMAL",
                    "status_code": "DUPLICATE",
                    "module_code": "SECURITY_EVENTS",
                    "related_route": "/security-ops/events",
                    # Признанный дубликат обязан указывать НА ЧТО.
                    "duplicate_of": fb_1001,
                    "submitted_at": ago(180),
                },
            )
            request(
                120, planner, **{
                    **common,
                    "subject": "Просьба вернуть сортировку по дате",
                    "description": (
                        "После обновления список стал сортироваться иначе, "
                        "привычный порядок пропал."
                    ),
                    "type_code": "UX",
                    "priority_code": "NORMAL",
                    "status_code": "REJECTED",
                    "module_code": "OTHER",
                    "submitted_at": ago(120),
                },
            )

            for minutes, kind, text in [
                (560, "PUBLIC_REPLY",
                 "Приняли в работу, воспроизвели на тестовом контуре. "
                 "Сообщим, когда исправим."),
                # Внутренняя заметка обязательна как демонстрация: без неё
                # нечего прятать от автора, и проверка была бы пустой.
                (555, "INTERNAL_NOTE",
                 "Причина — регрессия маршрутизации в конфигурации "
                 "редиректов."),
            ]:
                row = OpsFeedbackComment.objects.create(
                    request=fb_1001,
                    kind=kind,
                    body=text,
                    author_user_id=objects_admin[0],
                    author_label=objects_admin[1],
                )
                OpsFeedbackComment.objects.filter(pk=row.pk).update(
                    created_at=ago(minutes), updated_at=ago(minutes)
                )

            for minutes, kind, actor, field, old, new in [
                (600, "CREATED", planner, None, None, None),
                (600, "SUBMITTED", planner, None, None, None),
                (570, "ASSIGNED", objects_admin,
                 "assignee", None, objects_admin[0]),
                (565, "STATUS_CHANGED", objects_admin,
                 "statusCode", "NEW", "IN_REVIEW"),
                (560, "PUBLIC_REPLY_ADDED", objects_admin, None, None, None),
                (555, "INTERNAL_NOTE_ADDED", objects_admin, None, None, None),
            ]:
                OpsFeedbackEvent.objects.create(
                    request=fb_1001,
                    kind=kind,
                    actor_user_id=actor[0],
                    actor_label=actor[1],
                    at=ago(minutes),
                    field_code=field,
                    old_value=old,
                    new_value=new,
                )
            self.stdout.write(self.style.SUCCESS("Seeded feedback requests"))

        if feedback_author:
            author_user = User.objects.filter(pk=feedback_author).first()
            label = author_user.username if author_user else feedback_author
            own_draft, created = OpsFeedbackRequest.objects.get_or_create(
                author_user_id=str(feedback_author),
                subject="Черновик обращения со стенда",
                defaults={
                    "description": (
                        "Черновик для живой проверки пути «отправить "
                        "черновик»: допишите и отправьте."
                    ),
                    "type_code": "HELP",
                    "priority_code": "LOW",
                    "status_code": "DRAFT",
                    "module_code": "OTHER",
                    "expected_result": None,
                    "reproduction_steps": None,
                    "attachments": [],
                    "contact": None,
                    "confidential": False,
                    "related_route": None,
                    "technical_info": None,
                    "working_priority_code": None,
                    "assignee_user_id": None,
                    "assignee_label": None,
                    "duplicate_of": None,
                    "author_label": label,
                    "submitted_at": None,
                },
            )
            if created:
                OpsFeedbackEvent.objects.create(
                    request=own_draft,
                    kind="CREATED",
                    actor_user_id=str(feedback_author),
                    actor_label=label,
                    at=now,
                    field_code=None,
                    old_value=None,
                    new_value=None,
                )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded own feedback draft for actor {feedback_author}"
                )
            )
