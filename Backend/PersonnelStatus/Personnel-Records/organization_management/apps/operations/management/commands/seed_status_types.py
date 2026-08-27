"""Сид справочника типов статусов (порт seed_statuses из Backend/VAPS:
каталог, приоритеты, колонки расхода и наборы флагов — дословно) +
LEGACY_CODE_BY_CODE — мост к кодам старой системы, добавка переезда.
"""
from django.core.management.base import BaseCommand

from organization_management.apps.operations.models import StatusType

# Справочный каталог в порядке приоритета: (код, имя, приоритет, колонка
# расхода). Булевы флаги выводятся из наборов ниже.
STATUS_TYPES = [
    ("SICK_LEAVE", "На больничном", 10, "SICK"),
    ("LEAVE_BY_REPORT", "Отпуск по рапорту", 15, "VACATION"),
    ("VACATION", "В отпуске", 20, "VACATION"),
    ("COMMAND", "В командировке", 30, "COMMAND"),
    ("STUDY", "Учёба", 32, "TRAINING"),
    ("COMPETITION", "Соревнования", 34, "TRAINING"),
    ("CONFERENCE", "Конференция", 36, "TRAINING"),
    ("OTHER_ABSENCE", "Иное отсутствие", 38, "OTHER"),
    ("DETACHED", "Откомандирован", 40, "DETACHED"),
    ("ATTACHED", "Прикомандирован", 50, "ATTACHED"),
    ("REST_AFTER_DUTY", "После дежурства", 60, "AFTER_DUTY"),
    ("BEFORE_DUTY", "Перед дежурством", 65, "BEFORE_DUTY"),
    ("DUTY", "На дежурстве", 70, "ON_DUTY"),
    ("GEV", "Группа экстренного выезда", 75, "ON_DUTY"),
    # Участие в ОМ делится НАДВОЕ (сценарий заказчика, Plane №243, дословно:
    # «Участие на ОМ… внутри она делится на группы и физически наряд»).
    # Оба кода отчитываются в колонку `IN_SERVICE`: человек на мероприятии
    # остаётся в строю (решение Plane №169), а разницу «группа или наряд»
    # показывает СПРАВОЧНЫЙ счётчик расхода — он вне суммы колонок и потому
    # ничего в ней не сдвигает.
    ("EVENT_ASSIGNMENT", "Привлечён на мероприятие (наряд)", 80, "IN_SERVICE"),
    ("EVENT_ASSIGNMENT_GROUP", "Привлечён на мероприятие (боевая группа)", 81, "IN_SERVICE"),
    # «Уточняется» — полноценное значение со СВОЕЙ колонкой расхода;
    # приоритет 990 = ниже любого реального факта, выше выводимого «В строю».
    ("PENDING_CLARIFICATION", "Уточняется", 990, "PENDING"),
    ("IN_SERVICE", "В строю", 999, "IN_SERVICE"),
]

# Жёсткая блокировка → 422 (мягкая → 409 + override).
HARD_BLOCK_CODES = {"SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND"}
# Только «Откомандирован» теряет право редактировать статусы.
RESTRICTS_EDITING_CODES = {"DETACHED"}
# Прикомандированные — единственный тип ВНЕ штатных итогов (в отчёте «+N»).
NOT_COUNTED_IN_STAFF_CODES = {"ATTACHED"}
# ЗАГЛУШКА — тип, означающий не факт, а его отсутствие («уточняется»). Такую
# строку не правят, а РАЗРЕШАЮТ ретро-заменой на реальный статус
# (status_service.resolve_placeholder), и признак этот сервис читает из
# СПРАВОЧНИКА, а не знает наизусть.
#
# До этого среза сид заводил «Уточняется» БЕЗ признака, и умолчание модели
# (False) делало ретро-замену недостижимой: единственная строка, которую она
# умеет разрешать, заглушкой не считалась. Отказ при этом выглядел осмысленно —
# «Ретро-заменой разрешается только строка-заглушка», — поэтому спрашивающий
# решил бы, что взял не ту строку, а не что возможности нет вовсе.
PLACEHOLDER_CODES = {"PENDING_CLARIFICATION"}
# Каталог отсутствий принадлежит КУ; оперативные статусы — системные.
KU_OWNED_CODES = {
    "SICK_LEAVE",
    "LEAVE_BY_REPORT",
    "VACATION",
    "COMMAND",
    "STUDY",
    "COMPETITION",
    "CONFERENCE",
    "OTHER_ABSENCE",
    "DETACHED",
    "ATTACHED",
}

# Мост «старый код → канонический» (добавка переезда). Покрывает ВСЕ 13
# значений EmployeeStatus.StatusType старой системы; тест
# test_legacy_bridge_covers_old_choices краснеет, если в старом словаре
# появится значение без канонической пары.
# Неочевидные соответствия: business_trip→COMMAND (одна командировка),
# training→STUDY (учёба; CONFERENCE/COMPETITION — отдельные типы),
# on_duty→DUTY, after_duty→REST_AFTER_DUTY, seconded_from→ATTACHED
# («прикомандирован ИЗ» = прикомандированный к нам), seconded_to→DETACHED.
LEGACY_CODE_BY_CODE = {
    "IN_SERVICE": "in_service",
    "VACATION": "vacation",
    "LEAVE_BY_REPORT": "leave_by_report",
    "SICK_LEAVE": "sick_leave",
    "COMMAND": "business_trip",
    "STUDY": "training",
    "COMPETITION": "competition",
    "CONFERENCE": "conference",
    "OTHER_ABSENCE": "other_absence",
    "DUTY": "on_duty",
    "REST_AFTER_DUTY": "after_duty",
    "ATTACHED": "seconded_from",
    "DETACHED": "seconded_to",
}


class Command(BaseCommand):
    help = "Seed status type reference catalog (idempotent)."

    def handle(self, *args, **options):
        for code, name, priority, report_column_code in STATUS_TYPES:
            # Канон пересинхронизируется из кода на каждом прогоне (каталог
            # нельзя форкнуть через админку). color/is_active — операторские,
            # поэтому сеются ТОЛЬКО при создании и не пересинхронизируются:
            # отсюда create_defaults, а не defaults. create_defaults (Django
            # 5.0+) полностью ЗАМЕЩАЕТ defaults на пути создания, поэтому
            # несёт все поля, нужные для валидного INSERT.
            canon = {
                "name": name,
                "priority": priority,
                "report_column_code": report_column_code,
                "is_hard_block": code in HARD_BLOCK_CODES,
                "restricts_editing": code in RESTRICTS_EDITING_CODES,
                "counts_in_staff": code not in NOT_COUNTED_IN_STAFF_CODES,
                "counts_in_list": True,
                "is_ku_owned": code in KU_OWNED_CODES,
                "is_placeholder": code in PLACEHOLDER_CODES,
                "legacy_code": LEGACY_CODE_BY_CODE.get(code),
            }
            StatusType.objects.update_or_create(
                code=code,
                defaults=canon,
                create_defaults={**canon, "color": "", "is_active": True},
            )
        self.stdout.write(
            self.style.SUCCESS(f"Seeded {len(STATUS_TYPES)} status types")
        )
