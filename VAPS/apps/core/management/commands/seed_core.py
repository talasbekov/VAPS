from django.core.management.base import BaseCommand

from apps.core.models import DivisionType, Position, Rank

RANKS = [
    ("LT", "Лейтенант", "officer", 10),
    ("CPT", "Капитан", "officer", 20),
    ("MAJOR", "Майор", "officer", 30),
    ("COL", "Полковник", "officer", 40),
]

POSITIONS = [
    ("NACH_DEP", "Начальник департамента", 1, 10),
    ("NACH_UPR", "Начальник управления", 2, 20),
    ("NACH_OTD", "Начальник отдела", 3, 30),
    ("OPER", "Оперуполномоченный", 4, 40),
]

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
        for code, name, level, sort_order in POSITIONS:
            Position.objects.update_or_create(
                code=code, defaults={"name": name, "level": level, "sort_order": sort_order}
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_positions"))
        for code, name, category, rank_index in RANKS:
            Rank.objects.update_or_create(
                code=code,
                defaults={"name": name, "category": category, "rank_index": rank_index},
            )
        self.stdout.write(self.style.SUCCESS("Seeded core_ranks"))
