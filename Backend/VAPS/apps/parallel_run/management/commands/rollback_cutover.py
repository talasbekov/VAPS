"""Story 7.10/AC-1 — откат cutover: донор снова источник ввода. Одна
команда — механическая часть "< норматив", не многошаговая импровизация."""

import datetime

from django.core.management.base import BaseCommand, CommandError

from apps.parallel_run.cutover import rollback


class Command(BaseCommand):
    help = (
        "Откат cutover (Story 7.10): re-enable режима «без двойного ввода» "
        "с новым дедлайном — донор снова источник ввода."
    )

    def add_arguments(self, parser):
        parser.add_argument("--actor", required=True)
        parser.add_argument(
            "--deadline", required=True, help="YYYY-MM-DD — новый дедлайн"
        )

    def handle(self, *args, **options):
        try:
            deadline = datetime.date.fromisoformat(options["deadline"])
        except ValueError as exc:
            raise CommandError(f"невалидный --deadline: {exc}") from exc

        try:
            rollback(actor=options["actor"], deadline=deadline)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"откат выполнен — режим снова включён, дедлайн={deadline}"
            )
        )
