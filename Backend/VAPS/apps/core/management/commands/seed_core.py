from django.core.management.base import BaseCommand

from apps.core.models import DivisionType

DIVISION_TYPES = [
    ("department", "Департамент", 1),
    ("management", "Управление", 2),
    ("division", "Отдел", 3),
    ("office", "Офис", 4),
    ("group", "Группа", 5),
]


class Command(BaseCommand):
    help = "Seed core reference tables (idempotent)."

    def handle(self, *args, **options):
        for code, name, sort_order in DIVISION_TYPES:
            DivisionType.objects.update_or_create(
                code=code, defaults={"name": name, "sort_order": sort_order}
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_division_types"))
