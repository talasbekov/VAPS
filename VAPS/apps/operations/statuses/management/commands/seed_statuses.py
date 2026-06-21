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
    # Architecture decision (FR-6): "уточняется" is a real status-type value;
    # priority/column are provisional pending the status engine (E3).
    ("PENDING_CLARIFICATION", "Уточняется", 990, "IN_SERVICE"),
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
            StatusType.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "priority": priority,
                    "report_column_code": report_column_code,
                    "is_hard_block": code in HARD_BLOCK_CODES,
                    "restricts_editing": code in RESTRICTS_EDITING_CODES,
                    "counts_in_staff": code not in NOT_COUNTED_IN_STAFF_CODES,
                    "counts_in_list": True,
                    "is_ku_owned": code in KU_OWNED_CODES,
                    "color": "",
                    "is_active": True,
                },
            )
        self.stdout.write(
            self.style.SUCCESS(f"Seeded {len(STATUS_TYPES)} status types")
        )
