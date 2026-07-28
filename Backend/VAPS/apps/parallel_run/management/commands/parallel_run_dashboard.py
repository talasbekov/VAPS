"""Story 7.8/AC-1 — дашборд зелёных дней + эскалация превышенного дедлайна.

"Given старт режима, Then ... отчёт зелёных дней доступен; превышение
дедлайна = эскалация-решение (продлить осознанно/откатиться), не молчание."

Разовый acceptance-подобный сигнал (та же форма, что
``verify_migration_convergence``, Story 7.5): дедлайн превышен И критерий
НЕ выполнен -> ``CommandError`` (ненулевой exit) — не проходит незамеченным
в логе. Критерий выполнен -> зелёный вердикт независимо от дедлайна (сам
факт "успели" не повод для тревоги, даже если формальная дата уже прошла).
"""

from django.core.management.base import BaseCommand, CommandError

from apps.core import parallel_run_mode
from apps.core.clock import Clock
from apps.parallel_run.exit_criterion import evaluate as evaluate_exit_criterion


class Command(BaseCommand):
    help = (
        "Дашборд exit-criterion режима «без двойного ввода» (Story 7.8): "
        "green_streak, дедлайн, вердикт. Дедлайн превышен без выполненного "
        "критерия -> CommandError (эскалация, не молчание)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--frozen-suite-green",
            action="store_true",
            help=(
                "Подтверждение оператором: последний прогон frozen-suite "
                "зелёный (внешний вход — нет автоматического хука на "
                "результат CI/pytest прогона)."
            ),
        )

    def handle(self, *args, **options):
        if not parallel_run_mode.is_enabled():
            raise CommandError(
                "режим «без двойного ввода» выключен — нет активного "
                "старта, exit criterion не применим"
            )

        deadline = parallel_run_mode.get_deadline()
        criterion = evaluate_exit_criterion(
            frozen_suite_green=options["frozen_suite_green"]
        )
        today = Clock.today_local()
        days_to_deadline = None if deadline is None else (deadline - today).days
        deadline_exceeded = deadline is not None and today > deadline

        self.stdout.write(
            f"green_streak={criterion.green_streak}/"
            f"{criterion.green_days_required} "
            f"frozen_suite_green={criterion.frozen_suite_green} "
            f"deadline={deadline.isoformat() if deadline else '(не задан)'} "
            f"days_to_deadline={days_to_deadline}"
        )

        if criterion.met:
            self.stdout.write(
                self.style.SUCCESS("exit criterion ВЫПОЛНЕН — готово к cutover")
            )
            return

        if deadline_exceeded:
            raise CommandError(
                "ЭСКАЛАЦИЯ: дедлайн превышен, exit criterion НЕ выполнен "
                f"(green_streak={criterion.green_streak}/"
                f"{criterion.green_days_required}, "
                f"frozen_suite_green={criterion.frozen_suite_green}) — "
                "требуется осознанное решение: продлить дедлайн или "
                "откатиться (Story 7.10)"
            )

        self.stdout.write("exit criterion пока не выполнен")
