"""Story 7.10/AC-1/AC-3 — cutover по рунбуку: exit criterion выполнен,
официальный канал расхода переключается на VAPS."""

from django.core.management.base import BaseCommand, CommandError

from apps.parallel_run.cutover import execute_cutover


class Command(BaseCommand):
    help = (
        "Cutover (Story 7.10): переключение официального канала расхода на "
        "VAPS. Отказывает, если exit criterion (Story 7.8) не выполнен."
    )

    def add_arguments(self, parser):
        parser.add_argument("--actor", required=True)
        parser.add_argument(
            "--frozen-suite-green",
            action="store_true",
            help="Подтверждение оператором: frozen-suite прогон зелёный.",
        )

    def handle(self, *args, **options):
        try:
            execute_cutover(
                actor=options["actor"],
                frozen_suite_green=options["frozen_suite_green"],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS("cutover выполнен — официальный канал расхода = VAPS")
        )
