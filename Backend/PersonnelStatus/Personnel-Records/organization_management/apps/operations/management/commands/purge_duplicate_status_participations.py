"""Сухой и подтверждаемый демонтаж точных дублей участия в ОМ (Plane №858)."""

from django.core.management.base import BaseCommand

from organization_management.apps.operations.status_cleanup import (
    find_duplicate_participations,
    purge_duplicate_participations,
)


class Command(BaseCommand):
    help = "Найти или удалить точные дубли участий сотрудников в ОМ."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Удалить найденное; без флага команда выполняет сухой прогон.",
        )
        parser.add_argument(
            "--actor",
            default="purge_duplicate_status_participations",
            help="Подпись операции в журнале аудита.",
        )

    def handle(self, *args, **options):
        scan = find_duplicate_participations()
        self.stdout.write(
            f"Точных групп-дублей: {scan.groups}; лишних участий: "
            f"{len(scan.duplicate_ids)}"
        )
        if not scan.duplicate_ids:
            self.stdout.write(self.style.SUCCESS("Очищать нечего."))
            return
        self.stdout.write(
            "Останутся участия: " + ", ".join(map(str, scan.kept_ids[:20]))
        )
        self.stdout.write(
            "Будут сняты участия: "
            + ", ".join(map(str, scan.duplicate_ids[:20]))
            + (" …" if len(scan.duplicate_ids) > 20 else "")
        )
        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING(
                    "Сухой прогон. Для удаления повторите команду с --yes."
                )
            )
            return

        result = purge_duplicate_participations(actor=options["actor"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Снято точных дублей: {result.participations}; "
                f"опустевших строк статуса: {result.statuses}; "
                f"групп: {result.groups}."
            )
        )
