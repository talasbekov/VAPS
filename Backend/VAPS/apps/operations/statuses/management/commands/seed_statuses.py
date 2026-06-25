from django.core.management.base import BaseCommand

from apps.operations.statuses.models import StatusType

# DB-OPS-003 reference catalog, in priority order. Rows carry (code, name,
# priority, report_column_code); the boolean flags are derived from the sets
# below. Values are literal here for readability — test_seed_statuses cross-
# checks them against strength_report.STATUS_TYPE_PRIORITIES /
# REPORT_COLUMN_BY_CODE and employee_status.HARD_STATUS_TYPE_CODES so any drift
# between the catalog and the code constants fails the gate.
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
    ("EVENT_ASSIGNMENT", "Привлечён на мероприятие", 80, "IN_SERVICE"),
    # Architecture decision (FR-6) + story 3.9: "уточняется" is a first-class
    # status-type value with its OWN расход column (AR-11 «своя строка расхода»).
    # priority 990 = below every real fact, above derived «В строю» (Решение №1).
    ("PENDING_CLARIFICATION", "Уточняется", 990, "PENDING"),
    ("IN_SERVICE", "В строю", 999, "IN_SERVICE"),
]

# Must equal employee_status.HARD_STATUS_TYPE_CODES (AC-3): hard -> 422.
HARD_BLOCK_CODES = {"SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND"}
# FR-16: only "Откомандирован" loses the right to edit statuses.
RESTRICTS_EDITING_CODES = {"DETACHED"}
# DB-OPS-003 / BR-002 п.6: the attached force is the only type kept OUT of
# staff totals (reported as "+N").
NOT_COUNTED_IN_STAFF_CODES = {"ATTACHED"}
# DB-OPS-003: KU owns the absence catalog; operational statuses (duty, rest,
# in-service, GEV, event, pending) are system-owned (is_ku_owned=False).
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


class Command(BaseCommand):
    help = "Seed status type reference catalog (idempotent)."

    def handle(self, *args, **options):
        for code, name, priority, report_column_code in STATUS_TYPES:
            # Canon fields are re-synced from code on every run (so the catalog
            # can't be forked via Admin). color/is_active are operator-owned once
            # StatusType is Admin-editable (story 2.11), so they are seeded ONLY
            # on create and never re-synced — this is why they live in
            # create_defaults but NOT defaults (deferred #L174).
            #
            # create_defaults (Django 5.0+) fully REPLACES defaults on the create
            # path (it is not merged), so it must carry every field needed for a
            # valid INSERT — canon + the operator-owned pair.
            canon = {
                "name": name,
                "priority": priority,
                "report_column_code": report_column_code,
                "is_hard_block": code in HARD_BLOCK_CODES,
                "restricts_editing": code in RESTRICTS_EDITING_CODES,
                "counts_in_staff": code not in NOT_COUNTED_IN_STAFF_CODES,
                "counts_in_list": True,
                "is_ku_owned": code in KU_OWNED_CODES,
            }
            StatusType.objects.update_or_create(
                code=code,
                defaults=canon,
                create_defaults={**canon, "color": "", "is_active": True},
            )
        self.stdout.write(
            self.style.SUCCESS(f"Seeded {len(STATUS_TYPES)} status types")
        )
